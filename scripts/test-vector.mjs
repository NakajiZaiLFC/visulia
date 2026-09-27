import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {compileMappingGuard} from '../dist/src/pipeline/mapping.js';
const directory=await mkdtemp(join(tmpdir(),'visulia-vector-tests-'));
try {
  const config=JSON.parse(await readFile('tests/vector/parser-test.json','utf8'));
  const mapping=JSON.parse(await readFile('templates/mappings/access.json','utf8'));
  config.transforms.parse.file=resolve('templates/parsers/access.vrl');
  config.transforms.guard={type:'remap',inputs:['parse','prepare'],source:compileMappingGuard(mapping),drop_on_error:true,drop_on_abort:true,reroute_dropped:true};
  config.transforms.prepare={type:'remap',inputs:['input'],source:'del(.timestamp)\ndel(.message)\n."@timestamp" = parse_timestamp!(."@timestamp", format: "%+")'};
  config.sinks.discard.inputs=['guard','guard.dropped','parse.dropped'];
  for(const test of config.tests) {
    for(const output of test.outputs??[])if(output.extract_from==='parse')output.extract_from='guard';
  }
  const base=structuredClone(config.tests[0]);
  for(const [unit,value] of [['ns',1234],['ms',1234000000],['s',1234000000000]]) {
    const test=structuredClone(base);test.name=`explicit duration conversion ${unit}`;
    test.inputs[0].log_fields.metadata.duration_unit=unit;
    test.outputs[0].conditions[0].source=`assert_eq!(.event.duration, ${value})`;
    config.tests.push(test);
  }
  for(const [unit,input,value] of [['us','1.001',1001],['ms','1.000001',1000001],['us','9007199254740.991',9007199254740991],['us','1.0010',1001],['ns','0.000',0],['ms','9007199254.740991',9007199254740991],['s','9007199.254740991',9007199254740991]]) {
    const test=structuredClone(base);test.name=`exact decimal ${input} ${unit}`;
    test.inputs[0].log_fields.metadata.duration_unit=unit;
    test.inputs[0].log_fields.message=test.inputs[0].log_fields.message.replace('|1234|',`|${input}|`);
    test.outputs[0].conditions[0].source=`assert_eq!(.event.duration, ${value})`;
    config.tests.push(test);
  }
  for(const [name,change] of [
    ['unknown unit',f=>{f.metadata.duration_unit='guess';}],
    ['unknown format',f=>{f.metadata.format='auto';}],
    ['missing metadata',f=>{delete f.metadata.environment;}],
    ['sub-nanosecond precision',f=>{f.message=f.message.replace('|1234|','|0.0001|');}],
    ['negative duration',f=>{f.message=f.message.replace('|1234|','|-1|');}],
    ['overflow duration',f=>{f.message=f.message.replace('|1234|','|9007199254740992|');}],
    ['extra pipe field',f=>{f.message+='|extra';}],
    ['invalid date',f=>{f.message=f.message.replace('09-27','02-30');}],
    ['invalid status',f=>{f.message=f.message.replace('|200|','|999|');}],
  ]) {
    const input=structuredClone(base.inputs);change(input[0].log_fields);
    config.tests.push({name,inputs:input,no_outputs_from:['parse','guard'],outputs:[{extract_from:'parse.dropped',conditions:[{type:'vrl',source:'assert!(exists(.message))'}]}]});
  }
  const extended=structuredClone(mapping);extended.properties.labels.properties.team={type:'keyword'};
  config.transforms.extended={...config.transforms.guard,inputs:['prepare'],source:compileMappingGuard(extended)};
  config.sinks.discard.inputs.push('extended','extended.dropped');
  const event={
    '@timestamp':'2026-09-27T03:00:00Z',event:{original:'sample',dataset:'http.access'},
    http:{request:{method:'GET'},response:{status_code:200}},url:{path:'/demo/ok'},
    service:{name:'demo',version:'10.2.0'},host:{name:'tomee'},labels:{environment:'demo'},
    log:{file:{path:'access.log'}},analysis:{run_id:'run-001',schema_version:'1'},
  };
  config.tests.push({name:'edited mapping accepts a declared extension',inputs:[{insert_at:'prepare',type:'log',log_fields:{...event,labels:{...event.labels,team:'platform'}}}],outputs:[{extract_from:'extended',conditions:[{type:'vrl',source:'assert_eq!(.labels.team, "platform")'}]}],no_outputs_from:['extended.dropped']});
  for(const [name,change] of [
    ['unknown root field',e=>{e.secret='invalid';}],
    ['unknown nested field',e=>{e.http.response.unmapped=1;}],
    ['missing required field',e=>{delete e.event.original;}],
    ['wrong status type',e=>{e.http.response.status_code='200';}],
    ['invalid schema version',e=>{e.analysis.schema_version='future';}],
    ['negative normalized duration',e=>{e.event.duration=-1;}],
  ]) {
    const record=structuredClone(event);change(record);
    config.tests.push({name,inputs:[{insert_at:'prepare',type:'log',log_fields:record}],no_outputs_from:['guard'],outputs:[{extract_from:'guard.dropped',conditions:[{type:'vrl',source:'assert_eq!(.metadata.dropped.component_id, "guard")'}]}]});
  }
  const file=join(directory,'tests.json');await writeFile(file,JSON.stringify(config));
  const result=spawnSync(process.env.VECTOR_BIN??'vector',['test',file],{stdio:'inherit',timeout:60_000});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
} finally {await rm(directory,{recursive:true,force:true});}
