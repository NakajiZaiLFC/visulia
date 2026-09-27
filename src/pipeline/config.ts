import {join,isAbsolute} from 'node:path';
import {compileMappingGuard} from './mapping.js';
export interface PipelineOptions {
  directory:string;
  runId:string;
  metadata:Record<string,string>;
  parser:string;
  mapping:unknown;
  elasticsearch:{url:string;username:string;password:string};
}
export function createPipeline(options:PipelineOptions):unknown {
  const {directory,runId,metadata,parser,mapping,elasticsearch}=options;
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId) || !isAbsolute(directory) || parser.length>65536)throw new Error('INVALID_CONFIG');
  for(const name of ['format','duration_unit','service_name','service_version','environment','host_name']) {
    if(typeof metadata[name]!=='string'||metadata[name].length===0||metadata[name].length>256)throw new Error('INVALID_CONFIG');
  }
  const endpoint=new URL(elasticsearch.url);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('INVALID_CONFIG');
  const guard=compileMappingGuard(mapping);
  return {
    data_dir:join(directory,'vector'),
    sources:{raw:{type:'file',include:[join(directory,'input','*.log*')],read_from:'beginning',glob_minimum_cooldown_ms:200,max_line_bytes:10485760,fingerprint:{strategy:'device_and_inode'}}},
    transforms:{
      metadata:{type:'remap',inputs:['raw'],source:`.metadata = ${JSON.stringify({...metadata,run_id:runId})}\n.metadata.file_path = string!(.file)`},
      parse:{type:'remap',inputs:['metadata'],source:parser,drop_on_error:true,drop_on_abort:true,reroute_dropped:true},
      guard:{type:'remap',inputs:['parse'],source:guard,drop_on_error:true,drop_on_abort:true,reroute_dropped:true},
      identify:{type:'remap',inputs:['guard'],source:'._visulia_id = if is_string(.event.id) {string!(.analysis.run_id) + ":" + string!(.event.id)} else {uuid_v4()}'},
    },
    sinks:{
      elasticsearch:{type:'elasticsearch',inputs:['identify'],endpoints:[elasticsearch.url],api_version:'v8',mode:'bulk',bulk:{index:'visulia-'+runId,action:'index'},id_key:'_visulia_id',
        auth:{strategy:'basic',user:elasticsearch.username,password:elasticsearch.password},
        acknowledgements:{enabled:true},buffer:{type:'disk',max_size:268435488,when_full:'block'},
        batch:{max_events:100,timeout_secs:1},request:{timeout_secs:30},request_retry_partial:true},
      quarantine:{type:'file',inputs:['parse.dropped','guard.dropped'],path:join(directory,'quarantine','errors-%Y-%m-%d.jsonl'),encoding:{codec:'json'},acknowledgements:{enabled:true}},
    },
  };
}
