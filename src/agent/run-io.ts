import type {RunIO} from './runs.js';
import {checkLogs,type CheckInput,type CheckResult} from '../pipeline/check.js';
import {Services} from './processes.js';
export class NodeRunIO implements RunIO {
 private readonly authorization:string;
 constructor(username:string,password:string,private readonly signal:AbortSignal,private readonly fetcher:typeof fetch=fetch,private readonly vector='/usr/local/bin/vector'){
  this.authorization='Basic '+Buffer.from(username+':'+password).toString('base64');
 }
 async check(input:CheckInput):Promise<CheckResult>{return checkLogs(input,this.signal,this.vector);}
 private async request(method:string,path:string,body?:unknown):Promise<void>{
  try{
   const response=await this.fetcher('http://127.0.0.1:9200'+path,{method,redirect:'error',headers:{authorization:this.authorization,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([this.signal,AbortSignal.timeout(15000)])});
   if(method==='DELETE'&&response.status===404){await response.body?.cancel();return;}
   if(!response.ok){await response.body?.cancel();throw new Error();}
   if(method==='GET'){await response.body?.cancel();return;}
   const result=await response.json() as {acknowledged?:boolean};
   if(result.acknowledged!==true)throw new Error();
  }catch{throw new Error('ELASTICSEARCH_FAILED');}
 }
 async probe():Promise<void>{await this.request('GET','/');}
 private index(name:string){if(!/^visulia-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name))throw new Error('INVALID_INDEX');return '/'+name;}
 async createIndex(name:string,mapping:unknown):Promise<void>{await this.request('PUT',this.index(name),{mappings:mapping});}
 async deleteIndex(name:string):Promise<void>{await this.request('DELETE',this.index(name));}
 async start(path:string,onExit:()=>void):Promise<()=>Promise<void>>{
  if(this.signal.aborted)throw new Error('VECTOR_START_FAILED');
  const processes=new Services();
  const cancel=()=>{void processes.stop();};
  this.signal.addEventListener('abort',cancel,{once:true});
  const stop=async()=>{this.signal.removeEventListener('abort',cancel);await processes.stop();};
  processes.signal.addEventListener('abort',()=>{if(String(processes.signal.reason).includes('SERVICE_EXIT:'))onExit();},{once:true});
  try{
   await processes.start({name:'vector',command:this.vector,args:['--config',path],env:{PATH:process.env.PATH??'/usr/bin:/bin'}}).started;
   if(this.signal.aborted||processes.signal.aborted)throw new Error();
   return stop;
  }catch{await stop();throw new Error('VECTOR_START_FAILED');}
 }
}
