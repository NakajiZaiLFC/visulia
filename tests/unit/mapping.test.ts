import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMappingGuard} from '../../src/pipeline/mapping.js';
import {readFileSync} from 'node:fs';
const mapping=()=>JSON.parse(readFileSync('templates/mappings/access.json','utf8'));
test('mapping guard covers required common fields and declared extensions',()=>{
  const m=mapping();m.properties.labels.properties.team={type:'keyword'};
  const guard=compileMappingGuard(m);
  assert.match(guard,/schema_version/);assert.match(guard,/team/);assert.match(guard,/status_code/);
});
test('mapping edits cannot silently weaken common schema or enable uncontrolled fields',()=>{
  let m=mapping();m.dynamic=true;assert.throws(()=>compileMappingGuard(m),/MAPPING/);
  m=mapping();m.properties.http.properties.response.properties.status_code.type='keyword';assert.throws(()=>compileMappingGuard(m),/MAPPING/);
  m=mapping();delete m.properties.event.properties.original;assert.throws(()=>compileMappingGuard(m),/MAPPING/);
  m=mapping();m.properties.foo={type:'unsupported'};assert.throws(()=>compileMappingGuard(m),/MAPPING/);
  m=mapping();m.properties['evil\"\nabort']={type:'keyword'};assert.throws(()=>compileMappingGuard(m),/MAPPING/);
});
