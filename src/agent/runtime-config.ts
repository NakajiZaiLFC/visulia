import {randomBytes} from 'node:crypto';
const secret=()=>randomBytes(32).toString('hex');
const yaml=(values:Record<string,unknown>)=>Object.entries(values).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n')+'\n';
export function createRuntimeConfig(id:string) {
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new Error('INVALID_SESSION');
 const secrets={elastic:secret(),kibana:secret(),username:'visulia_'+id.replaceAll('-',''),password:secret(),security:secret(),savedObjects:secret(),reporting:secret()};
 const basePath=`/s/${id}/kibana`;
 return {secrets,basePath,
  elasticsearch:yaml({
   'cluster.name':'visulia-demo','node.name':'visulia','network.host':'127.0.0.1','http.port':9200,
   'discovery.type':'single-node','path.data':'/work/elasticsearch','path.logs':'/work/elasticsearch-logs',
   'node.store.allow_mmap':false,'xpack.security.enabled':true,'xpack.security.autoconfiguration.enabled':false,
   'xpack.security.http.ssl.enabled':false,'xpack.security.transport.ssl.enabled':false,
   'xpack.ml.enabled':false,'ingest.geoip.downloader.enabled':false,
  }),
  kibana:yaml({
   'server.host':'127.0.0.1','server.port':5601,'server.basePath':basePath,'server.rewriteBasePath':true,
   'path.data':'/work/kibana','elasticsearch.hosts':['http://127.0.0.1:9200'],
   'elasticsearch.username':'kibana_system','elasticsearch.password':secrets.kibana,
   'xpack.security.encryptionKey':secrets.security,'xpack.encryptedSavedObjects.encryptionKey':secrets.savedObjects,
   'xpack.reporting.encryptionKey':secrets.reporting,'telemetry.enabled':false,'telemetry.optIn':false,
   'newsfeed.enabled':false,'xpack.fleet.isAirGapped':true,'map.includeElasticMapsService':false,
  }),
 };
}
export type RuntimeConfig=ReturnType<typeof createRuntimeConfig>;
