import {createServer,type IncomingMessage,type Server} from 'node:http';
import {Readable} from 'node:stream';
const MAX_BODY=10*1024*1024;
class PayloadTooLarge extends Error{}
function readBody(request:IncomingMessage):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const parts:Buffer[]=[];let bytes=0,failed=false;
  request.on('data',(part:Buffer)=>{
   if(failed)return;
   bytes+=part.length;
   if(bytes>MAX_BODY){failed=true;parts.length=0;reject(new PayloadTooLarge());}
   else parts.push(part);
  });
  request.once('end',()=>{if(!failed)resolve(Buffer.concat(parts));});
  request.once('error',()=>reject(new Error('REQUEST_FAILED')));
 });
}
export async function serveAgent(handler:(request:Request)=>Promise<Response>,signal:AbortSignal,port=8081,host='0.0.0.0'):Promise<Server>{
 if(signal.aborted)throw new Error('SESSION_STOPPED');
 const server=createServer({requestTimeout:30000,headersTimeout:10000,maxHeaderSize:16384},(incoming,outgoing)=>{
  const client=new AbortController();
  incoming.once('aborted',()=>client.abort());
  outgoing.once('close',()=>{if(!outgoing.writableFinished)client.abort();});
  void (async()=>{
   try{
    const data=await readBody(incoming);
    const headers=new Headers();
    for(const [key,value] of Object.entries(incoming.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
    if(!incoming.url?.startsWith('/')||incoming.url.startsWith('//')){outgoing.writeHead(400);outgoing.end();return;}
    const method=incoming.method??'GET';
    const request=new Request('http://agent'+incoming.url,{method,headers,...(method==='GET'||method==='HEAD'?{}:{body:new Uint8Array(data)}),signal:AbortSignal.any([signal,client.signal])});
    const response=await handler(request);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body){
     const body=Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
     body.once('error',()=>outgoing.destroy());
     outgoing.once('close',()=>body.destroy());
     body.pipe(outgoing);
    }else outgoing.end();
   }catch(error){
    if(outgoing.headersSent){outgoing.destroy();return;}
    outgoing.writeHead(error instanceof PayloadTooLarge?413:500,{'content-type':'application/json','cache-control':'no-store'});
    outgoing.end(JSON.stringify({error:error instanceof PayloadTooLarge?'PAYLOAD_TOO_LARGE':'INTERNAL_ERROR'}));
   }
  })();
 });
 server.maxConnections=32;server.keepAliveTimeout=5000;
 await new Promise<void>((resolve,reject)=>{
  const stop=()=>{server.closeAllConnections();server.close();reject(new Error('SESSION_STOPPED'));};
  signal.addEventListener('abort',stop,{once:true});
  server.once('close',()=>signal.removeEventListener('abort',stop));
  server.once('error',reject);
  server.listen(port,host,()=>{if(signal.aborted)stop();else resolve();});
 });
 return server;
}
