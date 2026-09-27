import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateCapturedDemo} from '../../src/agent/captured-demo.js';
test('captured generator forwards server bytes correlated to each actual request ID',async t=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-generated-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'access.log'),received:string[]=[];
 const fetcher=(async(_url:RequestInfo|URL,init?:RequestInit)=>{
  const id=new Headers(init?.headers).get('X-Visulia-Request-Id');
  await appendFile(path,'unrelated\n'+'server-generated-timestamp|GET|/demo/error|500|4321|'+id+'\n');
  return new Response('server error',{status:500});
 }) as typeof fetch;
 await generateCapturedDemo({runId:'run-1',scenario:'errors',count:2,rate:5},async line=>{received.push(line);},new AbortController().signal,path,fetcher);
 assert.equal(received.length,2);assert.notEqual(received[0],received[1]);
 assert(received.every(line=>line.startsWith('server-generated-timestamp|GET|/demo/error|500|4321|')));
});
