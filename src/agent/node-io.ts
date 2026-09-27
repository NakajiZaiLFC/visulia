import {open} from 'node:fs/promises';
import type {BootstrapIO} from './bootstrap.js';
import type {Services} from './processes.js';
import {runCommand} from './command.js';
import {waitForReady} from './readiness.js';
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
// Diagnostics contain only fixed operation names, never bodies or credentials.
export class NodeBootstrapIO implements BootstrapIO {
 constructor(private readonly services:Services,private readonly fetcher:typeof fetch=fetch){}
 async write(path:string,text:string):Promise<void>{
  const file=await open(path,'w',0o600);
  try{await file.chmod(0o600);await file.writeFile(text);}finally{await file.close();}
 }
 async run(command:string,args:string[],env:NodeJS.ProcessEnv,input?:string):Promise<void>{console.error('RUNTIME_BOOTSTRAP:keystore');await runCommand(command,args,env,this.services.signal,input);}
 start(name:string,command:string,args:string[],env:NodeJS.ProcessEnv):void{console.error('RUNTIME_BOOTSTRAP:start:'+name);this.services.start({name,command,args,env});}
 async wait(url:string,authorization?:string):Promise<void>{
  const target=new URL(url);
  let accept:(body:unknown)=>boolean;
  if(target.origin==='http://127.0.0.1:9200'&&target.pathname==='/_cluster/health')accept=body=>['yellow','green'].includes(String(object(body).status))&&object(body).timed_out===false;
  else if(target.origin==='http://127.0.0.1:5601'&&/^\/s\/[a-f0-9-]{36}\/kibana\/api\/status$/.test(target.pathname))accept=body=>object(object(object(body).status).overall).level==='available';
  else if(target.origin==='http://127.0.0.1:8080'&&target.pathname==='/demo/health')accept=body=>object(body).status==='ready';
  else throw new Error('INVALID_HEALTH_TARGET');
  console.error('RUNTIME_BOOTSTRAP:wait:'+target.port);
  await waitForReady(url,accept,this.services.signal,authorization,180000,1000,this.fetcher);
 }
 async request(path:string,body:unknown,authorization:string):Promise<void>{
  if(!/^\/_security\/(?:user\/kibana_system\/_password|role\/visulia_data|user\/visulia_[a-f0-9]{32})$/.test(path))throw new Error('INVALID_SECURITY_PATH');
  console.error('RUNTIME_BOOTSTRAP:security-'+(path.includes('_password')?'password':path.includes('/role/')?'role':'user'));
  try{
   const response=await this.fetcher('http://127.0.0.1:9200'+path,{method:'POST',redirect:'error',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([this.services.signal,AbortSignal.timeout(10000)])});
   await response.body?.cancel();
   if(!response.ok){console.error('RUNTIME_BOOTSTRAP:security-http-'+response.status);throw new Error('SECURITY_SETUP_FAILED');}
  }catch(error){console.error('RUNTIME_BOOTSTRAP:security-'+((error as Error)?.name==='TimeoutError'?'timeout':'failed'));throw new Error('SECURITY_SETUP_FAILED');}
 }
 async stop():Promise<void>{await this.services.stop();}
}
