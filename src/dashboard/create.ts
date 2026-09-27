type Api=(path:string,method?:string,body?:any)=>Promise<any>;
/** Initial 9.4 API definition. Becomes a reusable template only after runtime and
 * browser validation. No existing dashboard is overwritten by this operation. */
export async function createDashboard(runId:string,api:Api):Promise<{id:string;path:string}>{
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId))throw new Error('INVALID_RUN');
 const credentials=await api('/credentials'),base=credentials?.kibanaPath;
 if(typeof base!=='string'||!/^\/s\/[a-f0-9-]{36}\/kibana$/.test(base))throw new Error('INVALID_RESPONSE');
 const index='visulia-'+runId;
 const mapping=await api('/elasticsearch/'+index+'/_mapping');
 const properties=mapping?.[index]?.mappings?.properties;
 if(!properties||typeof properties!=='object')throw new Error('INVALID_MAPPING_RESPONSE');
 const hasDuration=properties.event?.properties?.duration?.type==='long';
 const bounds=await api('/elasticsearch/_query','POST',{query:`FROM ${index} | STATS first = MIN(@timestamp), last = MAX(@timestamp)`});
 if(bounds?.is_partial===true)throw new Error('INVALID_QUERY_RESULT');
 const first=bounds?.values?.[0]?.[0],last=bounds?.values?.[0]?.[1];
 if(typeof first!=='string'||typeof last!=='string'||!Number.isFinite(Date.parse(first))||!Number.isFinite(Date.parse(last)))throw new Error('LOGS_REQUIRED');
 const from=new Date(Date.parse(first)-1000).toISOString(),to=new Date(Date.parse(last)+1000).toISOString();
 const source=`FROM ${index} | WHERE @timestamp >= ?_tstart AND @timestamp <= ?_tend`;
 const queries=[
  `${source} | STATS requests = COUNT(*)`,
  `${source} | STATS total = COUNT(*), failures = SUM(CASE(http.response.status_code >= 500, 1, 0)) | EVAL error_percent = CASE(total > 0, 100.0 * failures / total, 0.0) | KEEP error_percent`,
  hasDuration?`${source} | STATS p95_ns = PERCENTILE(event.duration, 95) | EVAL p95_ms = p95_ns / 1000000.0 | KEEP p95_ms`:undefined,
  `${source} | STATS requests = COUNT(*) BY bucket_time = BUCKET(@timestamp, 75, ?_tstart, ?_tend) | SORT bucket_time`,
  `${source} | STATS requests = COUNT(*) BY host.name, url.path, http.response.status_code | SORT requests DESC | LIMIT 100`,
  `${source} | SORT @timestamp DESC | KEEP @timestamp, host.name, url.path, http.response.status_code, ${hasDuration?'event.duration, ':''}event.original | LIMIT 100`,
 ];
 // Validate with concrete dates; Kibana supplies these parameters when rendering.
 for(const query of queries.filter((query):query is string=>query!==undefined)){
  const checked=await api('/elasticsearch/_query','POST',{query:query.replaceAll('?_tstart',`TO_DATETIME("${from}")`).replaceAll('?_tend',`TO_DATETIME("${to}")`)});
  if(checked?.is_partial===true||!Array.isArray(checked?.columns)||!Array.isArray(checked?.values))throw new Error('INVALID_QUERY_RESULT');
 }
 const data=(i:number)=>({type:'esql',query:queries[i]});
 const metric=(title:string,column:string,i:number,x:number)=>({type:'vis',grid:{x,y:0,w:16,h:6},config:{type:'metric',title,data_source:data(i),metrics:[{type:'primary',column}]}});
 const body={title:'VISULIA — '+runId.slice(0,8),description:'TomEE access logs: overview, trend, breakdown and original evidence.',time_range:{from,to:Date.parse(last)>Date.now()?to:'now'},refresh_interval:{pause:false,value:5000},panels:[
  metric('Requests','requests',0,0),metric('5xx rate (%)','error_percent',1,16),hasDuration?metric('Response time p95 (ms)','p95_ms',2,32):{type:'markdown',grid:{x:32,y:0,w:16,h:6},config:{settings:{open_links_in_new_tab:true},content:'### Response time unavailable\nThis log mapping does not include a duration field.'}},
  {type:'vis',grid:{x:0,y:6,w:48,h:12},config:{type:'xy',title:'Requests over time',layers:[{type:'line',data_source:data(3),x:{column:'bucket_time'},y:[{column:'requests'}]}]}},
  {type:'vis',grid:{x:0,y:18,w:48,h:12},config:{type:'data_table',title:'Server / path / status',data_source:data(4),rows:[{column:'host.name'},{column:'url.path'},{column:'http.response.status_code'}],metrics:[{column:'requests'}]}},
  {type:'vis',grid:{x:0,y:30,w:48,h:16},config:{type:'data_table',title:'Original access log evidence (latest 100)',data_source:data(5),rows:[{column:'@timestamp'},{column:'host.name'},{column:'url.path'},{column:'event.original'}],metrics:[{column:'http.response.status_code'},...(hasDuration?[{column:'event.duration'}]:[])]}},
 ]};
 const created=await api(base+'/api/dashboards','POST',body);
 if(typeof created?.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(created.id))throw new Error('INVALID_DASHBOARD_RESPONSE');
 const saved=await api(base+'/api/dashboards/'+created.id);
 if(saved?.warnings?.length)throw new Error('DASHBOARD_INCOMPLETE');
 const panels=saved?.data?.panels;
 if(!Array.isArray(panels)||panels.length!==6)throw new Error('DASHBOARD_VERIFY_FAILED');
 const savedQueries=panels.flatMap((panel:any)=>panel.config?.data_source?[panel.config.data_source.query]:(panel.config?.layers??[]).map((layer:any)=>layer.data_source?.query));
 if(JSON.stringify(savedQueries)!==JSON.stringify(queries.filter(query=>query!==undefined)))throw new Error('DASHBOARD_VERIFY_FAILED');
 return {id:created.id,path:base+'/app/dashboards#/view/'+created.id};
}
