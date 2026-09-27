import {open,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
/** Sequential generator requests only. Capture starts before the first request and
 * returns server-written lines by request ID; it never synthesizes access records. */
export class DemoCapture {
 private offset=0;
 private identity:string|undefined;
 private pending=Buffer.alloc(0);
 private begun=false;
 constructor(private readonly path:string,private readonly signal:AbortSignal){}
 private live(){if(this.signal.aborted)throw new Error('SESSION_STOPPED');}
 async begin():Promise<void>{
  this.live();
  try{const info=await stat(this.path);this.offset=info.size;this.identity=`${info.dev}:${info.ino}`;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('DEMO_LOG_UNAVAILABLE');}
  this.begun=true;this.live();
 }
 async take(id:string,timeout=5000):Promise<string>{
  if(!this.begun||! /^[A-Za-z0-9_-]{1,128}$/.test(id)||!Number.isFinite(timeout)||timeout<1||timeout>5000)throw new Error('INVALID_DEMO');
  const deadline=performance.now()+timeout;
  while(performance.now()<deadline){
   this.live();
   let file;
   try{file=await open(this.path,'r');}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('DEMO_LOG_UNAVAILABLE');}
   if(file){
    try{
     const info=await file.stat(),identity=`${info.dev}:${info.ino}`;
     if((this.identity!==undefined&&this.identity!==identity)||info.size<this.offset)throw new Error('DEMO_LOG_CHANGED');
     this.identity=identity;
     const buffer=Buffer.alloc(65536);
     const {bytesRead}=await file.read(buffer,0,buffer.length,this.offset);this.offset+=bytesRead;
     this.pending=Buffer.concat([this.pending,buffer.subarray(0,bytesRead)]);
     let boundary;
     while((boundary=this.pending.indexOf(10))!==-1){
      const bytes=this.pending.subarray(0,boundary);this.pending=this.pending.subarray(boundary+1);
      if(bytes.length>65536)throw new Error('DEMO_LOG_TOO_LARGE');
      const line=bytes.toString('utf8').replace(/\r$/,'');
      if(line.endsWith('|'+id)){this.live();return line;}
     }
     if(this.pending.length>65536)throw new Error('DEMO_LOG_TOO_LARGE');
     if(this.offset<info.size)continue;
    }finally{await file.close();}
   }
   try{await delay(Math.min(25,Math.max(1,deadline-performance.now())),undefined,{signal:this.signal});}
   catch{this.live();throw new Error('DEMO_LOG_UNAVAILABLE');}
  }
  throw new Error('DEMO_LOG_TIMEOUT');
 }
}
