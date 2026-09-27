import { DurableObject } from 'cloudflare:workers';
import { createSession, authorize, heartbeat, markReady, beginClose, finishClose } from '../session/lifecycle.js';
import {browserLanding,readTicket} from './browser.js';
import { issueToken, hashToken, matchesToken } from '../session/token.js';
import { MAX_MS, type Session, type Reason } from '../session/types.js';

interface StackStub {
  boot(id: string): Promise<void>;
  remove(): Promise<void>;
  isStopped(): Promise<boolean>;
  proxy(request: Request): Promise<Response>;
}
interface Namespace<T> { getByName(name: string): T }
export interface Env {
  REGISTRY: Namespace<Registry>;
  SESSIONS: Namespace<SessionController>;
  STACKS: Namespace<StackStub>;
  MAX_SESSIONS: string;
  CLIENT_HASH_SALT: string;
}
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: {'cache-control':'no-store', 'x-content-type-options':'nosniff'},
});
const denied = () => json({error:'UNAUTHORIZED'},401);
const registry = (env: Env) => env.REGISTRY.getByName('admission');
const active = (s: Session) => s.state === 'ready' || s.state === 'provisioning';

/** Only bound RPC methods reach this object; the gateway exposes no arbitrary forwarding. */
export class Registry extends DurableObject<Env> {
  async reserve(client: string): Promise<{id:string} | {error:string;status:number}> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const cooldown = await this.ctx.storage.get<number>('client:'+client);
      if (cooldown && cooldown > now) return {error:'COOLDOWN',status:429};
      const leases = await this.ctx.storage.list<number>({prefix:'lease:'});
      const maximum = Number(this.env.MAX_SESSIONS);
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) return {error:'CONFIGURATION',status:503};
      if (leases.size >= maximum) return {error:'CAPACITY',status:503};
      const id = crypto.randomUUID();
      await this.ctx.storage.put({['lease:'+id]:now+MAX_MS,['client:'+client]:now+60_000});
      const pendingAlarm=await this.ctx.storage.getAlarm();
      await this.ctx.storage.setAlarm(Math.min(pendingAlarm??Infinity,now+60_000));
      return {id};
    });
  }
  async release(id: string) { await this.ctx.storage.delete('lease:'+id); }
  async alarm() {
    // Sweep orphan reservations too. Never free capacity until destruction is confirmed.
    const now=Date.now();
    const leases=await this.ctx.storage.list<number>({prefix:'lease:'});
    for(const [key,deadline] of leases) {
      if(deadline<=now) {
        const id=key.slice(6);
        try { await this.env.SESSIONS.getByName(id).closeOrphan(id); } catch { /* retry next alarm */ }
      }
    }
    await this.ctx.blockConcurrencyWhile(async()=>{
      for(const [key,deadline] of await this.ctx.storage.list<number>({prefix:'client:'})) {
        if(deadline<=now) await this.ctx.storage.delete(key);
      }
    });
    if((await this.ctx.storage.list({prefix:'lease:',limit:1})).size) await this.ctx.storage.setAlarm(Date.now()+60_000);
  }
}

