import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RunManager,type RunIO,type RunConfig} from '../../src/agent/runs.js';
const config:RunConfig={metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8'))};
const bytes=new TextEncoder().encode('valid-line\n');
async function fixture(t:{after(callback:()=>Promise<void>):void}){
 const root=await mkdtemp(join(tmpdir(),'visulia-runs-'));const abort=new AbortController();
 t.after(async()=>{abort.abort();await rm(root,{recursive:true,force:true});});
 const events:string[]=[];let valid=true;
 const io:RunIO={
  async check(input){return {valid,accepted:valid?input.lines.length:0,rejected:valid?0:input.lines.length,total:input.lines.length};},
  async probe(){events.push('probe');},async createIndex(name){events.push('create:'+name);},async deleteIndex(name){events.push('delete:'+name);},
  async start(path){assert.equal(JSON.parse(await readFile(path,'utf8')).sinks.elasticsearch.auth.password,'test-secret');events.push('start');return async()=>{events.push('stop');};},
 };
 return {root,abort,events,io,setValid(value:boolean){valid=value;},manager:new RunManager({root,signal:abort.signal,io,elasticsearch:{url:'http://127.0.0.1:9200',username:'test-user',password:'test-secret'}})};
}
test('ingest requires successful check of current config and current upload',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 await f.manager.upload(run.id,bytes);
 await assert.rejects(f.manager.ingest(run.id),/CHECK_REQUIRED/);
 f.setValid(false);assert.equal((await f.manager.check(run.id)).check?.valid,false);
 await assert.rejects(f.manager.ingest(run.id),/CHECK_REQUIRED/);
 assert.equal(f.events.some(e=>e.startsWith('create:')),false);
 f.setValid(true);await f.manager.check(run.id);
 await f.manager.update(run.id,{...config,metadata:{...config.metadata,environment:'changed'}});
 await assert.rejects(f.manager.ingest(run.id),/CHECK_REQUIRED/);
 await f.manager.check(run.id);await f.manager.upload(run.id,bytes);
 await assert.rejects(f.manager.ingest(run.id),/CHECK_REQUIRED/);
 await f.manager.check(run.id);assert.equal((await f.manager.ingest(run.id)).state,'ingesting');
 await assert.rejects(f.manager.upload(run.id,bytes),/RUN_ACTIVE/);
 const stopped=await f.manager.stop(run.id);assert.equal(stopped.state,'stopped');
 assert.equal(JSON.stringify(stopped).includes('test-secret'),false);
});
test('reparse stops old ingest, rechecks before deleting data, and starts from a fresh checkpoint',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 await f.manager.upload(run.id,bytes);await f.manager.check(run.id);await f.manager.ingest(run.id);
 f.setValid(false);await assert.rejects(f.manager.reparse(run.id),/CHECK_REQUIRED/);
 assert.equal(f.events.some(e=>e.startsWith('delete:')),false);
 f.setValid(true);const replay=await f.manager.reparse(run.id);
 assert.equal(replay.state,'ingesting');
 assert(f.events.indexOf('stop')<f.events.indexOf('delete:visulia-'+run.id));
 assert.equal(f.events.at(-1),'start');
 await f.manager.stop(run.id);
});
test('unsafe IDs, excess capacity, bad encoding and oversized lines fail before work',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 await assert.rejects(f.manager.upload('../outside',bytes),/RUN_NOT_FOUND/);
 await assert.rejects(f.manager.upload(run.id,Uint8Array.from([0xff])),/INVALID_LOG_INPUT/);
 await assert.rejects(f.manager.upload(run.id,new TextEncoder().encode('x'.repeat(65537))),/INVALID_LOG_INPUT/);
 await f.manager.create(config);await f.manager.create(config);
 await assert.rejects(f.manager.create(config),/RUN_CAPACITY/);
 f.abort.abort();await assert.rejects(f.manager.check(run.id),/SESSION_STOPPED/);
});
test('an ingest process that exits during startup never becomes ready',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 await f.manager.upload(run.id,bytes);await f.manager.check(run.id);
 f.io.start=async(_path,onExit)=>{onExit();return async()=>{};};
 await assert.rejects(f.manager.ingest(run.id),/INGEST_EXITED/);
});
test('a queued upload invalidates an in-flight successful check before ingest can proceed',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 await f.manager.upload(run.id,bytes);
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 f.io.check=async()=>{enter();await gate;return {valid:true,accepted:1,rejected:0,total:1};};
 const checking=f.manager.check(run.id);await entered;
 const uploading=f.manager.upload(run.id,bytes);
 release();await checking;await uploading;
 await assert.rejects(f.manager.ingest(run.id),/CHECK_REQUIRED/);
 assert.equal(f.events.some(e=>e.startsWith('create:')),false);
});
test('uncertain index creation is fenced until explicit reparse cleans up the intended index',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 await f.manager.upload(run.id,bytes);await f.manager.check(run.id);
 const create=f.io.createIndex;
 f.io.createIndex=async()=>{throw new Error('NETWORK_FAILED');};
 await assert.rejects(f.manager.ingest(run.id),/NETWORK_FAILED/);
 f.io.createIndex=create;
 await assert.rejects(f.manager.ingest(run.id),/REPARSE_REQUIRED/);
 await f.manager.reparse(run.id);
 assert.equal(f.events.includes('delete:visulia-'+run.id),true);
 await f.manager.stop(run.id);
});

