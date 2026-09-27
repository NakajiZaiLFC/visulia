import {timingSafeEqual} from 'node:crypto';
import type {RuntimeConfig} from './runtime-config.js';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export function createAgentHandler(config:RuntimeConfig,token:string,signal:AbortSignal,fetcher:typeof fetch=fetch):(request:Request)=>Promise<Response>{
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
