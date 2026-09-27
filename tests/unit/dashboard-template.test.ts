import test from 'node:test';
import assert from 'node:assert/strict';
import {pullDashboardTemplate,applyDashboardTemplate} from '../../src/dashboard/template.js';
const a='aabbccdd-1111-2222-3333-001122334455',b='aabbccdd-1111-2222-3333-001122334466';
const data={title:'My edited panel',panels:[{id:'old-panel',type:'vis',grid:{x:0,y:0,w:48,h:10},config:{type:'metric',data_source:{type:'esql',query:`FROM visulia-${a} | STATS requests = COUNT(*)`},metrics:[{type:'primary',column:'requests'}]}}]};
test('export makes the run reference portable; apply validates and creates without overwriting',async()=>{
 const calls:string[]=[];let saved:any;
 const api=async(path:string,method='GET',body?:any)=>{
  calls.push(method+' '+path);
  if(path==='/credentials')return {kibanaPath:'/s/'+a+'/kibana'};
  if(path.endsWith('/old-dashboard'))return {id:'old-dashboard',data};
  if(path==='/elasticsearch/_query')return body.query.includes('MIN(@timestamp)')?{values:[['2026-09-27T00:00:00Z','2026-09-27T00:01:00Z']]}:{columns:[],values:[]};
  if(method==='POST'){saved=body;return {id:'new-dashboard'};}
  return {data:saved};
 };
 const template=await pullDashboardTemplate(a,'old-dashboard',api);
 assert(template.dashboard.panels[0].config.data_source.query.includes('{{VISULIA_INDEX}}'));
 assert.equal(template.dashboard.panels[0].id,undefined);assert.equal(data.panels[0]!.id,'old-panel');
 const result=await applyDashboardTemplate(b,template,api);
 assert.equal(result.id,'new-dashboard');assert.equal(saved.title,data.title);
 assert(saved.panels[0].config.data_source.query.includes('visulia-'+b));
 assert.equal(calls.some(call=>call.startsWith('PUT')),false);
 assert(calls.findIndex(call=>call==='POST /elasticsearch/_query')<calls.findIndex(call=>call.endsWith('/api/dashboards')));
});
test('reference-backed or non-ESQL panels fail explicitly instead of silently losing content',async()=>{
 const api=async(path:string)=>path==='/credentials'?{kibanaPath:'/s/'+a+'/kibana'}:{data:{...data,panels:[{...data.panels[0],config:{ref_id:'foreign-library-item'}}]}};
 await assert.rejects(pullDashboardTemplate(a,'old-dashboard',api),/UNSUPPORTED_TEMPLATE_PANEL/);
 await assert.rejects(applyDashboardTemplate(b,{version:2,dashboard:data},async()=>{throw new Error('CALLED');}),/INVALID_TEMPLATE/);
});
test('export refuses API warnings about omitted panels rather than creating a partial template',async()=>{
 const api=async(path:string)=>path==='/credentials'?{kibanaPath:'/s/'+a+'/kibana'}:{data,warnings:[{message:'unsupported panel omitted'}]};
 await assert.rejects(pullDashboardTemplate(a,'old-dashboard',api),/DASHBOARD_INCOMPLETE/);
});
test('index portability does not rewrite a matching string literal in a filter',async()=>{
 const original=structuredClone(data);original.panels[0]!.config.data_source.query+=` | WHERE label == "visulia-${a}"`;
 const api=async(path:string)=>path==='/credentials'?{kibanaPath:'/s/'+a+'/kibana'}:{data:original};
 const template=await pullDashboardTemplate(a,'old-dashboard',api);
 assert.equal(template.dashboard.panels[0].config.data_source.query,`FROM {{VISULIA_INDEX}} | STATS requests = COUNT(*) | WHERE label == "visulia-${a}"`);
});
