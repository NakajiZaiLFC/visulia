import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,appendFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
async function stop(process) {
 if(process.exitCode!==null||process.signalCode!==null)return;
 const ended=once(process,'exit');process.kill('SIGTERM');
 const deadline=setTimeout(()=>process.kill('SIGKILL'),3000);
 try {await ended;}finally{clearTimeout(deadline);}
}
import {createPipeline} from '../../dist/src/pipeline/config.js';

test('real Vector tails files, isolates malformed lines and preserves distinct anonymous requests', {timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'visulia-pipeline-'));

 await Promise.all(['input','vector','quarantine'].map(p=>mkdir(join(directory,p))));
 const requests=[],documents=[];
 const server=createServer(async(req,res)=>{
   try {
     if(req.url?.startsWith('/_bulk')) {
       let body='';for await(const data of req)body+=data;
       const records=body.trim().split('\n').map(s=>JSON.parse(s));
       const items=[];
       for(let i=0;i<records.length;i+=2) {
         requests.push(records[i]);documents.push(records[i+1]);items.push({index:{status:201}});
       }
       res.setHeader('content-type','application/json');res.end(JSON.stringify({errors:false,items}));
     } else {res.setHeader('content-type','application/json');res.end(JSON.stringify({version:{number:'9.4.7'},status:'green'}));}
   } catch {res.statusCode=500;res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');

 const config=createPipeline({directory,runId:'run-001',metadata:{format:'common-v1',duration_unit:'none',service_name:'demo',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8')),elasticsearch:{url:`http://127.0.0.1:${server.address().port}`,username:'test',password:'test'}});
 if(process.env.VISULIA_VECTOR_DIAGNOSTICS){
 config.sources.metrics={type:'internal_metrics',scrape_interval_secs:1};
 config.sinks.metrics_out={type:'console',inputs:['metrics'],encoding:{codec:'json'}};
 }
 const configPath=join(directory,'vector.json');await writeFile(configPath,JSON.stringify(config));
 const line='127.0.0.1 - - [27/Sep/2026:03:00:00 +0000] "GET /demo/ok HTTP/1.1" 200 17\n';
 await writeFile(join(directory,'input','access.log'),line+line+'malformed\n');
 const vector=spawn(process.env.VECTOR_BIN??'vector',['--config',configPath],{stdio:['ignore','pipe','pipe']});
 let stderr='';vector.stdout.on('data',chunk=>{stderr=(stderr+chunk).slice(-150000);});vector.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-150000);});
 t.after(async()=>{
   await stop(vector);
   server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
   await rm(directory,{recursive:true,force:true});
 });
 async function until(condition) {
   for(let i=0;i<100;i++) {if(await condition())return;if(vector.exitCode!==null)throw new Error(stderr);await delay(100);}
   throw new Error('Timed out\n'+stderr);
 }
 await until(()=>documents.length===2);
 assert.notEqual(requests[0].index._id,requests[1].index._id,'identical requests must not collapse by content hash');
 assert.equal(documents[0]._visulia_id,undefined,'sink must remove its transport-only id field');
 assert.equal(documents[0].event.original,line.trim());
 assert.equal(requests[0].index._index,'visulia-run-001');
 await appendFile(join(directory,'input','access.log'),line.replace(' 200 ',' 404 '));
 await until(()=>documents.length===3);
 assert.equal(documents[2].http.response.status_code,404);
 await writeFile(join(directory,'input','second.log'),line+line.replace(' 200 ',' 500 '));
 await until(()=>documents.length===5);
 assert.equal(documents.filter(d=>d.http.response.status_code===500).length,1);
 await until(async()=>{
   const names=await readdir(join(directory,'quarantine'));
   if(!names.length)return false;
   const records=(await readFile(join(directory,'quarantine',names[0]),'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
   if(records.length!==1)return false;
   assert.equal(records[0].message,'malformed');
   assert.equal(records[0].metadata.run_id,'run-001');
   assert.equal(records[0].metadata.dropped.component_id,'parse');
   return true;
 });
});

test('real Vector resumes a disk buffer after a killed process and handles rename rotation', {timeout:45000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'visulia-recovery-'));
 let vector,server;
 t.after(async()=>{
   if(vector)await stop(vector);
   if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
   await rm(directory,{recursive:true,force:true});
 });
 await Promise.all(['input','vector','quarantine'].map(p=>mkdir(join(directory,p))));
 let unavailable=true,attempts=0;
 const documents=new Map();
 server=createServer(async(req,res)=>{
   if(req.url?.startsWith('/_bulk')) {
     let body='';for await(const data of req)body+=data;
     attempts++;
     if(unavailable){res.statusCode=503;res.end('temporary outage');return;}
     const records=body.trim().split('\n').map(s=>JSON.parse(s)),items=[];
     for(let i=0;i<records.length;i+=2){documents.set(records[i].index._id,records[i+1]);items.push({index:{status:201}});}
     res.setHeader('content-type','application/json');res.end(JSON.stringify({errors:false,items}));
   } else {res.setHeader('content-type','application/json');res.end(JSON.stringify({version:{number:'9.4.7'},status:'green'}));}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const config=createPipeline({directory,runId:'recovery',metadata:{format:'pipe-v1',duration_unit:'us',service_name:'demo',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8')),elasticsearch:{url:`http://127.0.0.1:${server.address().port}`,username:'test',password:'test'}});
 if(process.env.VISULIA_VECTOR_DIAGNOSTICS){
 config.sources.metrics={type:'internal_metrics',scrape_interval_secs:1};
 config.sinks.metrics_out={type:'console',inputs:['metrics'],encoding:{codec:'json'}};
 }
 const configPath=join(directory,'vector.json');await writeFile(configPath,JSON.stringify(config));
 const line=id=>`2026-09-27T03:00:00Z|GET|/demo/ok|200|1234|${id}\n`;
 const logPath=join(directory,'input','access.log');await writeFile(logPath,line('a'));
 let stderr='';
 const start=()=>{
   vector=spawn(process.env.VECTOR_BIN??'vector',['--config',configPath],{stdio:['ignore','pipe','pipe']});
   vector.stdout.on('data',chunk=>{stderr=(stderr+chunk).slice(-150000);});
   vector.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-150000);});
 };
 async function until(condition){
   for(let i=0;i<200;i++){if(condition())return;if(vector.exitCode!==null)throw new Error(stderr);await delay(100);}
   throw new Error('Timed out\n'+stderr);
 }
 start();await until(()=>attempts>0);await delay(1000);
 const killed=once(vector,'exit');vector.kill('SIGKILL');await killed;
 unavailable=false;start();await until(()=>documents.has('recovery:a'));
 const {rename}=await import('node:fs/promises');
 await rename(logPath,logPath+'.1');await writeFile(logPath,line('b'));
 await until(()=>documents.has('recovery:b'));
 await appendFile(logPath,line('c'));await until(()=>documents.has('recovery:c'));
 assert.equal(documents.size,3);
 for(const id of ['a','b','c'])assert.equal(documents.get('recovery:'+id).event.id,id);
});
