import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentHandler} from '../../src/agent/http.js';
import {createRuntimeConfig} from '../../src/agent/runtime-config.js';
const config=createRuntimeConfig('aabbccdd-1111-2222-3333-001122334455');
const token='a'.repeat(64);
const request=(path:string,credential=token)=>new Request('http://agent'+path,{headers:{authorization:'Bearer '+credential}});
test('agent authenticates before health, credentials or service routing and revokes on shutdown',async()=>{
 const abort=new AbortController();
 let called=false;
 const handler=createAgentHandler(config,token,abort.signal,async()=>{called=true;return new Response();});
 assert.equal((await handler(request('/health','b'.repeat(64)))).status,401);
 assert.equal((await handler(request('/elasticsearch/_query',''))).status,401);
 assert.equal(called,false);
 assert.equal((await handler(request('/health'))).status,200);
 const credentials=await (await handler(request('/credentials'))).json();
 assert.deepEqual(credentials,{username:config.secrets.username,password:config.secrets.password,kibanaPath:config.basePath});
 abort.abort();
 assert.equal((await handler(request('/health'))).status,410);
});
test('service proxy uses only session user credentials and fixed destinations, preserves response streaming',async()=>{
 const seen:Request[]=[];
 const handler=createAgentHandler(config,token,new AbortController().signal,async(input,init)=>{
  const req=new Request(input,init);seen.push(req);
  return new Response('result',{status:201,headers:{'content-type':'application/json','connection':'keep-alive','location':'http://127.0.0.1:5601'+config.basePath+'/app/home'}});
 });
 const response=await handler(new Request('http://agent/elasticsearch/_query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',cookie:'privileged=secret','x-forwarded-host':'evil.example'},body:'{"query":"FROM visulia-*"}'}));
 assert.equal(response.status,201);assert.equal(await response.text(),'result');
 assert.equal(seen[0]?.url,'http://127.0.0.1:9200/_query');
 assert.equal(seen[0]?.headers.get('authorization'),'Basic '+Buffer.from(config.secrets.username+':'+config.secrets.password).toString('base64'));
 assert.equal(seen[0]?.headers.get('cookie'),null);
 assert.equal(seen[0]?.headers.get('x-forwarded-host'),null);
 assert.equal(await seen[0]?.text(),'{"query":"FROM visulia-*"}');
 await handler(request(config.basePath+'/app/home'));
 assert.equal(seen[1]?.url,'http://127.0.0.1:5601'+config.basePath+'/app/home');
 assert.equal(response.headers.get('connection'),null);
 assert.equal(response.headers.get('location'),config.basePath+'/app/home');
 assert.equal((await handler(request('/elasticsearch//evil.example/'))).status,400);
 assert.equal((await handler(request('/unknown'))).status,404);
});
test('proxy errors omit internal URLs and credentials',async()=>{
 const handler=createAgentHandler(config,token,new AbortController().signal,async()=>{throw new Error('secret '+config.secrets.elastic);});
 const response=await handler(request('/elasticsearch/_query'));
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:'UPSTREAM_UNAVAILABLE'});
 assert.throws(()=>createAgentHandler(config,'short',new AbortController().signal),/INVALID_AGENT_TOKEN/);
});
