import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {CheckInput,CheckResult} from '../pipeline/check.js';
import {createPipeline} from '../pipeline/config.js';
export interface RunConfig {metadata:Record<string,string>;parser:string;mapping:unknown;}
export interface RunIO {check(input:CheckInput):Promise<CheckResult>;probe():Promise<void>;createIndex(name:string,mapping:unknown):Promise<void>;deleteIndex(name:string):Promise<void>;start(path:string,onExit:()=>void):Promise<()=>Promise<void>>;}
export interface RunOptions {root:string;elasticsearch:{url:string;username:string;password:string};signal:AbortSignal;io:RunIO;}
interface Run {id:string;state:'draft'|'checking'|'checked'|'ingesting'|'stopped'|'failed';revision:number;bytes:number;config:RunConfig;check?:CheckResult;checkedRevision?:number;indexRevision?:number;indexPending?:boolean;stop?:()=>Promise<void>;}
export class RunManager {
 private readonly runs=new Map<string,Run>();
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly options:RunOptions){
  options.signal.addEventListener('abort',()=>{for(const run of this.runs.values())void this.halt(run).catch(()=>{});},{once:true});
 }
 private serial<T>(action:()=>Promise<T>):Promise<T>{
  const result=this.queue.then(()=>{this.live();return action();});
  this.queue=result.catch(()=>{});return result;
 }
 private live(){if(this.options.signal.aborted)throw new Error('SESSION_STOPPED');}
 private find(id:string){const run=this.runs.get(id);if(!run)throw new Error('RUN_NOT_FOUND');return run;}
 private directory(run:Run){return join(this.options.root,run.id);}
 private snapshot(run:Run){return structuredClone({id:run.id,state:run.state,revision:run.revision,bytes:run.bytes,config:run.config,...(run.check?{check:run.check}:{})});}
 private validate(config:RunConfig,id:string){
  try{createPipeline({...config,runId:id,directory:join(this.options.root,id),elasticsearch:this.options.elasticsearch});return structuredClone(config);}
  catch{throw new Error('INVALID_CONFIG');}
 }
 private editable(run:Run){if(run.state==='ingesting'||run.stop)throw new Error('RUN_ACTIVE');}
 private async save(run:Run){await writeFile(join(this.directory(run),'configuration.json'),JSON.stringify(run.config),{mode:0o600});}
 private invalidate(run:Run){run.revision++;run.state='draft';delete run.check;delete run.checkedRevision;}
 list(){this.live();return [...this.runs.values()].map(run=>this.snapshot(run));}
 get(id:string){this.live();return this.snapshot(this.find(id));}
 async create(config:RunConfig){return this.serial(async()=>{
  if(this.runs.size>=3)throw new Error('RUN_CAPACITY');
  const id=randomUUID(),run:Run={id,state:'draft',revision:1,bytes:0,config:this.validate(config,id)};
  const root=this.directory(run);
  for(const path of ['input','vector','quarantine'])await mkdir(join(root,path),{recursive:true,mode:0o700});
  await this.save(run);this.runs.set(id,run);return this.snapshot(run);
 });}
 async update(id:string,config:RunConfig){return this.serial(async()=>{
  const run=this.find(id);this.editable(run);run.config=this.validate(config,id);this.invalidate(run);await this.save(run);return this.snapshot(run);
 });}
 async upload(id:string,bytes:Uint8Array){return this.serial(async()=>{
  const run=this.find(id);this.editable(run);
  const lines=this.decode(bytes),normalized=Buffer.from(lines.length?lines.join("\n")+"\n":"");
  this.invalidate(run);
  const directory=this.directory(run),temporary=join(directory,'input','.upload.tmp');
  await writeFile(join(directory,'source-upload.bin'),bytes,{mode:0o600});
  await writeFile(temporary,normalized,{mode:0o600});await rename(temporary,join(directory,'input','upload.log'));
  run.bytes=normalized.byteLength;return this.snapshot(run);
 });}
 private decode(bytes:Uint8Array):string[]{
  if(bytes.byteLength>10*1024*1024)throw new Error('INVALID_LOG_INPUT');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('INVALID_LOG_INPUT');}
  const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
  const result=lines.map(line=>line.endsWith('\r')?line.slice(0,-1):line);
  if(result.length>20000||result.some(line=>Buffer.byteLength(line)>65536))throw new Error('INVALID_LOG_INPUT');return result;
 }
 private async verify(run:Run){
  this.editable(run);run.state='checking';delete run.checkedRevision;delete run.check;
  try{
   const lines=this.decode(await readFile(join(this.directory(run),'input','upload.log')));
   if(!lines.length)throw new Error('INVALID_LOG_INPUT');
   await this.options.io.probe();
   run.check=await this.options.io.check({...run.config,runId:run.id,lines});
   this.live();
   if(run.check.valid){run.checkedRevision=run.revision;run.state='checked';}else run.state='draft';
   await writeFile(join(this.directory(run),'check-result.json'),JSON.stringify({revision:run.revision,...run.check}),{mode:0o600});
  }catch(error){run.state='draft';if((error as NodeJS.ErrnoException).code==='ENOENT')throw new Error('LOGS_REQUIRED');throw error;}
  return this.snapshot(run);
 }
 async check(id:string){return this.serial(()=>this.verify(this.find(id)));}
 private async begin(run:Run){
  this.editable(run);
  if(run.checkedRevision!==run.revision||!run.check?.valid)throw new Error('CHECK_REQUIRED');
  if(run.indexPending||(run.indexRevision!==undefined&&run.indexRevision!==run.revision))throw new Error('REPARSE_REQUIRED');
  const pipeline=createPipeline({...run.config,runId:run.id,directory:this.directory(run),elasticsearch:this.options.elasticsearch});
  const path=join(this.directory(run),'vector.json');await writeFile(path,JSON.stringify(pipeline),{mode:0o600});
  this.live();
  if(run.indexRevision===undefined){
   run.indexPending=true;
   try{await this.options.io.createIndex('visulia-'+run.id,run.config.mapping);run.indexRevision=run.revision;delete run.indexPending;}
   catch(error){run.state='failed';throw error;}
  }
  this.live();
  try{
   let exited=false;
   run.stop=await this.options.io.start(path,()=>{exited=true;if(run.state==='ingesting')run.state='failed';});
   if(exited){await this.halt(run);throw new Error('INGEST_EXITED');}
   if(this.options.signal.aborted){await this.halt(run);throw new Error('SESSION_STOPPED');}
   run.state='ingesting';return this.snapshot(run);
  }catch(error){run.state='failed';throw error;}
 }
 async ingest(id:string){return this.serial(()=>this.begin(this.find(id)));}
 private async halt(run:Run){
  run.state='stopped';const stop=run.stop;
  if(stop){try{await stop();delete run.stop;}catch(error){run.state='failed';throw error;}}
 }
 async stop(id:string){return this.serial(async()=>{const run=this.find(id);await this.halt(run);return this.snapshot(run);});}
 async reparse(id:string){return this.serial(async()=>{
  const run=this.find(id);await this.halt(run);await this.verify(run);
  if(!run.check?.valid)throw new Error('CHECK_REQUIRED');
  this.live();
  if(run.indexRevision!==undefined||run.indexPending){await this.options.io.deleteIndex('visulia-'+run.id);delete run.indexRevision;delete run.indexPending;}
  for(const name of ['vector','quarantine']){const path=join(this.directory(run),name);await rm(path,{recursive:true,force:true});await mkdir(path,{mode:0o700});}
  return this.begin(run);
 });}
}
