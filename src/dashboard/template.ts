import {rewriteRunReference} from './references.js';
type Api=(path:string,method?:string,body?:any)=>Promise<any>;
const placeholder='{{VISULIA_INDEX}}';
function runIndex(id:string){if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))throw new Error('INVALID_RUN');return 'visulia-'+id;}
function dashboardId(id:string){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('INVALID_DASHBOARD');return id;}
async function basePath(api:Api){const base=(await api('/credentials'))?.kibanaPath;if(typeof base!=='string'||!/^\/s\/[a-f0-9-]{36}\/kibana$/.test(base))throw new Error('INVALID_RESPONSE');return base;}
function definition(value:any){
 let body:any;
 try{const text=JSON.stringify(value);if(Buffer.byteLength(text)>1024*1024)throw new Error();body=JSON.parse(text);}catch{throw new Error('INVALID_TEMPLATE');}
 if(!body||typeof body.title!=='string'||!body.title||!Array.isArray(body.panels)||body.panels.length<1||body.panels.length>100)throw new Error('INVALID_TEMPLATE');
 if(body.pinned_panels?.length)throw new Error('UNSUPPORTED_TEMPLATE_PANEL');
 const sources:{query:string}[]=[];
 for(const panel of body.panels){
  if(!panel||!panel.config||panel.config.ref_id)throw new Error('UNSUPPORTED_TEMPLATE_PANEL');
  delete panel.id;
  if(panel.type==='markdown'){if(typeof panel.config.content!=='string')throw new Error('INVALID_TEMPLATE');continue;}
  if(panel.type!=='vis')throw new Error('UNSUPPORTED_TEMPLATE_PANEL');
  const configs=panel.config.type==='xy'?panel.config.layers:[panel.config];
  if(!Array.isArray(configs)||!configs.length)throw new Error('INVALID_TEMPLATE');
  for(const config of configs){
   const source=config?.data_source;
   if(source?.type!=='esql'||typeof source.query!=='string'||!source.query.trim()||source.query.length>65536)throw new Error('UNSUPPORTED_TEMPLATE_PANEL');
   sources.push(source);
  }
 }
 if(!sources.length)throw new Error('INVALID_TEMPLATE');
 return {body,sources};
}
export async function pullDashboardTemplate(runId:string,id:string,api:Api):Promise<any>{
 const index=runIndex(runId);dashboardId(id);
 const saved=await api(await basePath(api)+'/api/dashboards/'+id);
 if(saved?.warnings?.length)throw new Error('DASHBOARD_INCOMPLETE');
 const {body,sources}=definition(saved?.data);
 let matched=false;
 for(const source of sources){const result=rewriteRunReference(source.query,index,placeholder);matched ||= result.matched;source.query=result.query;}
 if(!matched)throw new Error('TEMPLATE_RUN_REFERENCE_MISSING');
 return {version:1,dashboard:body};
}
export async function applyDashboardTemplate(runId:string,template:any,api:Api):Promise<{id:string;path:string}>{
 const index=runIndex(runId);
 if(template?.version!==1)throw new Error('INVALID_TEMPLATE');
 const {body,sources}=definition(template.dashboard);
 let matched=false;
 for(const source of sources){const result=rewriteRunReference(source.query,placeholder,index);matched ||= result.matched;source.query=result.query;}
 if(!matched)throw new Error('TEMPLATE_RUN_REFERENCE_MISSING');
 const base=await basePath(api);
 const bounds=await api('/elasticsearch/_query','POST',{query:`FROM ${index} | STATS first = MIN(@timestamp), last = MAX(@timestamp)`});
 const first=bounds?.values?.[0]?.[0],last=bounds?.values?.[0]?.[1];
 if(bounds?.is_partial||typeof first!=='string'||typeof last!=='string'||!Number.isFinite(Date.parse(first))||!Number.isFinite(Date.parse(last)))throw new Error('LOGS_REQUIRED');
 const from=new Date(Date.parse(first)-1000).toISOString(),to=new Date(Date.parse(last)+1000).toISOString();
 // A new run gets its own top-level time range; custom per-panel settings stay explicit.
 body.time_range={from,to:Date.parse(last)>Date.now()?to:'now'};
 for(const source of sources){
  const result=await api('/elasticsearch/_query','POST',{query:source.query.replaceAll('?_tstart',`TO_DATETIME("${from}")`).replaceAll('?_tend',`TO_DATETIME("${to}")`)});
  if(result?.is_partial||!Array.isArray(result?.columns)||!Array.isArray(result?.values))throw new Error('INVALID_QUERY_RESULT');
 }
 const created=await api(base+'/api/dashboards','POST',body),id=dashboardId(created?.id);
 const saved=await api(base+'/api/dashboards/'+id);
 if(saved?.warnings?.length)throw new Error('DASHBOARD_INCOMPLETE');
 const verified=definition(saved?.data);
 if(verified.body.panels.length!==body.panels.length||verified.body.title!==body.title||JSON.stringify(verified.sources.map(source=>source.query))!==JSON.stringify(sources.map(source=>source.query)))throw new Error('DASHBOARD_VERIFY_FAILED');
 return {id,path:base+'/app/dashboards#/view/'+id};
}