export class SessionController extends DurableObject<Env> {
  private cleanup: Promise<void> | undefined;
  async initialize(id:string, tokenHash:string) {
    const initialized=await this.ctx.blockConcurrencyWhile(async()=>{
      if(await this.ctx.storage.get('session') || await this.ctx.storage.get('closed')) return false;
      const session=createSession({id,tokenHash,now:Date.now()});
      await this.ctx.storage.put('session',session);
      await this.ctx.storage.setAlarm(session.idleExpiresAt);
      return true;
    });
    if(!initialized) throw new Error('ALREADY_INITIALIZED');
    this.ctx.waitUntil(this.provision(id));
  }
  private async provision(id:string) {
    try {
      await this.env.STACKS.getByName(id).boot(id);
      await this.ctx.blockConcurrencyWhile(async()=>{
        const s=await this.ctx.storage.get<Session>('session');
        if(s?.state==='provisioning' && Date.now()<Math.min(s.idleExpiresAt,s.maxExpiresAt)) {
          await this.ctx.storage.put('session',markReady(s,Date.now()));
        }
      });
    } catch { await this.close('provision_failed'); }
  }
  private close(reason:Reason): Promise<void> {
    this.cleanup ??= this.performClose(reason).finally(()=>{ this.cleanup=undefined; });
    return this.cleanup;
  }
  private async performClose(reason:Reason) {
    const s=await this.ctx.blockConcurrencyWhile(async()=>{
      const current=await this.ctx.storage.get<Session>('session');
      if(!current) return undefined;
      const closing=beginClose(current,reason);
      await this.ctx.storage.put({session:closing,closed:true});
      await this.ctx.storage.delete(['browserTicket','browserHash']);
      await this.ctx.storage.setAlarm(Date.now()+30_000);
      return closing;
    });
    if(!s) return;
    try {
      await this.env.STACKS.getByName(s.id).remove();
      await this.ctx.storage.put('session',finishClose(s,true));
      await registry(this.env).release(s.id);
      await this.ctx.storage.delete('session');
      await this.ctx.storage.deleteAlarm();
    } catch {
      if(s.state!=='deleted') await this.ctx.storage.put('session',finishClose(s,false));
      await this.ctx.storage.setAlarm(Date.now()+30_000);
    }
  }
  async containerStopped() { await this.close('container_stopped'); }
  async closeOrphan(id:string) {
    const s=await this.ctx.blockConcurrencyWhile(async()=>{
      await this.ctx.storage.put('closed',true);
      return this.ctx.storage.get<Session>('session');
    });
    if(s) await this.close('maximum');
    else { await this.env.STACKS.getByName(id).remove(); await registry(this.env).release(id); }
  }
  async alarm() {
    const s=await this.ctx.storage.get<Session>('session');
    if(!s) return;
    const now=Date.now();
    if(!active(s)) return this.close(s.closeReason??'requested');
    if(now>=s.maxExpiresAt) return this.close('maximum');
    if(now>=s.idleExpiresAt) return this.close('idle');
    await this.ctx.storage.setAlarm(Math.min(s.idleExpiresAt,s.maxExpiresAt));
  }
  async browser(request:Request,exchange:boolean):Promise<Response>{
    const url=new URL(request.url);
    if((exchange||!['GET','HEAD'].includes(request.method))&&request.headers.get('origin')!==url.origin)return json({error:'ORIGIN_DENIED'},403);
    const ticket=exchange?await readTicket(request):undefined;
    const result=await this.ctx.blockConcurrencyWhile(async()=>{
      const s=await this.ctx.storage.get<Session>('session');
      if(!s||s.state!=='ready'||Date.now()>=Math.min(s.idleExpiresAt,s.maxExpiresAt))return undefined;
      if(exchange){
        const saved=await this.ctx.storage.get<{hash:string;expiresAt:number}>('browserTicket');
        if(!ticket||!saved||Date.now()>=saved.expiresAt||!matchesToken(ticket,saved.hash))return undefined;
        await this.ctx.storage.delete('browserTicket');
        const token=issueToken();await this.ctx.storage.put('browserHash',hashToken(token));
        return {session:s,token};
      }
      const cookie=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith('visulia_'+s.id+'='))?.split('=')[1];
      const hash=await this.ctx.storage.get<string>('browserHash');
      if(!cookie||!hash||!matchesToken(cookie,hash))return undefined;
      return {session:s,token:undefined};
    });
    if(!result)return denied();
    if(await this.env.STACKS.getByName(result.session.id).isStopped()){await this.close('container_stopped');return denied();}
    if(exchange){
      const response=json({ready:true});
      response.headers.set('set-cookie',`visulia_${result.session.id}=${result.token}; Path=/s/${result.session.id}/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((result.session.maxExpiresAt-Date.now())/1000))}`);
      return response;
    }
    return this.env.STACKS.getByName(result.session.id).proxy(request);
  }
  async handle(request:Request, action:string):Promise<Response> {
    const token=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
    const current=await this.ctx.storage.get<Session>('session');
    if(!current) return denied();
    try {authorize(current,token,Date.now());} catch{return denied();}
    if(current.state==='ready' && await this.env.STACKS.getByName(current.id).isStopped()) {
      await this.close('container_stopped');
      return denied();
    }
    const authorized=await this.ctx.blockConcurrencyWhile(async()=>{
      let s=await this.ctx.storage.get<Session>('session');
      if(!s) return undefined;
      try { authorize(s,token,Date.now()); } catch {return undefined;}
      if(action==='heartbeat') {
        s=heartbeat(s,token,Date.now());
        await this.ctx.storage.put('session',s);
        await this.ctx.storage.setAlarm(Math.min(s.idleExpiresAt,s.maxExpiresAt));
      }
      // Fence new requests before allowing another RPC to run.
      if(action==='delete') await this.ctx.storage.put('session',beginClose(s,'requested'));
      return s;
    });
    if(!authorized) return denied();
    if(action==='browser'){
      return this.ctx.blockConcurrencyWhile(async()=>{
        const s=await this.ctx.storage.get<Session>('session');
        if(!s)return denied();
        try{authorize(s,token,Date.now());}catch{return denied();}
        if(s.state!=='ready')return json({error:'NOT_READY'},409);
        const ticket=issueToken();
        await this.ctx.storage.put('browserTicket',{hash:hashToken(ticket),expiresAt:Math.min(Date.now()+60000,s.idleExpiresAt,s.maxExpiresAt)});
        return json({url:new URL(`/s/${s.id}/open#ticket=${ticket}`,request.url).href,expiresInSeconds:60});
      });
    }
    if(action==='proxy') {
      if(authorized.state!=='ready')return json({error:'NOT_READY'},409);
      const response=await this.env.STACKS.getByName(authorized.id).proxy(request);
      const location=response.headers.get('location');
      if(location?.startsWith('/')&&!location.startsWith('//')) {
        const headers=new Headers(response.headers);
        headers.set('location',`/v1/sessions/${authorized.id}/api${location}`);
        return new Response(response.body,{status:response.status,headers});
      }
      return response;
    }
    if(action==='delete') {
      await this.close('requested');
      const result=await this.ctx.storage.get<Session>('session');
      return json({state:result?.state??'deleted'},!result||result.state==='deleted'?200:202);
    }
    const {tokenHash: _secret,...publicSession}=authorized;
    return json(publicSession);
  }
}

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    try {
      const path=new URL(request.url).pathname;
      if(path==='/health' && request.method==='GET') return json({service:'VISULIA',status:'ok'});
      if(path==='/v1/sessions') {
        if(request.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
        const ip=request.headers.get('CF-Connecting-IP');
        if(!ip || !env.CLIENT_HASH_SALT) return json({error:'CONFIGURATION'},503);
        const client=hashToken(env.CLIENT_HASH_SALT+'\0'+ip);
        const reservation=await registry(env).reserve(client);
        if('error' in reservation) return json({error:reservation.error},reservation.status);
        const token=issueToken();
        try { await env.SESSIONS.getByName(reservation.id).initialize(reservation.id,hashToken(token)); }
        catch {
          // Reservation remains held if cleanup fails; the registry alarm retries.
          try { await env.SESSIONS.getByName(reservation.id).closeOrphan(reservation.id); } catch { /* retained */ }
          return json({error:'PROVISION_FAILED'},503);
        }
        return json({id:reservation.id,token,heartbeatSeconds:30},201);
      }
      const browser=/^\/s\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/(open|exchange|kibana(?:\/.*)?)$/.exec(path);
      if(browser){
        if(browser[2]==='open')return request.method==='GET'?browserLanding(browser[1]!):json({error:'METHOD_NOT_ALLOWED'},405);
        if(browser[2]==='exchange'&&request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
        return await env.SESSIONS.getByName(browser[1]!).browser(request,browser[2]==='exchange');
      }
      const match=/^\/v1\/sessions\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\/heartbeat|\/browser|\/api\/.*)?$/.exec(path);
      if(!match) return json({error:'NOT_FOUND'},404);
      if(match[2]?.startsWith('/api/')) {
        const target=new URL(request.url);
        target.pathname=match[2].slice('/api'.length);
        return await env.SESSIONS.getByName(match[1]!).handle(new Request(target,request),'proxy');
      }
      const action=match[2]?(request.method==='POST'?(match[2]==='/browser'?'browser':'heartbeat'):undefined):
        request.method==='GET'?'status':request.method==='DELETE'?'delete':undefined;
      if(!action) return json({error:'METHOD_NOT_ALLOWED'},405);
      return await env.SESSIONS.getByName(match[1]!).handle(request,action);
    } catch {return json({error:'UNAVAILABLE'},503);}
  },
};
