import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';

test('delete overlapping a slow boot leaves the VM stopped and permanently fenced',async t=>{
  const result=await build({stdin:{contents:`import {DurableObject} from 'cloudflare:workers';
    export class Recorder extends DurableObject {
      async containerStopped(){await this.ctx.storage.put('stopped',true);}
      async notified(){return Boolean(await this.ctx.storage.get('stopped'));}
    }
    import {Stack} from './src/cloudflare/stack.ts';
    export class TestStack extends Stack {
      async begin(id='session'){this.ctx.waitUntil(this.boot(id).catch(()=>{}));}
      async proxyResult(){const result=await this.proxy(new Request('https://internal/health',{headers:{authorization:'Bearer owner-token',cookie:'owner-cookie'}}));return {status:result.status,body:await result.text()};}
      async stopSpontaneously(){await this.destroy();}
      async removeInBackground(){this.ctx.waitUntil(this.remove());}
      async bootResult(){try{await this.boot('session');return 'accepted';}catch(e){return e.message;}}
    }
    export default {fetch(){return new Response('ok')}};`,resolveDir:process.cwd()},write:false,bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers'],alias:{'@cloudflare/containers':resolve('tests/cloudflare/container-double.ts')}});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-09-27',durableObjects:{STACKS:{className:'TestStack',useSQLite:true},SESSIONS:{className:'Recorder',useSQLite:true}}}));
  t.after(()=>mf.dispose());
  const {STACKS,SESSIONS}=await mf.getBindings();const stack=STACKS.getByName('session');
  await stack.begin();
  let bootState;
  for(let i=0;i<20;i++){bootState=await stack.inspect();if(bootState.options)break;}
  assert.match(bootState.options.startOptions.envVars.VISULIA_AGENT_TOKEN,/^[a-f0-9]{64}$/);
  assert.equal(bootState.options.startOptions.envVars.VISULIA_AGENT_TOKEN,bootState.agentToken);
  await stack.removeInBackground();
  assert.equal((await stack.inspect()).closed,true);
  await stack.finishBoot();
  // RPC storage read yields behind boot's post-start tombstone check.
  let state;
  for(let i=0;i<20;i++){state=await stack.inspect();if(state.destroys>=3&&!state.running)break;}
  assert.equal(state.running,false);assert.ok(state.destroys>=3);
  assert.equal(state.agentToken,undefined);
  assert.equal(await stack.bootResult(),'CLOSED');
  assert.equal((await stack.fetch('https://internal/')).status,404);
  const second=STACKS.getByName('second');await second.begin('second');await second.finishBoot();
  for(let i=0;i<20;i++){if((await second.inspect()).running)break;}
  const live=await second.inspect();
  const proxied=await second.proxyResult();
  assert.equal(proxied.status,200);
  assert.deepEqual(JSON.parse(proxied.body),{authorization:'Bearer '+live.agentToken,cookie:null,port:8081});
  await second.stopSpontaneously();
  assert.equal((await second.proxyResult()).status,410);
  const receiver=SESSIONS.getByName('second');
  let notified=false;
  for(let i=0;i<20;i++){notified=await receiver.notified();if(notified)break;}
  assert.equal(notified,true,'spontaneous stop notifies its controller without a client heartbeat');
});
