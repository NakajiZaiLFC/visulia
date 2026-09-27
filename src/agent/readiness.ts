import {setTimeout as sleep} from 'node:timers/promises';
export async function waitForReady(url:string,accept:(body:unknown)=>boolean,signal:AbortSignal,authorization?:string,timeoutMs=180000,intervalMs=1000):Promise<void>{
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
 while(!deadline.aborted){
  try{
   const response=await fetch(url,{redirect:'error',headers:authorization?{authorization}:{},signal:AbortSignal.any([deadline,AbortSignal.timeout(5000)])});
   if(response.ok){if(accept(await response.json()))return;}
   else await response.body?.cancel();
  }catch{/* Startup transport errors and incomplete JSON are retried within the deadline. */}
  try{await sleep(intervalMs,undefined,{signal:deadline});}catch{break;}
 }
 throw new Error('SERVICE_NOT_READY');
}
