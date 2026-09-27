export class SessionClient {
 readonly server:string;
 #session:{id:string;token:string}|undefined;
 #timer:ReturnType<typeof setInterval>|undefined;
 #heartbeat=false;
 constructor(server:string,private readonly fetcher:typeof fetch=fetch,private readonly signal?:AbortSignal){
  let url;try{url=new URL(server);}catch{throw new Error('INVALID_SERVER');}
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('INVALID_SERVER');
  this.server=url.origin;
 }
 private async request(path:string,method:string,body?:unknown,cleanup=false):Promise<any>{
  const headers=new Headers();if(this.#session)headers.set('authorization','Bearer '+this.#session.token);
  let content:BodyInit|undefined;
  if(body instanceof Uint8Array){headers.set('content-type','application/octet-stream');content=body as BodyInit;}
  else if(body!==undefined){headers.set('content-type','application/json');content=JSON.stringify(body);}
  let response;
  try{response=await this.fetcher(this.server+path,{method,headers,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(cleanup?10000:70000),...(!cleanup&&this.signal?[this.signal]:[])]),...(content===undefined?{}:{body:content})});}
  catch{throw new Error('CONNECTION_FAILED');}
  if(!response.ok)throw new Error('SERVER_ERROR_'+response.status);
  try{return await response.json();}catch{throw new Error('INVALID_RESPONSE');}
 }
 async create(){
  if(this.#session)throw new Error('SESSION_EXISTS');
  const result=await this.request('/v1/sessions','POST');
  if(!result||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.id)||!/^[A-Za-z0-9_-]{43}$/.test(result.token))throw new Error('INVALID_RESPONSE');
  this.#session={id:result.id,token:result.token};return {id:result.id};
 }
 private path(){if(!this.#session)throw new Error('NO_SESSION');return '/v1/sessions/'+this.#session.id;}
 async status(){return this.request(this.path(),'GET');}
 heartbeat(onError:()=>void){
  if(this.#timer)throw new Error('HEARTBEAT_STARTED');
  this.path();
  this.#timer=setInterval(()=>{
   if(this.#heartbeat)return;this.#heartbeat=true;
   void this.request(this.path()+'/heartbeat','POST').catch(onError).finally(()=>{this.#heartbeat=false;});
  },30000);this.#timer.unref();
 }
 async api(path:string,method='GET',body?:unknown){
  if(!path.startsWith('/')||path.startsWith('//')||/[\\#\x00-\x20]/.test(path)||/%(?:2e|2f|5c)/i.test(path)||path.split(/[/?]/).some(part=>part==='..'||part==='.'))throw new Error('INVALID_PATH');
  return this.request(this.path()+'/api'+path,method,body);
 }
 async browserLink():Promise<string>{
  const path=this.path(),id=this.#session!.id;
  const response=await this.request(path+'/browser','POST');
  let url;try{url=new URL(response.url);}catch{throw new Error('INVALID_RESPONSE');}
  if(url.origin!==this.server||url.username||url.password||url.pathname!==`/s/${id}/open`||url.search||!/^#ticket=[A-Za-z0-9_-]{43}$/.test(url.hash))throw new Error('INVALID_RESPONSE');
  return url.href;
 }
 async close(){
  if(this.#timer){clearInterval(this.#timer);this.#timer=undefined;}
  if(!this.#session)return {state:'absent'};
  try{return await this.request(this.path(),'DELETE',undefined,true);}finally{this.#session=undefined;}
 }
}
