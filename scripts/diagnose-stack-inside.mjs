// CI-only startup reproduction. Never runs against an existing session or uploaded data.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRuntimeConfig} from '/opt/visulia/dist/src/agent/runtime-config.js';
import {prepareRuntime} from '/opt/visulia/dist/src/agent/files.js';
import {bootstrap} from '/opt/visulia/dist/src/agent/bootstrap.js';
import {Services} from '/opt/visulia/dist/src/agent/processes.js';
import {NodeBootstrapIO} from '/opt/visulia/dist/src/agent/node-io.js';
process.umask(0o077);
const config=createRuntimeConfig(randomUUID()),services=new Services(),children=[];
const scrub=text=>Object.values(config.secrets).reduce((value,secret)=>value.replaceAll(secret,'[redacted]'),text).replace(/\x1b\[[0-9;]*m/g,'');
const io=new NodeBootstrapIO(services,async(input,init)=>{
 const response=await fetch(input,init);
 if(!response.ok&&String(input).includes('/_security/')){
  const text=await response.clone().text();
  console.error(JSON.stringify({securityStatus:response.status,response:scrub(text).slice(0,4096)}));
 }
 return response;
});
io.start=(name,command,args,env)=>{
 const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe'],detached:true});
 let output='';
 const capture=chunk=>{output=(output+chunk.toString()).slice(-65536);};
 child.stdout.on('data',capture);child.stderr.on('data',capture);
 const done=new Promise(resolve=>{
  child.on('error',()=>{void services.stop();});
  child.on('close',code=>{console.log(JSON.stringify({service:name,code,startupOutput:scrub(output)}));void services.stop();resolve();});
 });
 children.push({child,done});
};
const deadline=setTimeout(()=>void services.stop(),120000);
try{await prepareRuntime();await bootstrap(config,io);}catch{console.error('DIAGNOSTIC_BOOTSTRAP_FAILED');}
finally{
 clearTimeout(deadline);
 for(const {child} of children)if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}
 await Promise.all(children.map(x=>x.done));await services.stop();
}
