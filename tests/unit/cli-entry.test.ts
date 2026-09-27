import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('CLI creates a session, loads packaged templates and deletes the environment on quit',async t=>{
 const seen:string[]=[],id='aabbccdd-1111-2222-3333-001122334455';
 const server=createServer(async(req,res)=>{
  seen.push(req.method+' '+req.url);let text='';for await(const chunk of req)text+=chunk;
  res.setHeader('content-type','application/json');
  if(req.method==='POST'&&req.url==='/v1/sessions'){res.end(JSON.stringify({id,token:'a'.repeat(43)}));return;}
  assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(43));
  if(req.url?.endsWith('/api/runs')){const config=JSON.parse(text);assert(config.parser.includes('parse_regex'));assert.equal(config.mapping.dynamic,'strict');res.end(JSON.stringify({id}));}
  else res.end(JSON.stringify({state:req.method==='DELETE'?'deleted':'ready'}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const address=server.address();assert(address&&typeof address!=='string');
 const child=spawn(process.execPath,[process.env.VISULIA_CLI_ENTRY??'dist/src/cli/main.js','--server',`http://127.0.0.1:${address.port}`],{stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
 child.stdin.end('quit\n');const [code]=await once(child,'exit');
 assert.equal(code,0,output);assert(output.includes('削除を確認'));
 assert(seen.includes('POST /v1/sessions/'+id+'/api/runs'));
 assert.equal(seen.at(-1),'DELETE /v1/sessions/'+id);
 assert(!output.includes('a'.repeat(43)));
});
test('input disconnect during provisioning cancels polling and requests deletion promptly',{timeout:5000},async t=>{
 const id='aabbccdd-1111-2222-3333-001122334455';let child:ReturnType<typeof spawn>|undefined,deleted=false;
 const server=createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.method==='POST'){res.end(JSON.stringify({id,token:'a'.repeat(43)}));return;}
  if(req.method==='DELETE'){deleted=true;res.end(JSON.stringify({state:'deleted'}));return;}
  res.end(JSON.stringify({state:'provisioning'}));child!.stdin!.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{child?.kill('SIGKILL');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const address=server.address();assert(address&&typeof address!=='string');
 child=spawn(process.execPath,[process.env.VISULIA_CLI_ENTRY??'dist/src/cli/main.js','--server',`http://127.0.0.1:${address.port}`],{stdio:['pipe','pipe','pipe']});
 child.stdout!.resume();child.stderr!.resume();
 const [code]=await once(child,'exit');assert.equal(code,0);assert(deleted);
});
