// Runs only inside the disposable CI test container. No real user data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const base='http://127.0.0.1:8081';
const authorization='Bearer '+process.env.VISULIA_AGENT_TOKEN;
async function api(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{authorization,'content-type':'application/json','kbn-xsrf':'visulia-smoke'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(65000)});
 const data=await response.json();assert(response.ok,`API rejected ${method} ${path}: ${response.status} ${data.error??''}`);return data;
}
assert.equal((await fetch(base+'/health')).status,401);
const credentials=await api('/credentials');
const mapping=JSON.parse(await readFile('/opt/visulia/templates/mappings/access.json','utf8'));
const run=await api('/runs','POST',{metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'ci',host_name:'demo'},parser:await readFile('/opt/visulia/templates/parsers/access.vrl','utf8'),mapping});
const runPath='/runs/'+run.id,index='visulia-'+run.id;
async function generate(count){
 await api(runPath+'/demo','POST',{scenario:'mixed',count,rate:5});
 let state;
 for(let i=0;i<100;i++){
  state=await api(runPath);
  if(state.demo.state!=='running')break;
  await delay(100);
 }
 assert.equal(state.demo.state,'complete');assert.equal(state.demo.received,count);
}
async function delivered(expected){
 let count=0;
 for(let i=0;i<60;i++){
  assert.equal((await api(runPath)).state,'ingesting');
  await api('/elasticsearch/'+index+'/_refresh','POST');
  count=(await api('/elasticsearch/'+index+'/_count')).count;
  if(count===expected)break;
  await delay(500);
 }
 assert.equal(count,expected,'actual TomEE -> run capture -> Vector -> Elasticsearch delivery');
}
await generate(4);
const checked=await api(runPath+'/check','POST');
assert.deepEqual(checked.check,{valid:true,accepted:4,rejected:0,total:4});
await api(runPath+'/ingest','POST');
try{
 await delivered(4);
 // Continue producing real access records while the same Vector process tails input.
 await generate(4);await delivered(8);
 const query=await api('/elasticsearch/_query','POST',{query:`FROM ${index} | STATS requests = COUNT(*) BY http.response.status_code | SORT http.response.status_code`});
 const statusIndex=query.columns.findIndex(c=>c.name==='http.response.status_code');
 const countIndex=query.columns.findIndex(c=>c.name==='requests');
 assert.deepEqual(query.values.map(row=>[row[statusIndex],row[countIndex]]),[[200,4],[404,2],[500,2]]);
 const lines=(await readFile('/work/raw/access.log','utf8')).trim().split('\n');
 assert.equal(lines.length,8,'health requests must not appear in access logs');
 await api(runPath+'/stop','POST');
 await api(runPath+'/reparse','POST');await delivered(8);
 const created=await api(credentials.kibanaPath+'/api/data_views/data_view','POST',{data_view:{title:index,name:'VISULIA smoke',timeFieldName:'@timestamp'}});
 assert.equal(typeof created.data_view?.id,'string');
 const loaded=await api(credentials.kibanaPath+'/api/data_views/data_view/'+encodeURIComponent(created.data_view.id));
 assert.equal(loaded.data_view.title,index);
 console.log(JSON.stringify({actualTomEERequests:8,parsedDocuments:8,continuousIngest:true,reparse:true,esqlStatusCounts:[[200,4],[404,2],[500,2]],kibanaDataView:true}));
}finally{await api(runPath+'/stop','POST');}
