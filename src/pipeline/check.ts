import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createPipeline} from './config.js';
export interface CheckInput {parser:string;mapping:unknown;metadata:Record<string,string>;runId:string;lines:string[];}
export interface CheckResult {valid:boolean;accepted:number;rejected:number;total:number;}
/** Execute the same parser/guard with no Elasticsearch sink or production file checkpoint. */
export async function checkLogs(input:CheckInput,signal:AbortSignal,vector='vector'):Promise<CheckResult>{
 if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>20000||input.lines.some(line=>typeof line!=='string'||Buffer.byteLength(line)>65536)||input.lines.reduce((sum,line)=>sum+Buffer.byteLength(line)+1,0)>10*1024*1024)throw new Error('INVALID_LOG_INPUT');
 if(signal.aborted)throw new Error('VECTOR_EXECUTION_FAILED');
 const directory=await mkdtemp(join(tmpdir(),'visulia-check-'));
 try{
  const pipeline=createPipeline({...input,directory,elasticsearch:{url:'http://127.0.0.1:9200',username:'unused',password:'unused'}});
  const {metadata,parse,guard}=pipeline.transforms;
  const config={data_dir:directory,sources:{raw:{type:'stdin',decoding:{codec:'json'},framing:{method:'newline_delimited',newline_delimited:{max_length:1048576}}}},
   transforms:{metadata,parse,guard,
    accepted:{type:'remap',inputs:['guard'],source:'. = {"ok":true}'},
    rejected:{type:'remap',inputs:['parse.dropped','guard.dropped'],source:'. = {"ok":false}'},
   },sinks:{result:{type:'console',inputs:['accepted','rejected'],encoding:{codec:'json'}}}};
  const path=join(directory,'check.json');await writeFile(path,JSON.stringify(config),{mode:0o600});
  if(signal.aborted)throw new Error('VECTOR_EXECUTION_FAILED');
  return await new Promise<CheckResult>((resolve,reject)=>{
   const child=spawn(vector,['--config',path],{env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:directory},stdio:['pipe','pipe','ignore'],detached:true});
   let accepted=0,rejected=0,output='',invalid=false,timedOut=false;
   const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
   const timer=setTimeout(()=>{timedOut=true;kill();},60000);
   signal.addEventListener('abort',kill,{once:true});
   child.stdout.setEncoding('utf8');
   child.stdout.on('data',(chunk:string)=>{
    output+=chunk;
    let end:number;
    while((end=output.indexOf('\n'))>=0){
     const line=output.slice(0,end);output=output.slice(end+1);
     try{const row=JSON.parse(line);if(row.ok===true)accepted++;else if(row.ok===false)rejected++;else throw new Error();}
     catch{invalid=true;kill();}
    }
    if(output.length>65536||accepted+rejected>input.lines.length){invalid=true;kill();}
   });
   const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',kill);};
   child.once('error',()=>{cleanup();reject(new Error('VECTOR_EXECUTION_FAILED'));});
   child.once('close',code=>{
    cleanup();
    if(code!==0||invalid||timedOut||signal.aborted||output.trim()||accepted+rejected!==input.lines.length)reject(new Error('VECTOR_EXECUTION_FAILED'));
    else resolve({valid:rejected===0,accepted,rejected,total:input.lines.length});
   });
   child.stdin.on('error',()=>{});
   child.stdin.end(input.lines.map(message=>JSON.stringify({message,file:'preflight.log'})).join('\n')+'\n');
  });
 }finally{await rm(directory,{recursive:true,force:true});}
}
