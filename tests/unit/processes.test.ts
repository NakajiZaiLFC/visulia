import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Services} from '../../src/agent/processes.js';

test('unexpected exit aborts runtime and stops other services without exposing child output',async()=>{
 const services=new Services();
 try{
  const peer=services.start({name:'peer',command:process.execPath,args:['-e','setInterval(()=>{},1000)']});
  const failure=services.start({name:'database',command:process.execPath,args:['-e',"process.stderr.write('SECRET'); process.exit(7)"]});
  await assert.rejects(failure.completion,/SERVICE_EXIT:database/);
  assert.equal(services.signal.aborted,true);
  assert.equal(String(services.signal.reason),'Error: SERVICE_EXIT:database');
  await services.stop();
  await peer.completion;
  assert.throws(()=>services.start({name:'late',command:process.execPath}),/SERVICES_STOPPED/);
 }finally{await services.stop();}
});

test('intentional stop terminates a child that ignores TERM and remains idempotent',async()=>{
 const services=new Services();
 const directory=await mkdtemp(join(tmpdir(),'visulia-process-'));
 const ready=join(directory,'ready');
 try{
  const child=services.start({name:'stubborn',command:process.execPath,args:['-e',`process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(ready)},''); setInterval(()=>{},1000)`]});
  let started=false;
  for(let i=0;i<100;i++){try{await access(ready);started=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
  assert.equal(started,true);
  await Promise.all([services.stop(),services.stop()]);
  await child.completion;
 }finally{await services.stop();await rm(directory,{recursive:true,force:true});}
});

test('spawn failure is sanitized and aborts the runtime',async()=>{
 const services=new Services();
 try{
  const child=services.start({name:'missing',command:'/definitely-missing/secret-command'});
  await assert.rejects(child.completion,/SERVICE_EXIT:missing/);
  assert.equal(services.signal.aborted,true);
 }finally{await services.stop();}
});

test('stopping the direct child also removes its TERM-ignoring descendants',async()=>{
 const services=new Services();
 const directory=await mkdtemp(join(tmpdir(),'visulia-descendant-'));
 const ready=join(directory,'ready');
 let descendant:number|undefined;
 try{
  const grandchild=`process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(ready)},String(process.pid)); setInterval(()=>{},1000)`;
  services.start({name:'parent',command:process.execPath,args:['-e',`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000)`]});
  for(let i=0;i<100;i++){
   try{descendant=Number(await readFile(ready,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}
  }
  assert(descendant);
  await services.stop();
  let alive=true;
  for(let i=0;i<100;i++){
   try{process.kill(descendant,0);}catch{alive=false;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(alive,false,'descendant survived completed shutdown');
 }finally{
  if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}
  await services.stop();await rm(directory,{recursive:true,force:true});
 }
});
