type RecordValue=Record<string,unknown>;
const required:Record<string,string>={
  '@timestamp':'date','event.original':'keyword','event.dataset':'keyword',
  'http.request.method':'keyword','http.response.status_code':'integer','url.path':'keyword',
  'service.name':'keyword','service.version':'keyword','host.name':'keyword',
  'labels.environment':'keyword','log.file.path':'keyword','analysis.run_id':'keyword','analysis.schema_version':'keyword',
};
const optional:Record<string,string>={'event.duration':'long','event.id':'keyword','user.id':'keyword','labels.scenario':'keyword'};
const fail=():never=>{throw new Error('INVALID_MAPPING');};
function object(value:unknown):RecordValue {
  if(!value || typeof value!=='object' || Array.isArray(value))return fail();
  return value as RecordValue;
}
/** Compile a strict, editable Mapping to the same runtime guard used before ingestion. */
export function compileMappingGuard(mapping:unknown):string {
  const root=object(mapping);
  if(root.dynamic!=='strict' || Object.keys(root).some(k=>!['dynamic','properties'].includes(k)))fail();
  const seen=new Map<string,string>();
  const lines:string[]=[];
  let count=0;
  function walk(properties:unknown,segments:string[]):void {
    if(segments.length>8)fail();
    const props=object(properties), names=Object.keys(props);
    if(!names.length)fail();
    const path=segments.length?'.'+segments.map(s=>JSON.stringify(s)).join('.'):'.';
    lines.push(`assert!(is_object(${path}), "object_required")`);
    lines.push(`for_each(keys(object${segments.length?'!':''}(${path}))) -> |_index, field| { assert!(includes(${JSON.stringify(names)}, field), "unmapped_field") }`);
    for(const [name,value] of Object.entries(props)) {
      if(++count>128 || (!/^[a-z][a-z0-9_]*$/.test(name) && !(segments.length===0&&name==='@timestamp')) || ['constructor','prototype'].includes(name))fail();
      const field=object(value), parts=[...segments,name], key=parts.join('.');
      const target='.'+parts.map(s=>JSON.stringify(s)).join('.');
      if('properties' in field) {
        if(Object.keys(field).some(k=>!['properties','type','dynamic'].includes(k)) ||
          (field.type!==undefined&&field.type!=='object') || (field.dynamic!==undefined&&field.dynamic!=='strict'))fail();
        lines.push(`if exists(${target}) {`);walk(field.properties,parts);lines.push('}');
        continue;
      }
      if(Object.keys(field).some(k=>!['type','coerce','index','doc_values'].includes(k)))fail();
      for(const k of ['coerce','index','doc_values'])if(field[k]!==undefined&&typeof field[k]!=='boolean')fail();
      if(field.coerce===true)fail();
      const type=field.type;
      if(typeof type!=='string')return fail();
      seen.set(key,type);
      const check=type==='keyword'||type==='text'?`is_string(${target})`:
        type==='integer'?`is_integer(${target}) && int!(${target}) >= -2147483648 && int!(${target}) <= 2147483647`:
        type==='long'?`is_integer(${target}) && int!(${target}) >= -9007199254740991 && int!(${target}) <= 9007199254740991`:
        type==='double'||type==='float'?`is_float(${target}) || is_integer(${target})`:
        type==='boolean'?`is_boolean(${target})`:
        type==='date'?`is_timestamp(${target})`:fail();
      lines.push(`if exists(${target}) { assert!(${check}, "field_type") }`);
    }
  }
  walk(root.properties,[]);
  for(const [name,type] of Object.entries(required)) {
    if(seen.get(name)!==type)fail();
    const path='.'+name.split('.').map(s=>JSON.stringify(s)).join('.');
    lines.push(`assert!(exists(${path}), "required_field")`);
    if(type==='keyword')lines.push(`assert!(length(string!(${path}))>0, "empty_field")`);
  }
  for(const [name,type] of Object.entries(optional))if(seen.has(name)&&seen.get(name)!==type)fail();
  lines.push('assert!(.analysis.schema_version == "1", "schema_version")');
  lines.push('assert!(int!(.http.response.status_code) >= 100 && int!(.http.response.status_code) <= 599, "status_range")');
  lines.push('assert!(starts_with(string!(.url.path), "/"), "request_path")');
  lines.push('if exists(.event.duration) { assert!(int!(.event.duration) >= 0, "negative_duration") }');
  return lines.join('\n')+'\n';
}
