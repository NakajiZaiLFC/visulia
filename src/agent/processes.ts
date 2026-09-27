import {spawn,type ChildProcess} from 'node:child_process';
export interface ServiceSpec {name:string;command:string;args?:string[];cwd?:string;env?:NodeJS.ProcessEnv;}
export interface Service {completion:Promise<void>;started:Promise<void>;}
/** The Linux container owns all descendants. Service output is not forwarded to public logs. */
export class Services {
 private readonly controller=new AbortController();
 readonly signal=this.controller.signal;
 private readonly children=new Map<ChildProcess,Promise<void>>();
 private stopping=false;
 private stopped:Promise<void>|undefined;
 start(spec:ServiceSpec):Service{
  if(this.stopping)throw new Error('SERVICES_STOPPED');
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(spec.name))throw new Error('INVALID_SERVICE');
  const child=spawn(spec.command,spec.args??[],{cwd:spec.cwd,env:spec.env??process.env,stdio:'ignore',detached:true});
  const started=new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new Error(`SERVICE_EXIT:${spec.name}`)));});
  void started.catch(()=>{});
  const completion=new Promise<void>((resolve,reject)=>{
   let settled=false;
   const finish=()=>{
    if(settled)return;
    settled=true;
    if(this.stopping)resolve();
    else{
     const error=new Error(`SERVICE_EXIT:${spec.name}`);
     reject(error);
     this.controller.abort(error);
     void this.stop();
    }
   };
   child.once('error',finish);
   child.once('close',finish);
  });
  this.children.set(child,completion);
  // Failures are also signalled through signal; a caller need not await every child.
  void completion.catch(()=>{});
  return {completion,started};
 }
 stop():Promise<void>{
  if(this.stopped)return this.stopped;
  this.stopping=true;
  this.controller.abort(new Error('SERVICES_STOPPED'));
  this.stopped=(async()=>{
   const signal=(value:NodeJS.Signals)=>{
    for(const child of this.children.keys())if(child.pid){
     try{process.kill(-child.pid,value);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='ESRCH')child.kill(value);
     }
    }
   };
   signal('SIGTERM');
   const timer=setTimeout(()=>signal('SIGKILL'),2000);
   try{await Promise.allSettled(this.children.values());}finally{
    // A launcher may exit before its descendants. Escalate every retained group
    // even when all direct-child promises have already settled.
    signal('SIGKILL');
    clearTimeout(timer);this.children.clear();
   }
  })();
  return this.stopped;
 }
}
