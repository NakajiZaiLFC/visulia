import test from 'node:test';
import assert from 'node:assert/strict';
import {runCommand} from '../../src/agent/command.js';

test('bootstrap commands receive secret on stdin and only the explicitly provided environment',async()=>{
 process.env.VISULIA_TEST_PARENT_SECRET='parent-secret';
 try{
  await runCommand(process.execPath,['-e',"let s=''; process.stdin.on('data',x=>s+=x); process.stdin.on('end',()=>process.exit(s==='stdin-secret\\n'&&!process.env.VISULIA_TEST_PARENT_SECRET?0:2))"],{},new AbortController().signal,'stdin-secret\n');
 }finally{delete process.env.VISULIA_TEST_PARENT_SECRET;}
});
test('command failure and cancellation discard secret-bearing output',async()=>{
 await assert.rejects(runCommand(process.execPath,['-e',"console.error('sensitive');process.exit(1)"],{},new AbortController().signal),error=>error instanceof Error&&error.message==='BOOTSTRAP_COMMAND_FAILED');
 await assert.rejects(runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{},AbortSignal.timeout(100)),/BOOTSTRAP_COMMAND_FAILED/);
});
