import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPipeline,type PipelineOptions} from '../../src/pipeline/config.js';
const options=():PipelineOptions=>({directory:'/work/runs/run-001',runId:'run-001',metadata:{format:'pipe-v1',duration_unit:'us',service_name:'demo',service_version:'10.2.0',environment:'demo',host_name:'tomee'},parser:readFileSync('templates/parsers/access.vrl','utf8'),mapping:JSON.parse(readFileSync('templates/mappings/access.json','utf8')),elasticsearch:{url:'http://127.0.0.1:9200',username:'writer',password:'secret'}});
test('pipeline configuration includes bounded retry buffer and separate invalid-line sink',()=>{
 const config=createPipeline(options()) as any;
 assert.equal(config.sinks.elasticsearch.buffer.when_full,'block');
 assert.equal(config.sinks.elasticsearch.buffer.type,'disk');
 assert.equal(config.sinks.elasticsearch.bulk.index,'visulia-run-001');
 assert.deepEqual(config.sinks.quarantine.inputs,['parse.dropped','guard.dropped']);
 assert.equal(config.transforms.parse.reroute_dropped,true);
});
test('invalid metadata and unsafe index IDs fail before producing an ingest pipeline',()=>{
 for(const runId of ['../other','*','UPPER',''])assert.throws(()=>createPipeline({...options(),runId}),/CONFIG/);
 const input=options();delete input.metadata.environment;assert.throws(()=>createPipeline(input),/CONFIG/);
});
