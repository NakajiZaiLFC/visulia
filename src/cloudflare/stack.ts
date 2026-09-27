import { Container } from '@cloudflare/containers';
import type { Env } from './control.js';

/** One VM per session. Public traffic never reaches the inherited auto-start fetch. */
export class Stack extends Container<Env> {
  defaultPort = 8081;
  requiredPorts = [8081];
  sleepAfter = '35m';
  enableInternet = false;
  private startup: Promise<void> | undefined;

  async boot(id:string):Promise<void> {
    if(await this.ctx.storage.get('closed')) throw new Error('CLOSED');
    if(await this.ctx.storage.get('started')) throw new Error('ALREADY_STARTED');
    const agentToken=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
    await this.ctx.storage.put({started:true,sessionId:id,agentToken});
    this.startup=this.startAndWaitForPorts({
      ports:[8081],
      startOptions:{envVars:{VISULIA_SESSION_ID:id,VISULIA_AGENT_TOKEN:agentToken},enableInternet:false},
      cancellationOptions:{portReadyTimeoutMS:240_000},
    });
    try {
      await this.startup;
      if(await this.ctx.storage.get('closed')) { await this.destroy(); throw new Error('CLOSED'); }
    } finally { this.startup=undefined; }
  }
  async remove():Promise<void> {
    await this.ctx.storage.put('closed',true);
    await this.destroy();
    // Boot may have passed its check before remove persisted its tombstone.
    if(this.startup) { try {await this.startup;} catch { /* failed boot also needs destruction */ } }
    await this.destroy();
    await this.ctx.storage.delete('agentToken');
  }
  override async onStart() {
    if(await this.ctx.storage.get('closed')) await this.destroy();
  }
  override async onActivityExpired() { await this.remove(); }
  override async onStop() {
    const alreadyClosed=await this.ctx.storage.get('closed');
    await this.ctx.storage.put('closed',true);
    await this.ctx.storage.delete('agentToken');
    const id=await this.ctx.storage.get<string>('sessionId');
    if(!alreadyClosed && id) {
      // Awaiting here would deadlock with destroy() in the receiving controller.
      // The persisted tombstone is also checked on status/heartbeat if delivery fails.
      this.ctx.waitUntil(this.env.SESSIONS.getByName(id).containerStopped().catch(()=>{}));
    }
  }
  async isStopped():Promise<boolean> {
    return Boolean(await this.ctx.storage.get('closed')) || !this.ctx.container?.running;
  }
  async proxy(request:Request):Promise<Response> {
    if(await this.ctx.storage.get('closed') || !this.ctx.container?.running) {
      return new Response('Session stopped',{status:410});
    }
    // Direct port access cannot auto-start a stopped container.
    const agentToken=await this.ctx.storage.get<string>('agentToken');
    if(!agentToken)return new Response('Session stopped',{status:410});
    const headers=new Headers(request.headers);
    headers.set('authorization','Bearer '+agentToken);
    headers.delete('cookie');
    return this.ctx.container.getTcpPort(8081).fetch(new Request(request,{headers}));
  }
  override async fetch():Promise<Response> { return new Response('Not found',{status:404}); }
}
