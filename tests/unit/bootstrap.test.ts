import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrap,type BootstrapIO} from '../../src/agent/bootstrap.js';
import {createRuntimeConfig} from '../../src/agent/runtime-config.js';
const config=createRuntimeConfig('aabbccdd-1111-2222-3333-001122334455');
function harness(failAt?:string){
 const events:string[]=[];
 const files=new Map<string,string>();
 const io:BootstrapIO={
  async write(path,text){files.set(path,text);},
  async run(command,args,env,input){
   events.push('keystore');
   assert.equal(command,'/opt/elasticsearch/bin/elasticsearch-keystore');
   assert.deepEqual(args,['add','-x','-f','bootstrap.password']);
   assert.equal(input,config.secrets.elastic+'\n');
   assert.equal(env.ES_PATH_CONF,'/work/config/elasticsearch');
   assert.equal(JSON.stringify(args).includes(config.secrets.elastic),false);
  },
  start(name,_command,_args,env){
   events.push('start:'+name);
   // Parent Cloudflare/agent credentials must not be inherited by JVM services.
   assert.equal(env.VISULIA_AGENT_TOKEN,undefined);
  },
  async wait(url,authorization){
   events.push('ready:'+new URL(url).port);
   if(url.includes(':9200'))assert.equal(authorization,'Basic '+Buffer.from('elastic:'+config.secrets.elastic).toString('base64'));
  },
  async request(path,body,auth){
   events.push(path);
   if(path===failAt)throw new Error('SECURITY_SETUP_FAILED');
   assert.equal(auth,'Basic '+Buffer.from('elastic:'+config.secrets.elastic).toString('base64'));
   if(path==='/_security/user/kibana_system/_password')assert.deepEqual(body,{password:config.secrets.kibana});
   else if(path==='/_security/role/visulia_data'){
    const role=body as {cluster:string[];indices:{names:string[];allow_restricted_indices:boolean}[]};
    assert.equal(role.cluster.includes('manage_security'),false);
    assert.equal(role.cluster.includes('all'),false);
    assert.deepEqual(role.indices[0]?.names,['visulia-*']);
    assert.equal(role.indices[0]?.allow_restricted_indices,false);
   }else assert.deepEqual(body,{password:config.secrets.password,roles:['kibana_admin','visulia_data']});
  },
  async stop(){events.push('stop');},
 };
 return {io,events,files};
}
test('runtime provisions separate Kibana and demo credentials before starting dependent services',async()=>{
 const {io,events,files}=harness();
 await bootstrap(config,io);
 assert.deepEqual(events,['keystore','start:elasticsearch','ready:9200','/_security/user/kibana_system/_password','/_security/role/visulia_data','/_security/user/'+config.secrets.username,'start:kibana','start:tomee','ready:5601','ready:8080']);
 assert.equal(files.get('/work/config/elasticsearch/elasticsearch.yml'),config.elasticsearch);
 assert.equal(files.get('/work/config/kibana/kibana.yml'),config.kibana);
});
test('failed security setup stops runtime and never launches the public dashboard',async()=>{
 const {io,events}=harness('/_security/role/visulia_data');
 await assert.rejects(bootstrap(config,io),/SECURITY_SETUP_FAILED/);
 assert.equal(events.includes('start:kibana'),false);
 assert.equal(events.at(-1),'stop');
});
