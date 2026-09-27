import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentHandler} from '../../src/agent/http.js';
import {createRuntimeConfig} from '../../src/agent/runtime-config.js';
import {RunManager} from '../../src/agent/runs.js';
const token='a'.repeat(64);
const config={metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8'))};
test('authenticated run API connects upload, check and ingest and returns structured state errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-run-api-'));const abort=new AbortController();let started=0;
 const manager=new RunManager({root,signal:abort.signal,elasticsearch:{url:'http://127.0.0.1:9200',username:'user',password:'secret'},io:{async probe(){},async check(input){return {valid:true,accepted:input.lines.length,rejected:0,total:input.lines.length};},async createIndex(){},async deleteIndex(){},async start(){started++;return async()=>{};}}});
 const handler=createAgentHandler(createRuntimeConfig('aabbccdd-1111-2222-3333-001122334455'),token,abort.signal,fetch,manager);
 const call=(path:string,method='GET',body?:string,credential=token)=>handler(new Request('http://agent'+path,{method,headers:{authorization:'Bearer '+credential},...(body===undefined?{}:{body})}));
 try{
  assert.equal((await call('/runs','POST',JSON.stringify(config),'wrong')).status,401);
  const response=await call('/runs','POST',JSON.stringify(config));assert.equal(response.status,201);
  const run=await response.json() as {id:string};
  assert.equal((await call('/runs')).status,200);
  assert.equal((await call('/runs/'+run.id)).status,200);
  const premature=await call('/runs/'+run.id+'/ingest','POST');assert.equal(premature.status,409);assert.deepEqual(await premature.json(),{error:'CHECK_REQUIRED'});
  const missing=await call('/runs/'+run.id+'/check','POST');assert.equal(missing.status,400);assert.deepEqual(await missing.json(),{error:'LOGS_REQUIRED'});
  assert.equal((await call('/runs/'+run.id+'/logs','PUT','line\n')).status,200);
  assert.equal((await call('/runs/'+run.id+'/check','POST')).status,200);
  assert.equal((await call('/runs/'+run.id+'/ingest','POST')).status,202);assert.equal(started,1);
  assert.equal((await call('/runs/'+run.id+'/config','PUT',JSON.stringify(config))).status,409);
  assert.equal((await call('/runs/'+run.id+'/stop','POST')).status,200);
  assert.equal((await call('/runs','POST','{invalid')).status,400);
  assert.equal((await call('/runs/'+run.id+'/check','GET')).status,405);
 }finally{abort.abort();await rm(root,{recursive:true,force:true});}
});
