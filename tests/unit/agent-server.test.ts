import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {serveAgent} from '../../src/agent/server.js';
test('agent listener transports request and response and closes its port on revocation',async()=>{
 const abort=new AbortController();
 const server=await serveAgent(async request=>Response.json({path:new URL(request.url).pathname,auth:request.headers.get('authorization'),body:await request.text()}),abort.signal,0,'127.0.0.1');
 const address=server.address();assert(address&&typeof address!=='string');
 const origin=`http://127.0.0.1:${address.port}`;
 try{
  const response=await fetch(origin+'/test',{method:'POST',headers:{authorization:'Bearer example'},body:'payload'});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{path:'/test',auth:'Bearer example',body:'payload'});
  const closed=once(server,'close');abort.abort();await closed;
  await assert.rejects(fetch(origin));
 }finally{abort.abort();server.closeAllConnections();server.close();}
});
test('oversized request is rejected before the handler; handler exceptions are sanitized',async()=>{
 const abort=new AbortController();let calls=0;
 const server=await serveAgent(async()=>{calls++;throw new Error('sensitive-path');},abort.signal,0,'127.0.0.1');
 const address=server.address();assert(address&&typeof address!=='string');
 const origin=`http://127.0.0.1:${address.port}`;
 try{
  const large=await fetch(origin,{method:'POST',body:Buffer.alloc(10*1024*1024+1)});
  assert.equal(large.status,413);await large.body?.cancel();assert.equal(calls,0);
  const failed=await fetch(origin);
  assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'INTERNAL_ERROR'});
 }finally{const closed=once(server,'close');abort.abort();await closed;}
});
