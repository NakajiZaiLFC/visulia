import type {RuntimeConfig} from './runtime-config.js';
export interface BootstrapIO {
 write(path:string,text:string):Promise<void>;
 run(command:string,args:string[],env:NodeJS.ProcessEnv,input?:string):Promise<void>;
 start(name:string,command:string,args:string[],env:NodeJS.ProcessEnv):void;
 wait(url:string,authorization?:string):Promise<void>;
 request(path:string,body:unknown,authorization:string):Promise<void>;
 stop():Promise<void>;
}
export async function bootstrap(config:RuntimeConfig,io:BootstrapIO):Promise<void>{
 const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/work',LANG:'C.UTF-8',TMPDIR:'/work/tmp'};
 const esEnv={...env,ES_PATH_CONF:'/work/config/elasticsearch',ES_JAVA_OPTS:'-Xms1536m -Xmx1536m'};
 const authorization='Basic '+Buffer.from('elastic:'+config.secrets.elastic).toString('base64');
 try{
  await io.write('/work/config/elasticsearch/elasticsearch.yml',config.elasticsearch);
  await io.write('/work/config/kibana/kibana.yml',config.kibana);
  // The launcher changes cwd to read-only ES_HOME; JVM outputs belong to the session.
  await io.write('/work/config/elasticsearch/jvm.options.d/visulia.options',
   '-Xlog:disable\n-Xlog:gc*,gc+age=trace,safepoint:file=/work/elasticsearch-logs/gc.log:utctime,level,pid,tags:filecount=4,filesize=16m\n-XX:ErrorFile=/work/elasticsearch-logs/hs_err_pid%p.log\n-XX:HeapDumpPath=/work/elasticsearch-logs\n');
  await io.run('/opt/elasticsearch/bin/elasticsearch-keystore',['add','-x','-f','bootstrap.password'],esEnv,config.secrets.elastic+'\n');
  io.start('elasticsearch','/opt/elasticsearch/bin/elasticsearch',[],esEnv);
  await io.wait('http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=1s',authorization);
  await io.request('/_security/user/kibana_system/_password',{password:config.secrets.kibana},authorization);
  await io.request('/_security/role/visulia_data',{
   cluster:['monitor','manage_index_templates','manage_own_api_key'],
   indices:[{names:['visulia-*'],privileges:['all'],allow_restricted_indices:false}],
  },authorization);
  await io.request('/_security/user/'+config.secrets.username,{password:config.secrets.password,roles:['kibana_admin','visulia_data']},authorization);
  io.start('kibana','/opt/kibana/bin/kibana',['--config','/work/config/kibana/kibana.yml'],{...env,NODE_OPTIONS:'--max-old-space-size=1536'});
  io.start('tomee','/opt/tomee/bin/catalina.sh',['run'],{...env,JAVA_HOME:'/opt/java/openjdk',CATALINA_HOME:'/opt/tomee',CATALINA_BASE:'/work/tomee',CATALINA_OPTS:'-Xms128m -Xmx512m'});
  await io.wait('http://127.0.0.1:5601'+config.basePath+'/api/status','Basic '+Buffer.from(config.secrets.username+':'+config.secrets.password).toString('base64'));
  await io.wait('http://127.0.0.1:8080/demo/health');
 }catch(error){await io.stop();throw error;}
}
