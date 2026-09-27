// Invoke on a remote Linux/amd64 Docker runner, not the user's production workstation.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile);
const name='visulia-smoke-'+randomUUID();
const env={...process.env,VISULIA_SESSION_ID:randomUUID(),VISULIA_AGENT_TOKEN:randomBytes(32).toString('hex')};
const docker=(args,timeout=15000)=>exec('docker',args,{env,timeout,maxBuffer:1024*1024});
try{
 await docker(['run','-d','--pull','never','--name',name,'--network','none','--memory','6g','--cpus','2','--env','VISULIA_SESSION_ID','--env','VISULIA_AGENT_TOKEN',process.env.VISULIA_STACK_IMAGE??'visulia-stack:build']);
 let ready=false;
 for(let i=0;i<120;i++){
  const {stdout}=await docker(['inspect','--format','{{.State.Running}}',name]);
  if(stdout.trim()!=='true')throw new Error('STACK_EXITED_BEFORE_READY');
  try{
   await docker(['exec',name,'node','-e',"fetch('http://127.0.0.1:8081/health',{headers:{authorization:'Bearer '+process.env.VISULIA_AGENT_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);
   ready=true;break;
  }catch{await delay(2000);}
 }
 if(!ready)throw new Error('STACK_READINESS_TIMEOUT');
 const {stdout}=await docker(['exec',name,'node','--input-type=module','-e',await readFile(new URL('./stack-smoke-inside.mjs',import.meta.url),'utf8')],180000);
 process.stdout.write(stdout);
}catch(error){
 // Only our fixed diagnostic codes are exposed, never raw service logs/configuration.
 try{
  const {stdout,stderr}=await docker(['logs',name]);
  for(const line of (stdout+'\n'+stderr).split('\n'))if(/^RUNTIME_(?:START_FAILED|ERROR:[A-Z]+|PHASE:[a-z]+|BOOTSTRAP:[a-z0-9:-]+)$/.test(line))console.error(line);
 }catch{}
 // Reproduce startup in another fresh, network-disabled container. This image has
 // never accepted user data; diagnostic output redacts its generated credentials.
 const diagnosticName=name+'-diagnostic';
 try{
  const source=await readFile(new URL('./diagnose-stack-inside.mjs',import.meta.url),'utf8');
  const result=await docker(['run','--name',diagnosticName,'--pull','never','--network','none','--memory','6g','--cpus','2','--entrypoint','node',process.env.VISULIA_STACK_IMAGE??'visulia-stack:build','--input-type=module','-e',source],150000);
  process.stderr.write(result.stdout+result.stderr);
 }catch{console.error('STARTUP_DIAGNOSTIC_UNAVAILABLE');}
 finally{try{await docker(['rm','-f',diagnosticName]);}catch{}}
 throw error;
}finally{
 {
  // run may create the container and then reject. Cleanup does not depend on CLI success.
  try{await docker(['rm','-f',name]);}catch{/* Verify absence against the daemon below. */}
  // Removal must be observable, not just an attempted cleanup call.
  const {stdout}=await docker(['ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}']);
  if(stdout.trim())throw new Error('STACK_CLEANUP_FAILED');
 }
}
