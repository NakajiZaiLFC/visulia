import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeRunIO} from '../../src/agent/run-io.js';
const index='visulia-aabbccdd-1111-2222-3333-001122334455';
test('run transport constrains index targets, uses user auth and treats missing deletion as idempotent',async()=>{
 const seen:Request[]=[];
 const io=new NodeRunIO('user','password',new AbortController().signal,async(input,init)=>{
  const request=new Request(input,init);seen.push(request);
  return request.method==='DELETE'?new Response('{}',{status:404}):Response.json({acknowledged:true});
 });
 await io.probe();await io.createIndex(index,{dynamic:'strict'});await io.deleteIndex(index);
 assert.deepEqual(seen.map(r=>[r.method,r.url]),[['GET','http://127.0.0.1:9200/'],['PUT','http://127.0.0.1:9200/'+index],['DELETE','http://127.0.0.1:9200/'+index]]);
 assert.equal(seen[1]?.headers.get('authorization'),'Basic '+Buffer.from('user:password').toString('base64'));
 assert.deepEqual(await seen[1]?.json(),{mappings:{dynamic:'strict'}});
 for(const bad of ['*','.security','visulia-*',index+'/_delete_by_query'])await assert.rejects(io.deleteIndex(bad),/INVALID_INDEX/);
 assert.equal(seen.length,3);
});
test('failed or unacknowledged index creation never reports success',async()=>{
 for(const reply of [new Response('private detail',{status:500}),Response.json({acknowledged:false})]){
  const io=new NodeRunIO('user','secret',new AbortController().signal,async()=>reply);
  await assert.rejects(io.createIndex(index,{}),error=>error instanceof Error&&error.message==='ELASTICSEARCH_FAILED');
 }
});
test('missing Vector executable fails startup instead of returning an ingest handle',async()=>{
 const io=new NodeRunIO('user','password',new AbortController().signal,fetch,'/missing/vector');
 await assert.rejects(io.start('/unused/config.json',()=>{}),/VECTOR_START_FAILED/);
});
