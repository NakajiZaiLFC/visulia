import {timingSafeEqual} from 'node:crypto';
import type {RunManager} from './runs.js';
import type {RuntimeConfig} from './runtime-config.js';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export function createAgentHandler(config:RuntimeConfig,token:string,signal:AbortSignal,fetcher:typeof fetch=fetch,runs?:RunManager):(request:Request)=>Promise<Response>{
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('INVALID_AGENT_TOKEN');
 const expected=Buffer.from('Bearer '+token);
 const userAuthorization='Basic '+Buffer.from(config.secrets.username+':'+config.secrets.password).toString('base64');
 return async request=>{
  const supplied=Buffer.from(request.headers.get('authorization')??'');
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json({error:'UNAUTHORIZED'},401);
  if(signal.aborted)return json({error:'SESSION_STOPPED'},410);
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')return json({status:'ready'});
  if(url.pathname==='/credentials'&&request.method==='GET')return json({username:config.secrets.username,password:config.secrets.password,kibanaPath:config.basePath});
  if(runs&&(url.pathname==='/runs'||url.pathname.startsWith('/runs/'))){
   try{
    if(url.pathname==='/runs'){
     if(request.method==='GET')return json({runs:runs.list()});
     if(request.method==='POST')return json(await runs.create(await request.json()),201);
     return json({error:'METHOD_NOT_ALLOWED'},405);
    }
    const match=/^\/runs\/([a-f0-9-]{36})(?:\/(config|logs|check|ingest|stop|reparse|demo))?$/.exec(url.pathname);
    if(!match)return json({error:'NOT_FOUND'},404);
    const id=match[1]!,action=match[2];
    if(!action&&request.method==='GET')return json(runs.get(id));
    if(action==='config'&&request.method==='PUT')return json(await runs.update(id,await request.json()));
    if(action==='logs'&&request.method==='PUT')return json(await runs.upload(id,new Uint8Array(await request.arrayBuffer())));
    if(request.method==='POST'){
     if(action==='demo')return json(await runs.startDemo(id,await request.json()),202);
     if(action==='check')return json(await runs.check(id));
     if(action==='ingest')return json(await runs.ingest(id),202);
     if(action==='stop')return json(await runs.stop(id));
     if(action==='reparse')return json(await runs.reparse(id),202);
    }
    return json({error:'METHOD_NOT_ALLOWED'},405);
   }catch(error){
    if(error instanceof SyntaxError)return json({error:'INVALID_REQUEST'},400);
    const code=error instanceof Error?error.message:'';
    const statuses:Record<string,number>={DEMO_UNAVAILABLE:503,INVALID_DEMO:400,RUN_NOT_FOUND:404,RUN_CAPACITY:409,RUN_ACTIVE:409,CHECK_REQUIRED:409,REPARSE_REQUIRED:409,INVALID_CONFIG:400,INVALID_LOG_INPUT:400,LOGS_REQUIRED:400,SESSION_STOPPED:410,VECTOR_EXECUTION_FAILED:422,VECTOR_START_FAILED:502,INGEST_EXITED:502,ELASTICSEARCH_FAILED:502};
    return json({error:Object.hasOwn(statuses,code)?code:'INTERNAL_ERROR'},Object.hasOwn(statuses,code)?statuses[code]:500);
   }
  }
  let target:string;
  if(url.pathname.startsWith('/elasticsearch/'))target='http://127.0.0.1:9200'+url.pathname.slice('/elasticsearch'.length)+url.search;
  else if(url.pathname===config.basePath||url.pathname.startsWith(config.basePath+'/'))target='http://127.0.0.1:5601'+url.pathname+url.search;
  else return json({error:'NOT_FOUND'},404);
  if(url.pathname.includes('//')||/%(?:00|5c)/i.test(url.pathname))return json({error:'INVALID_PATH'},400);
  const headers=new Headers({authorization:userAuthorization});
  for(const key of ['content-type','accept','kbn-xsrf','kbn-version','if-match','if-none-match','range']){
   const value=request.headers.get(key);if(value!==null)headers.set(key,value);
  }
  try{
   const init={method:request.method,headers,redirect:'manual' as const,signal:AbortSignal.any([signal,request.signal,AbortSignal.timeout(30000)]),body:request.body,duplex:'half'};
   const response=await fetcher(target,init);
   const outputHeaders=new Headers(response.headers);
   // fetch decodes compressed bodies. Never forward stale lengths or hop-by-hop headers.
   for(const key of ['connection','keep-alive','transfer-encoding','content-encoding','content-length','set-cookie','proxy-authenticate','proxy-authorization','te','trailer','upgrade'])outputHeaders.delete(key);
   outputHeaders.set('cache-control','no-store');
   const location=outputHeaders.get('location');
   if(location){
    if(location.startsWith('http://127.0.0.1:5601'+config.basePath+'/'))outputHeaders.set('location',location.slice('http://127.0.0.1:5601'.length));
    else if(!location.startsWith('/')||location.startsWith('//'))outputHeaders.delete('location');
   }
   return new Response(response.body,{status:response.status,headers:outputHeaders});
  }catch{return json({error:signal.aborted?'SESSION_STOPPED':'UPSTREAM_UNAVAILABLE'},signal.aborted?410:502);}
 };
}
