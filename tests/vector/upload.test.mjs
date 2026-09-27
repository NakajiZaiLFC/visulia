import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {RunManager} from '../../dist/src/agent/runs.js';
import {checkLogs} from '../../dist/src/pipeline/check.js';
import {createPipeline} from '../../dist/src/pipeline/config.js';

test('real file source parses uploads with CRLF, BOM and no final newline exactly as preflight', {timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-upload-')),abort=new AbortController();
 let child;
 t.after(async()=>{
  abort.abort();
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);try{await ended;}finally{clearTimeout(timer);}}
  await rm(root,{recursive:true,force:true});
 });
 const elasticsearch={url:'http://127.0.0.1:9200',username:'test',password:'test'};
 const config={parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8')),metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'}};
 const manager=new RunManager({root,signal:abort.signal,elasticsearch,io:{check:input=>checkLogs(input,abort.signal,process.env.VECTOR_BIN),async probe(){},async createIndex(){},async deleteIndex(){},async start(){throw new Error('unused');}}});
 const run=await manager.create(config);
 const row=id=>`2026-09-27T03:00:00.000Z|GET|/demo/ok|200|1234|${id}`;
 await manager.upload(run.id,Buffer.from('\ufeff'+row('first')+'\r\n'+row('last')));
 assert.equal((await manager.check(run.id)).check.accepted,2);
 const pipeline=createPipeline({...config,runId:run.id,directory:join(root,run.id),elasticsearch});
 // Exercise the production file source and transforms, without the unrelated disk sink race.
 pipeline.sources.raw.acknowledgements={enabled:false};
 pipeline.sinks={output:{type:'console',inputs:['identify'],encoding:{codec:'json'}},rejected:{type:'console',inputs:['parse.dropped','guard.dropped'],encoding:{codec:'json'}}};
 const path=join(root,'source.json');await writeFile(path,JSON.stringify(pipeline));
 child=spawn(process.env.VECTOR_BIN??'vector',['--config',path],{stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
 for(let i=0;i<100&&output.trim().split('\n').filter(Boolean).length<2;i++){
  if(child.exitCode!==null)throw new Error(errors);await delay(100);
 }
 const docs=output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 assert.equal(docs.length,2,errors);
 assert.deepEqual(docs.map(doc=>doc.event.id).sort(),['first','last']);
 assert(docs.every(doc=>!doc.event.original.includes('\r')&&!doc.event.original.includes('\ufeff')));
});
