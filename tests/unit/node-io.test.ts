import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NodeBootstrapIO} from '../../src/agent/node-io.js';
import {Services} from '../../src/agent/processes.js';

test('bootstrap config writes make existing files private and replace content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-io-'));
 const services=new Services();
 try{
  const path=join(root,'config.yml');await writeFile(path,'old',{mode:0o644});
  await new NodeBootstrapIO(services).write(path,'secret');
  assert.equal(await readFile(path,'utf8'),'secret');
  assert.equal((await stat(path)).mode&0o777,0o600);
 }finally{await services.stop();await rm(root,{recursive:true,force:true});}
});
test('bootstrap refuses arbitrary credential destinations and sanitizes security API failures',async()=>{
 const services=new Services();let requests=0;
 try{
  const io=new NodeBootstrapIO(services,async(input,init)=>{
   const request=new Request(input,init);requests++;
   assert.equal(request.url,'http://127.0.0.1:9200/_security/user/kibana_system/_password');
   assert.equal(request.headers.get('authorization'),'Basic bootstrap');
   assert.equal(request.redirect,'error');
   return new Response('secret upstream detail',{status:403});
  });
  await assert.rejects(io.request('//evil.example',{password:'secret'},'Basic bootstrap'),/INVALID_SECURITY_PATH/);
  assert.equal(requests,0);
  await assert.rejects(io.request('/_security/user/kibana_system/_password',{password:'secret'},'Basic bootstrap'),error=>error instanceof Error&&error.message==='SECURITY_SETUP_FAILED');
  assert.equal(requests,1);
 }finally{await services.stop();}
});
test('bootstrap health checks reject successful HTTP with unhealthy service state',async()=>{
 const services=new Services();let requests=0;
 try{
  const io=new NodeBootstrapIO(services,async()=>{
   requests++;
   return Response.json({status:'yellow',timed_out:requests===1});
  });
  await io.wait('http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=1s','Basic bootstrap');
  assert.equal(requests,2);
  await assert.rejects(io.wait('https://evil.example','Basic bootstrap'),/INVALID_HEALTH_TARGET/);
 }finally{await services.stop();}
});
