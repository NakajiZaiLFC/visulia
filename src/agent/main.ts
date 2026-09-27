import {once} from 'node:events';
import {createRuntimeConfig} from './runtime-config.js';
import {prepareRuntime} from './files.js';
import {Services} from './processes.js';
import {NodeBootstrapIO} from './node-io.js';
import {bootstrap} from './bootstrap.js';
import {createAgentHandler} from './http.js';
import {serveAgent} from './server.js';
import {RunManager} from './runs.js';
import {NodeRunIO} from './run-io.js';

process.umask(0o077);
const services=new Services();
let requestedStop=false;
const stop=()=>{requestedStop=true;void services.stop();};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
// Independent backstops if the control plane or a service health check stalls.
const startupDeadline=setTimeout(()=>void services.stop(),210000);
const lifetimeDeadline=setTimeout(()=>void services.stop(),30*60*1000);
try{
 const config=createRuntimeConfig(process.env.VISULIA_SESSION_ID??'');
 const runs=new RunManager({root:'/work/runs',signal:services.signal,elasticsearch:{url:'http://127.0.0.1:9200',username:config.secrets.username,password:config.secrets.password},io:new NodeRunIO(config.secrets.username,config.secrets.password,services.signal)});
 const handler=createAgentHandler(config,process.env.VISULIA_AGENT_TOKEN??'',services.signal,fetch,runs);
 await prepareRuntime();
 await bootstrap(config,new NodeBootstrapIO(services));
 const server=await serveAgent(handler,services.signal);
 clearTimeout(startupDeadline);
 if(server.listening)await once(server,'close');
 if(!requestedStop)process.exitCode=1;
}catch{
 if(!requestedStop){console.error('RUNTIME_START_FAILED');process.exitCode=1;}
}finally{
 clearTimeout(startupDeadline);clearTimeout(lifetimeDeadline);
 await services.stop();
 process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
}
