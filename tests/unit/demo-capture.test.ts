import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DemoCapture} from '../../src/agent/demo-capture.js';
async function fixture(t:{after(fn:()=>Promise<void>):void}){
 const root=await mkdtemp(join(tmpdir(),'visulia-capture-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'access.log');await writeFile(path,'old-request\n');
 return {path,capture:new DemoCapture(path,new AbortController().signal)};
}
test('capture reads only the matching actual complete access line, including delayed writes',async t=>{
 const {path,capture}=await fixture(t);await capture.begin();
 const wanted='2026-09-27T03:00:00Z|GET|/demo/ok|200|12|request-1';
 const waiting=capture.take('request-1');
 await appendFile(path,'other-request\n'+wanted.slice(0,20));
 setTimeout(()=>void appendFile(path,wanted.slice(20)+'\n'),40);
 assert.equal(await waiting,wanted);
 await appendFile(path,'2026-09-27T03:00:00Z|GET|/demo/error|500|1|request-2\n');
 assert.match(await capture.take('request-2'),/\|500\|1\|request-2$/);
});
test('capture never invents a log when no matching record arrives and honors cancellation',async t=>{
 const {capture}=await fixture(t);await capture.begin();
 await assert.rejects(capture.take('absent',50),/DEMO_LOG_TIMEOUT/);
 const abort=new AbortController();const other=new DemoCapture('/missing',abort.signal);abort.abort();
 await assert.rejects(other.begin(),/SESSION_STOPPED/);
});
test('capture rejects truncation and oversized incomplete records',async t=>{
 const {path,capture}=await fixture(t);await capture.begin();
 await writeFile(path,'');await assert.rejects(capture.take('request-1'),/DEMO_LOG_CHANGED/);
 const next=new DemoCapture(path,new AbortController().signal);await next.begin();
 await appendFile(path,'x'.repeat(65537));await assert.rejects(next.take('request-1'),/DEMO_LOG_TOO_LARGE/);
});