test('uploads preserve original bytes but feed exactly the preflight line representation',async t=>{
 const f=await fixture(t);const run=await f.manager.create(config);
 for(const source of ['first\nlast','first\r\nlast\r\n','\ufefffirst\r\nlast']){
  const original=new TextEncoder().encode(source);
  await f.manager.upload(run.id,original);
  assert.equal(await readFile(join(f.root,run.id,'input','upload.log'),'utf8'),'first\nlast\n');
  assert.deepEqual(new Uint8Array(await readFile(join(f.root,run.id,'source-upload.bin'))),original);
  assert.equal(f.manager.get(run.id).bytes,11);
 }
});

test('demo streams server lines into its run, reserves edits, and stops on request',async t=>{
 const f=await fixture(t);let publish!:(line:string)=>Promise<void>,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const manager=new RunManager({root:f.root,signal:f.abort.signal,io:f.io,elasticsearch:{url:'http://127.0.0.1:9200',username:'test-user',password:'test-secret'},demo:async(_options,line,signal)=>{publish=line;entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));}});
 const run=await manager.create(config);
 await manager.startDemo(run.id,{scenario:'mixed',count:4,rate:5});await ready;
 await assert.rejects(manager.upload(run.id,bytes),/RUN_ACTIVE/);
 await assert.rejects(manager.check(run.id),/RUN_ACTIVE/);
 await publish('actual-server-line');
 assert.equal(await readFile(join(f.root,run.id,'input','upload.log'),'utf8'),'actual-server-line\n');
 assert.equal(manager.get(run.id).demo?.received,1);
 await manager.stop(run.id);
 await assert.rejects(publish('late-line'),/DEMO_STOPPED/);
});
test('demo can append to an already checked live ingest without invalidating its configuration',async t=>{
 const f=await fixture(t);let finished!:()=>void;
 const done=new Promise<void>(resolve=>{finished=resolve;});
 const manager=new RunManager({root:f.root,signal:f.abort.signal,io:f.io,elasticsearch:{url:'http://127.0.0.1:9200',username:'test-user',password:'test-secret'},demo:async(_options,line)=>{await line('new-live-line');finished();}});
 const run=await manager.create(config);await manager.upload(run.id,bytes);await manager.check(run.id);const before=await manager.ingest(run.id);
 await manager.startDemo(run.id,{scenario:'normal',count:1,rate:1});await done;
 assert.equal(manager.get(run.id).revision,before.revision);
 assert.equal(manager.get(run.id).state,'ingesting');
 await manager.stop(run.id);
});
test('reparse cancels a live demo before checking its completed records',async t=>{
 const f=await fixture(t);let entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const manager=new RunManager({root:f.root,signal:f.abort.signal,io:f.io,elasticsearch:{url:'http://127.0.0.1:9200',username:'test-user',password:'test-secret'},demo:async(_options,line,signal)=>{await line('actual-line');entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));}});
 const run=await manager.create(config);
 await manager.startDemo(run.id,{scenario:'normal',count:100,rate:1});await ready;
 assert.equal((await manager.reparse(run.id)).state,'ingesting');
 await manager.stop(run.id);
});
test('reparse fences a queued demo append without waiting on its own mutation queue',async t=>{
 const f=await fixture(t);let publish!:(line:string)=>Promise<void>,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const manager=new RunManager({root:f.root,signal:f.abort.signal,io:f.io,elasticsearch:{url:'http://127.0.0.1:9200',username:'test-user',password:'test-secret'},demo:async(_options,line,signal)=>{publish=line;entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));}});
 const run=await manager.create(config);await manager.upload(run.id,bytes);
 await manager.startDemo(run.id,{scenario:'normal',count:100,rate:1});await ready;
 const reparse=manager.reparse(run.id),late=assert.rejects(publish('too-late'),/DEMO_STOPPED/);
 assert.equal((await reparse).state,'ingesting');await late;
 assert.equal(await readFile(join(f.root,run.id,'input','upload.log'),'utf8'),'valid-line\n');
 await manager.stop(run.id);
});
