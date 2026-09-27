import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('remote smoke harness removes a container created by a failed docker run',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-docker-fixture-'));
 const marker=join(root,'container');
 try{
  await writeFile(join(root,'docker'),`#!${process.execPath}\nconst fs=require('node:fs'); const cmd=process.argv[2]; const marker=process.env.VISULIA_FIXTURE_MARKER; if(cmd==='run'){fs.writeFileSync(marker,'created');process.exit(1);} if(cmd==='rm'){fs.rmSync(marker,{force:true});} if(cmd==='ps'&&fs.existsSync(marker)){console.log('leftover');}\n`,{mode:0o700});
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../../scripts/test-stack.mjs',import.meta.url))],{env:{...process.env,PATH:root,VISULIA_FIXTURE_MARKER:marker},encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,'start failure must remain visible');
  await assert.rejects(access(marker),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
