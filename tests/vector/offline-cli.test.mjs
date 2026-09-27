import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const entry=process.env.VISULIA_CLI_ENTRY??'dist/src/cli/main.js';
test('offline CLI parses local logs with Vector and returns failure for rejected rows without a server',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-offline-'));
 try{
  const config=join(root,'config.json'),logs=join(root,'input.log');
  await writeFile(config,JSON.stringify({metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8'))}));
  const args=[entry,'check','--offline','--config',config,'--logs',logs];
  if(process.env.VECTOR_BIN)args.push('--vector',process.env.VECTOR_BIN);
  for(const [input,code,accepted,rejected] of [['\uFEFF2026-09-27T03:00:00.000Z|GET|/demo/ok|200|1234|req-1\r\n',0,1,0],['malformed',1,0,1]]){
   await writeFile(logs,input);
   const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:65000,env:{...process.env,VISULIA_SERVER:'https://must-not-be-contacted.invalid'}});
   assert.equal(result.status,code,result.stderr+result.stdout);
   assert.deepEqual(JSON.parse(result.stdout),{valid:code===0,accepted,rejected,total:1});
   assert.equal(await readFile(logs,'utf8'),input,'validation must preserve the original file');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('offline CLI fails closed on invalid UTF-8 and malformed invocation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-offline-invalid-'));
 try{
  const config=join(root,'config.json'),logs=join(root,'input.log');
  await writeFile(config,JSON.stringify({metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:await readFile('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(await readFile('templates/mappings/access.json','utf8'))}));
  await writeFile(logs,Buffer.from([0xff,0xfe]));
  const result=spawnSync(process.execPath,[entry,'check','--offline','--config',config,'--logs',logs],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/INVALID_LOG_INPUT/);
  const missing=spawnSync(process.execPath,[entry,'check','--offline','--config',config],{encoding:'utf8',timeout:5000});
  assert.equal(missing.status,1);assert.equal(missing.stdout,'');assert.match(missing.stderr,/使い方/);
 }finally{await rm(root,{recursive:true,force:true});}
});
