import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboard} from '../../src/dashboard/create.js';
const id='aabbccdd-1111-2222-3333-001122334455';
const mapping={['visulia-'+id]:{mappings:{properties:{event:{properties:{duration:{type:'long'}}}}}}};
test('dashboard validates each ES|QL panel before creating and reading back a new dashboard',async()=>{
 const calls:{path:string;method:string;body:any}[]=[];let created:any;
 const api=async(path:string,method='GET',body?:any)=>{
  calls.push({path,method,body});
  if(path.endsWith('/_mapping'))return mapping;
  if(path==='/credentials')return {kibanaPath:'/s/'+id+'/kibana'};
  if(path==='/elasticsearch/_query')return body.query.includes('MIN(@timestamp)')?{values:[['2026-09-27T00:00:00Z','2026-09-27T00:01:00Z']]}:{columns:[{name:'requests'}],values:[[4]]};
  if(method==='POST'){created=body;return {id:'dashboard-1',data:body};}
  return {id:'dashboard-1',data:created};
 };
 const result=await createDashboard(id,api);
 assert.equal(result.path,`/s/${id}/kibana/app/dashboards#/view/dashboard-1`);
 assert.equal(created.panels.length,6);
 assert(created.panels[3].config.layers[0].data_source.query.includes('BUCKET(@timestamp, 75, ?_tstart, ?_tend)'));
 assert.equal(created.time_range.to,'now');
 const creation=calls.findIndex(c=>c.path.endsWith('/api/dashboards'));
 assert.equal(calls.slice(0,creation).filter(c=>c.path==='/elasticsearch/_query').length,7);
 assert(calls.filter(c=>c.path==='/elasticsearch/_query').every(c=>!c.body.query.includes('?_t')));
 assert.equal(calls.at(-1)?.method,'GET');
 assert.equal(calls.some(c=>c.path.includes('data_views')),false);
});
test('query failure prevents dashboard creation and invalid run IDs prevent all requests',async()=>{
 let writes=0;
 const api=async(path:string,method='GET',body?:any)=>{
  if(path.endsWith('/_mapping'))return mapping;
  if(path==='/credentials')return {kibanaPath:'/s/'+id+'/kibana'};
  if(path==='/elasticsearch/_query'&&body.query.includes('MIN(@timestamp)'))return {values:[['2026-09-27T00:00:00Z','2026-09-27T00:01:00Z']]};
  if(path==='/elasticsearch/_query')throw new Error('QUERY_REJECTED');
  if(method==='POST')writes++;
 };
 await assert.rejects(createDashboard(id,api),/QUERY_REJECTED/);assert.equal(writes,0);
 await assert.rejects(createDashboard('*',async()=>{throw new Error('CALLED');}),/INVALID_RUN/);
});
test('dashboard readback must retain every panel query and partial ES|QL results are rejected',async()=>{
 let created:any;
 const api=async(path:string,method='GET',body?:any)=>{
  if(path.endsWith('/_mapping'))return mapping;
  if(path==='/credentials')return {kibanaPath:'/s/'+id+'/kibana'};
  if(path==='/elasticsearch/_query')return body.query.includes('MIN(@timestamp)')?{values:[['2026-09-27T00:00:00Z','2026-09-27T00:01:00Z']]}:{columns:[],values:[]};
  if(method==='POST'){created=structuredClone(body);return {id:'changed'};}
  created.panels[0].config.data_source.query='FROM unrelated';return {data:created};
 };
 await assert.rejects(createDashboard(id,api),/DASHBOARD_VERIFY_FAILED/);
 const partial=async(path:string,method='GET',body?:any)=>path==='/elasticsearch/_query'&&!body.query.includes('MIN(@timestamp)')?{is_partial:true,columns:[],values:[]}:api(path,method,body);
 await assert.rejects(createDashboard(id,partial),/INVALID_QUERY_RESULT/);
});

test('a valid mapping without optional duration still creates overview, trend and evidence',async()=>{
 let created:any;
 const api=async(path:string,method='GET',body?:any)=>{
  if(path.endsWith('/_mapping'))return {['visulia-'+id]:{mappings:{properties:{event:{properties:{}}}}}};
  if(path==='/credentials')return {kibanaPath:'/s/'+id+'/kibana'};
  if(path==='/elasticsearch/_query'){
   assert(!body.query.includes('event.duration'));
   return body.query.includes('MIN(@timestamp)')?{values:[['2026-09-27T00:00:00Z','2026-09-27T00:01:00Z']]}:{columns:[],values:[]};
  }
  if(method==='POST'){created=body;return {id:'without-duration'};}
  return {data:created};
 };
 await createDashboard(id,api);
 assert.equal(created.panels[2].type,'markdown');
 assert.equal(created.panels[5].config.metrics.some((metric:any)=>metric.column==='event.duration'),false);
});
