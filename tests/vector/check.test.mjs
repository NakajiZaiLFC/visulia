import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkLogs} from '../../dist/src/pipeline/check.js';
const parser=await readFile('templates/parsers/access.vrl','utf8');
const mapping=JSON.parse(await readFile('templates/mappings/access.json','utf8'));
const metadata={format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'};
const good='2026-09-27T03:00:00.000Z|GET|/demo/ok|200|1234|request-1';
test('actual Vector preflight checks all rows without an Elasticsearch sink',async()=>{
 const input={parser,mapping,metadata,runId:'run-001',lines:[good,good]};
 assert.deepEqual(await checkLogs(input,new AbortController().signal,process.env.VECTOR_BIN),{valid:true,accepted:2,rejected:0,total:2});
 assert.deepEqual(await checkLogs({...input,lines:[good,'malformed']},new AbortController().signal,process.env.VECTOR_BIN),{valid:false,accepted:1,rejected:1,total:2});
 const altered=parser+'\n.http.response.status_code = "wrong"';
 assert.deepEqual(await checkLogs({...input,parser:altered},new AbortController().signal,process.env.VECTOR_BIN),{valid:false,accepted:0,rejected:2,total:2});
 await assert.rejects(checkLogs({...input,parser:'this is not VRL'},new AbortController().signal,process.env.VECTOR_BIN),/VECTOR_EXECUTION_FAILED/);
});
