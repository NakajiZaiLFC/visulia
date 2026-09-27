import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {waitForReady} from '../../src/agent/readiness.js';

test('readiness retries unavailable and false-positive health responses before accepting healthy JSON',async()=>{
 let count=0;
 const server=createServer((req,res)=>{
  assert.equal(req.headers.authorization,'Basic test');
  count++;
  if(count===1){res.writeHead(503);res.end('not ready');}
  else if(count===2){res.end('invalid JSON');}
  else res.end(JSON.stringify({ready:count>=4}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const addr=server.address();assert(addr&&typeof addr!=='string');
 try{
  await waitForReady(`http://127.0.0.1:${addr.port}`,body=>!!body&&typeof body==='object'&&'ready'in body&&body.ready===true,new AbortController().signal,'Basic test',2000,5);
  assert.equal(count,4);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('readiness cannot follow a redirect carrying service credentials and has a bounded timeout',async()=>{
 let redirected=0;
 const server=createServer((req,res)=>{
  if(req.url==='/target')redirected++;
  res.writeHead(302,{Location:'/target'});res.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const addr=server.address();assert(addr&&typeof addr!=='string');
 try{
  await assert.rejects(waitForReady(`http://127.0.0.1:${addr.port}`,()=>true,new AbortController().signal,'Basic secret',100,5),/SERVICE_NOT_READY/);
  assert.equal(redirected,0);
  const abort=new AbortController();abort.abort();
  await assert.rejects(waitForReady(`http://127.0.0.1:${addr.port}`,()=>true,abort.signal),/SERVICE_NOT_READY/);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
