import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareRuntime} from '../../src/agent/files.js';

test('runtime prepares a private fresh filesystem and refuses reuse of session data',async()=>{
 const base=await mkdtemp(join(tmpdir(),'visulia-files-'));
 const root=join(base,'work'),installation=join(base,'opt');
 try{
  await mkdir(join(installation,'elasticsearch/config'),{recursive:true});
  await writeFile(join(installation,'elasticsearch/config/jvm.options'),'jvm-defaults');
  await mkdir(join(installation,'tomee/conf'),{recursive:true});
  await writeFile(join(installation,'tomee/conf/web.xml'),'web-defaults');
  await mkdir(join(installation,'visulia/tomee/app/WEB-INF'),{recursive:true});
  await writeFile(join(installation,'visulia/tomee/server.xml'),'demo-server');
  await writeFile(join(installation,'visulia/tomee/app/demo.jsp'),'demo-jsp');
  await prepareRuntime(root,installation);
  assert.equal(await readFile(join(root,'config/elasticsearch/jvm.options'),'utf8'),'jvm-defaults');
  assert.equal(await readFile(join(root,'tomee/conf/server.xml'),'utf8'),'demo-server');
  assert.equal(await readFile(join(root,'tomee/webapps/ROOT/demo.jsp'),'utf8'),'demo-jsp');
  for(const path of ['','config','raw','tmp','tomee','kibana','elasticsearch'])assert.equal((await stat(join(root,path))).mode&0o077,0);
  await writeFile(join(root,'raw/access.log'),'existing-log');
  await assert.rejects(prepareRuntime(root,installation),/EEXIST/);
  assert.equal(await readFile(join(root,'raw/access.log'),'utf8'),'existing-log');
 }finally{await rm(base,{recursive:true,force:true});}
});
