import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function runtime(t, maximum='3', bindings={}) {
  const dir=await mkdtemp(join(tmpdir(),'visulia-worker-'));
  const bundle=join(dir,'worker.mjs');
  await build({stdin:{contents:`export {default, Registry, SessionController} from './src/cloudflare/control.ts'; export {TestStack,TestSession,TestRegistry} from './tests/cloudflare/stack-double.ts';`,resolveDir:process.cwd()},outfile:bundle,keepNames:true,bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(bundle,"utf8"),compatibilityDate:'2026-09-27',compatibilityFlags:['nodejs_compat'],
    durableObjects:{REGISTRY:{className:'TestRegistry',useSQLite:true},SESSIONS:{className:'TestSession',useSQLite:true},STACKS:{className:'TestStack',useSQLite:true}},
    bindings:{MAX_SESSIONS:maximum,CLIENT_HASH_SALT:'test-only-salt',...bindings}}));
  t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
  const send=(path, method='GET', token, body, ip='192.0.2.1')=>mf.dispatchFetch('https://visulia.example'+path,{method,redirect:'manual',headers:{'CF-Connecting-IP':ip,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {mf,send};
}

test('Worker creates independent authenticated sessions and stops only the owner', async t=>{
  const {send}=await runtime(t);
  const response=await send('/v1/sessions','POST'); assert.equal(response.status,201);
  const a=await response.json(); assert.match(a.id,/^[a-f0-9-]{36}$/); assert.equal(typeof a.token,'string');
  const b=await (await send('/v1/sessions','POST',undefined,undefined,'192.0.2.2')).json();
  assert.notEqual(a.id,b.id);assert.notEqual(a.token,b.token);
  assert.equal((await send(`/v1/sessions/${a.id}`)).status,401);
  assert.equal((await send(`/v1/sessions/${a.id}`,'GET',b.token)).status,401);
  const status=await (await send(`/v1/sessions/${a.id}`,'GET',a.token)).json();
  assert.equal(status.id,a.id);assert.equal('tokenHash' in status,false);
  assert.equal((await send(`/v1/sessions/${a.id}`,'DELETE',b.token)).status,401);
  assert.equal((await send(`/v1/sessions/${a.id}`,'DELETE',a.token)).status,200);
  assert.equal((await send(`/v1/sessions/${a.id}/heartbeat`,'POST',a.token)).status,401);
  assert.equal((await send(`/v1/sessions/${b.id}`,'GET',b.token)).status,200);
});

test('capacity and per-client cooldown are enforced before allocating a stack', async t=>{
  const {send}=await runtime(t,'1');
  const a=await (await send('/v1/sessions','POST')).json();
  assert.equal((await send('/v1/sessions','POST')).status,429);
  assert.equal((await send('/v1/sessions','POST',undefined,undefined,'192.0.2.2')).status,503);
  await send(`/v1/sessions/${a.id}`,'DELETE',a.token);
  assert.equal((await send('/v1/sessions','POST',undefined,undefined,'192.0.2.2')).status,201);
});

test('routing denies arbitrary paths and never exposes internal control methods',async t=>{
  const {send}=await runtime(t);
  for(const path of ['/internal/remove','/v1/sessions/bad','/v1/sessions','/metrics']) {
    const response=await send(path); assert.ok([404,405].includes(response.status));
  }
  assert.equal((await send('/health')).status,200);
});

test('failed destruction holds capacity, rejects access, and retries until data is purged',async t=>{
  const {mf,send}=await runtime(t,'1');
  const a=await (await send('/v1/sessions','POST')).json();
  const {STACKS,SESSIONS}=await mf.getBindings();
  const stack=STACKS.getByName(a.id), session=SESSIONS.getByName(a.id);
  await stack.failRemoval();
  assert.equal((await send(`/v1/sessions/${a.id}`,'DELETE',a.token)).status,202);
  assert.equal((await send(`/v1/sessions/${a.id}`,'GET',a.token)).status,401);
  assert.equal((await send('/v1/sessions','POST',undefined,undefined,'192.0.2.3')).status,503);
  await stack.allowRemoval();await session.retryCleanup();
  assert.equal(await session.hasSessionData(),false);
  assert.equal((await send('/v1/sessions','POST',undefined,undefined,'192.0.2.3')).status,201);
});

test('idle expiry closes without a connected client and cannot be revived',async t=>{
  const {mf,send}=await runtime(t);
  const a=await (await send('/v1/sessions','POST')).json();
  const {SESSIONS}=await mf.getBindings();
  const session=SESSIONS.getByName(a.id);
  await session.expire();
  assert.equal((await send(`/v1/sessions/${a.id}/heartbeat`,'POST',a.token)).status,401);
  assert.equal(await session.hasSessionData(),false);
  assert.equal(await session.initializeResult(a.id),'ALREADY_INITIALIZED');
});

test('parallel admissions never exceed capacity',async t=>{
  const {send}=await runtime(t,'2');
  const results=await Promise.all(Array.from({length:8},(_,i)=>send('/v1/sessions','POST',undefined,undefined,`192.0.2.${i+1}`)));
  assert.equal(results.filter(r=>r.status===201).length,2);
  assert.equal(results.filter(r=>r.status===503).length,6);
});

test('a crashed stack cannot remain ready or extend the session',async t=>{
  const {mf,send}=await runtime(t,'1');
  const a=await (await send('/v1/sessions','POST')).json();
  for(let i=0;i<20;i++) {
    const s=await (await send(`/v1/sessions/${a.id}`,'GET',a.token)).json();
    if(s.state==='ready') break;
  }
  const {STACKS}=await mf.getBindings();await STACKS.getByName(a.id).simulateCrash();
  assert.equal((await send(`/v1/sessions/${a.id}/heartbeat`,'POST',a.token)).status,401);
  assert.equal((await send('/v1/sessions','POST',undefined,undefined,'192.0.2.4')).status,201);
});


test('new admissions preserve an earlier sweep and orphan cleanup fences delayed initialization',async t=>{
  const {mf,send}=await runtime(t,'3');
  const {REGISTRY,SESSIONS}=await mf.getBindings();
  const registry=REGISTRY.getByName('admission');
  const deadline=Date.now()+30_000;await registry.scheduleSweep(deadline);
  await send('/v1/sessions','POST');
  assert.equal(await registry.nextSweep(),deadline);
  const orphan=await registry.reserve('orphan-client');
  await registry.expireReservation(orphan.id);
  assert.equal(await SESSIONS.getByName(orphan.id).initializeResult(orphan.id),'ALREADY_INITIALIZED');
});

test('boot failure revokes the issued token and releases capacity after destruction',async t=>{
  const {mf,send}=await runtime(t,'1',{FAIL_BOOT:'1'});
  const a=await (await send('/v1/sessions','POST')).json();
  const {SESSIONS}=await mf.getBindings();
  // Wait for the background provisioning failure through serialized storage reads.
  for(let i=0;i<30;i++) {
    if(!await SESSIONS.getByName(a.id).hasSessionData()) break;
  }
  assert.equal((await send(`/v1/sessions/${a.id}`,'GET',a.token)).status,401);
  assert.equal((await send('/v1/sessions','POST',undefined,undefined,'192.0.2.9')).status,201);
});

test('session API forwards only for the ready owner and retains method, query and body',async t=>{
 const {send,mf}=await runtime(t);
 const a=await (await send('/v1/sessions','POST')).json();
 const b=await (await send('/v1/sessions','POST',undefined,undefined,'192.0.2.2')).json();
 for(let i=0;i<20;i++){if((await (await send(`/v1/sessions/${a.id}`,'GET',a.token)).json()).state==='ready')break;}
 const path=`/v1/sessions/${a.id}/api/elasticsearch/_query?format=json`;
 assert.equal((await send(path,'POST',b.token,{query:'FROM visulia-*'})).status,401);
 const response=await send(path,'POST',a.token,{query:'FROM visulia-*'});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{service:'stack-double',path:'/elasticsearch/_query',query:'?format=json',method:'POST',body:'{"query":"FROM visulia-*"}'});
 const redirected=await send(`/v1/sessions/${a.id}/api/s/${a.id}/kibana/login-redirect`,'GET',a.token);
 assert.equal(redirected.status,302);
 assert.equal(redirected.headers.get('location'),`/v1/sessions/${a.id}/api/s/${a.id}/kibana/app/home`);
 const followed=await send(redirected.headers.get('location'),'GET',a.token);
 assert.equal(followed.status,200);
 assert.equal((await followed.json()).path,`/s/${a.id}/kibana/app/home`);
 const {SESSIONS}=await mf.getBindings();await SESSIONS.getByName(a.id).setProvisioning();
 assert.equal((await send(path,'POST',a.token,{query:'FROM visulia-*'})).status,409);
 await send(`/v1/sessions/${a.id}`,'DELETE',a.token);
 assert.equal((await send(path,'POST',a.token,{query:'FROM visulia-*'})).status,401);
});
