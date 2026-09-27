import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionClient} from '../../src/cli/client.js';
const id='aabbccdd-1111-2222-3333-001122334455',token='a'.repeat(43);
test('CLI client confines credentials to its server and session and revokes on close',async()=>{
 const calls:{url:string;method:string;auth:string|null}[]=[];
 const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(input),method:init?.method??'GET',auth:new Headers(init?.headers).get('authorization')});
  assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('kbn-xsrf'),'visulia');
  return Response.json(calls.length===1?{id,token,heartbeatSeconds:30}:{state:'deleted'});
 }) as typeof fetch;
 const client=new SessionClient('https://demo.example',fetcher);
 await client.create();await client.api('/runs','POST',{hello:'world'});await client.close();
 assert.deepEqual(calls.map(c=>c.auth),[null,'Bearer '+token,'Bearer '+token]);
 assert.equal(calls[1]?.url,`https://demo.example/v1/sessions/${id}/api/runs`);
 assert.equal(calls[2]?.method,'DELETE');
 await assert.rejects(client.api('/runs'),/NO_SESSION/);
});
test('CLI rejects insecure remote origins, URL credentials and escaping API paths',async()=>{
 for(const url of ['http://example.com','https://u:p@example.com','https://example.com/path','https://example.com?q=x'])assert.throws(()=>new SessionClient(url),/INVALID_SERVER/);
 const client=new SessionClient('http://127.0.0.1:8080',(async()=>Response.json({id,token})) as typeof fetch);await client.create();
 for(const path of ['https://other/','//other/','/../health','/x/%2e%2e/y','/runs#secret'])await assert.rejects(client.api(path),/INVALID_PATH/);
 await client.close();
});
test('CLI errors do not expose raw upstream bodies or session tokens',async()=>{
 const client=new SessionClient('https://demo.example',(async()=>new Response('secret-token',{status:502})) as typeof fetch);
 await assert.rejects(client.create(),error=>error instanceof Error&&error.message==='SERVER_ERROR_502');
});
test('browser link validation rejects a server response pointing to another origin',async()=>{
 let calls=0;
 const client=new SessionClient('https://demo.example',(async()=>Response.json(++calls===1?{id,token}:{url:'https://other.example/#ticket=secret'})) as typeof fetch);
 await client.create();await assert.rejects(client.browserLink(),/INVALID_RESPONSE/);await client.close();
});
test('CLI exposes only known structured error codes, never arbitrary server error text',async()=>{
 const known=new SessionClient('https://demo.example',(async()=>Response.json({error:'CAPACITY'},{status:503})) as typeof fetch);
 await assert.rejects(known.create(),/CAPACITY/);
 const unknown=new SessionClient('https://demo.example',(async()=>Response.json({error:'SECRET_SESSION_TOKEN'},{status:503})) as typeof fetch);
 await assert.rejects(unknown.create(),error=>error instanceof Error&&error.message==='SERVER_ERROR_503');
});
