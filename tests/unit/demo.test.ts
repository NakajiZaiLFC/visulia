import test from 'node:test';
import assert from 'node:assert/strict';
import {generateDemo,type DemoRecord} from '../../src/agent/demo.js';
test('generator addresses only its TomEE, uses unique IDs, and records actual HTTP outcomes',async()=>{
 const seen:string[]=[],records:DemoRecord[]=[];
 const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));assert.equal(url.origin,'http://127.0.0.1:8080');
  seen.push(url.pathname);
  assert.match(new Headers(init?.headers).get('X-Visulia-Request-Id')!,/^[a-f0-9-]{36}$/);
  return new Response('demo',{status:url.pathname.endsWith('/error')?500:url.pathname.endsWith('/missing')?404:200});
 }) as typeof fetch;
 await generateDemo({runId:'run-001',scenario:'mixed',count:4,rate:5},async r=>{records.push(r);},new AbortController().signal,fetcher);
 assert.deepEqual(seen,['/demo/ok','/demo/missing','/demo/error','/demo/slow']);
 assert.deepEqual(records.map(r=>r.status),[200,404,500,200]);assert.equal(new Set(records.map(r=>r.id)).size,4);
});
test('invalid limits and scenario fail before any request; cancellation stops generation',async()=>{
 let calls=0;const controller=new AbortController();
 const fetcher=(async()=>{calls++;controller.abort();return new Response('ok');}) as typeof fetch;
 for(const change of [{count:0},{count:1801},{rate:0},{rate:6},{scenario:'https://example.org'}]) {
  await assert.rejects(()=>generateDemo({runId:'run-001',scenario:'normal',count:2,rate:5,...change} as any,async()=>{},controller.signal,fetcher),/INVALID_DEMO/);
 }
 assert.equal(calls,0);
 await generateDemo({runId:'run-001',scenario:'normal',count:20,rate:5},async()=>{},controller.signal,fetcher);
 assert.equal(calls,1);
});
