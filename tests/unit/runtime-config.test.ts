import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeConfig} from '../../src/agent/runtime-config.js';
const id='09d40e78-b0b3-47ee-8c16-028950feb924';
test('each runtime gets fresh credentials with internal-only service listeners',()=>{
 const a=createRuntimeConfig(id),b=createRuntimeConfig(id);
 assert.notEqual(a.secrets.elastic,b.secrets.elastic);assert.notEqual(a.secrets.password,b.secrets.password);
 assert.match(a.secrets.username,/^visulia_/);
 assert.match(a.elasticsearch,/xpack.security.enabled: true/);
 assert.match(a.elasticsearch,/network.host: "127.0.0.1"/);
 assert.match(a.kibana,/server.host: "127.0.0.1"/);
 assert.ok(a.kibana.includes(`/s/${id}/kibana`));
 assert.ok(!a.kibana.includes(a.secrets.elastic));
 assert.ok(!a.kibana.includes(a.secrets.password));
});
test('runtime identity cannot inject service configuration',()=>{
 for(const id of ['../escape','x\nserver.host: bad','','not-a-uuid'])assert.throws(()=>createRuntimeConfig(id),/INVALID_SESSION/);
});
