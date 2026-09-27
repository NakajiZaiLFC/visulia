import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
export interface DemoOptions {runId:string;scenario:'normal'|'errors'|'slow'|'mixed';count:number;rate:number;}
export interface DemoRecord {id:string;runId:string;path:string;status:number|null;startedAt:string;elapsedMs:number;error?:'transport'|'aborted';}
const scenarios={normal:['ok'],errors:['missing','error'],slow:['slow'],mixed:['ok','missing','error','slow']} as const;
/** No user-controlled origin or URL: this is a bounded demo, not a load-testing proxy. */
export async function generateDemo(options:DemoOptions,record:(value:DemoRecord)=>Promise<void>,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<void>{
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.runId) || !Object.hasOwn(scenarios,options.scenario) ||
   !Number.isInteger(options.count)||options.count<1||options.count>1800 || !Number.isInteger(options.rate)||options.rate<1||options.rate>5)throw new Error('INVALID_DEMO');
 const choices=scenarios[options.scenario];
 for(let i=0;i<options.count&&!signal.aborted;i++){
  const start=performance.now(),id=randomUUID(),path='/demo/'+choices[i%choices.length];
  const entry:DemoRecord={id,runId:options.runId,path,status:null,startedAt:new Date().toISOString(),elapsedMs:0};
  try {
   const response=await fetcher('http://127.0.0.1:8080'+path,{method:'GET',redirect:'error',headers:{'X-Visulia-Request-Id':id},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
   entry.status=response.status;
   await response.body?.cancel();
  } catch {entry.error=signal.aborted?'aborted':'transport';}
  entry.elapsedMs=Math.round((performance.now()-start)*1000)/1000;
  await record(entry);
  const pause=Math.max(0,1000/options.rate-(performance.now()-start));
  if(i+1<options.count&&!signal.aborted)try{await sleep(pause,undefined,{signal});}catch(error){if(!signal.aborted)throw error;}
 }
}
