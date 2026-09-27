// Runs only inside the disposable CI test container. No real user data.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,link} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {generateDemo} from '/opt/visulia/dist/src/agent/demo.js';
import {createPipeline} from '/opt/visulia/dist/src/pipeline/config.js';
const base='http://127.0.0.1:8081';
const authorization='Bearer '+process.env.VISULIA_AGENT_TOKEN;
async function api(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{authorization,'content-type':'application/json','kbn-xsrf':'visulia-smoke'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();assert(response.ok,`API rejected ${method} ${path}: ${response.status}`);return data;
}
assert.equal((await fetch(base+'/health')).status,401);
const credentials=await api('/credentials');
const mapping=JSON.parse(await readFile('/opt/visulia/templates/mappings/access.json','utf8'));
await api('/elasticsearch/visulia-smoke','PUT',{mappings:mapping});
const directory='/work/runs/smoke';
for(const path of ['input','vector','quarantine'])await mkdir(directory+'/'+path,{recursive:true});
const pipeline=createPipeline({directory,runId:'smoke',metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'ci',host_name:'demo'},parser:await readFile('/opt/visulia/templates/parsers/access.vrl','utf8'),mapping,elasticsearch:{url:'http://127.0.0.1:9200',username:credentials.username,password:credentials.password}});
await writeFile(directory+'/vector.json',JSON.stringify(pipeline),{mode:0o600});
const outcomes=[];
await generateDemo({runId:'smoke',scenario:'mixed',count:4,rate:5},async row=>{outcomes.push(row);},new AbortController().signal);
assert.deepEqual(outcomes.map(row=>row.status),[200,404,500,200]);
const lines=(await readFile('/work/raw/access.log','utf8')).trim().split('\n');
assert.equal(lines.length,4,'health requests must not appear in access logs');
await link('/work/raw/access.log',directory+'/input/access.log');
const vector=spawn('/usr/local/bin/vector',['--config',directory+'/vector.json'],{stdio:'ignore'});
try{
 let count=0;
 for(let i=0;i<60;i++){
  if(vector.exitCode!==null)throw new Error('VECTOR_EXITED');
  await api('/elasticsearch/visulia-smoke/_refresh','POST');
  count=(await api('/elasticsearch/visulia-smoke/_count')).count;
  if(count===4)break;
  await delay(500);
 }
 assert.equal(count,4,'actual TomEE -> Vector -> Elasticsearch delivery');
 const query=await api('/elasticsearch/_query','POST',{query:'FROM visulia-smoke | STATS requests = COUNT(*) BY http.response.status_code | SORT http.response.status_code'});
 const statusIndex=query.columns.findIndex(c=>c.name==='http.response.status_code');
 const countIndex=query.columns.findIndex(c=>c.name==='requests');
 assert.deepEqual(query.values.map(row=>[row[statusIndex],row[countIndex]]),[[200,2],[404,1],[500,1]]);
 const created=await api(credentials.kibanaPath+'/api/data_views/data_view','POST',{data_view:{title:'visulia-*',name:'VISULIA smoke',timeFieldName:'@timestamp'}});
 assert.equal(typeof created.data_view?.id,'string');
 const loaded=await api(credentials.kibanaPath+'/api/data_views/data_view/'+encodeURIComponent(created.data_view.id));
 assert.equal(loaded.data_view.title,'visulia-*');
 console.log(JSON.stringify({actualTomEERequests:4,parsedDocuments:4,esqlStatusCounts:[[200,2],[404,1],[500,1]],kibanaDataView:true}));
}finally{
 if(vector.exitCode===null&&vector.signalCode===null){
  const ended=once(vector,'exit');vector.kill('SIGTERM');
  const timer=setTimeout(()=>vector.kill('SIGKILL'),3000);
  try{await ended;}finally{clearTimeout(timer);}
 }
}
