import {spawn} from 'node:child_process';
export async function runCommand(command:string,args:string[],env:NodeJS.ProcessEnv,signal:AbortSignal,input?:string):Promise<void>{
 if(signal.aborted)throw new Error('BOOTSTRAP_COMMAND_FAILED');
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(command,args,{env,stdio:['pipe','ignore','ignore'],detached:true});
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
  const timer=setTimeout(kill,30000);
  const finish=(success:boolean)=>{
   clearTimeout(timer);signal.removeEventListener('abort',kill);
   if(success&&!signal.aborted)resolve();else reject(new Error('BOOTSTRAP_COMMAND_FAILED'));
  };
  signal.addEventListener('abort',kill,{once:true});
  child.once('error',()=>finish(false));
  child.once('close',code=>finish(code===0));
  child.stdin.on('error',()=>{}); // EPIPE is reported by the process exit, without including input.
  child.stdin.end(input??'');
 });
}
