import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('runtime entrypoint rejects absent identity or invalid internal token before starting services',()=>{
 for(const env of [{},{VISULIA_SESSION_ID:'aabbccdd-1111-2222-3333-001122334455',VISULIA_AGENT_TOKEN:'invalid-secret'}]){
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../src/agent/main.js',import.meta.url))],{env,encoding:'utf8',timeout:2000});
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr.trim(),'RUNTIME_START_FAILED');
 }
});
