import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {checkLogs} from '../pipeline/check.js';
import {decodeLogs} from '../pipeline/input.js';
async function readBounded(path:string,maximum:number):Promise<Buffer>{
 const file=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const info=await file.stat();if(!info.isFile()||info.size>maximum)throw new Error('INVALID_INPUT_FILE');
  const buffer=Buffer.alloc(maximum+1);let size=0;
  while(size<buffer.length){const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);if(bytesRead===0)break;size+=bytesRead;}
  if(size>maximum)throw new Error('INVALID_INPUT_FILE');return buffer.subarray(0,size);
 }finally{await file.close();}
}
export async function offlineCheck(args:string[],signal:AbortSignal){
 const options=new Map<string,string>();
 if(args[0]!=='--offline')throw new Error('OFFLINE_USAGE');
 for(let i=1;i<args.length;i+=2){
  const flag=args[i]!,value=args[i+1];
  if(!['--config','--logs','--vector'].includes(flag)||!value||value.startsWith('--')||options.has(flag))throw new Error('OFFLINE_USAGE');
  options.set(flag,value);
 }
 if(!options.has('--config')||!options.has('--logs'))throw new Error('OFFLINE_USAGE');
 let config:any;
 try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(options.get('--config')!,1024*1024)));}catch{throw new Error('INVALID_CONFIG_FILE');}
 if(!config||typeof config.parser!=='string'||!config.metadata||typeof config.metadata!=='object'||Array.isArray(config.metadata)||!config.mapping)throw new Error('INVALID_CONFIG_FILE');
 let bytes:Buffer;try{bytes=await readBounded(options.get('--logs')!,10*1024*1024);}catch{throw new Error('INVALID_LOG_FILE');}
 return checkLogs({parser:config.parser,mapping:config.mapping,metadata:config.metadata,runId:randomUUID(),lines:decodeLogs(bytes)},signal,options.get('--vector')??'vector');
}
