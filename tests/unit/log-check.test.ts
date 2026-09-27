import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLogs} from '../../src/pipeline/check.js';
import {readFile} from 'node:fs/promises';
const mapping=JSON.parse(await readFile('templates/mappings/access.json','utf8'));
const parser=await readFile('templates/parsers/access.vrl','utf8');
const metadata={format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'tomee'};
test('preflight rejects missing, excessive and oversized data before starting Vector',async()=>{
 const common={parser,mapping,metadata,runId:'run-001'};
 for(const lines of [[],['x'.repeat(65537)],Array.from({length:20001},()=>'-')]){
  await assert.rejects(checkLogs({...common,lines},new AbortController().signal,'/missing/vector'),/INVALID_LOG_INPUT/);
 }
});
test('preflight refuses invalid schema and parser size before invoking the runtime',async()=>{
 const common={parser,mapping,metadata,runId:'run-001',lines:['line']};
 await assert.rejects(checkLogs({...common,parser:'x'.repeat(65537)},new AbortController().signal,'/missing/vector'),/INVALID_CONFIG/);
 await assert.rejects(checkLogs({...common,mapping:{}},new AbortController().signal,'/missing/vector'));
});
