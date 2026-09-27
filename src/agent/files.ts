import {chmod,cp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
/** Called once in a fresh container, before any service can accept requests. */
export async function prepareRuntime(root='/work',installation='/opt'):Promise<void>{
 await mkdir(root,{recursive:true,mode:0o700});
 await chmod(root,0o700);
 // A restarted VM with old files must never silently inherit another login's data.
 await writeFile(join(root,'.runtime-started'),'1\n',{flag:'wx',mode:0o600});
 for(const path of ['config','config/elasticsearch','config/kibana','raw','runs','tmp','elasticsearch','elasticsearch-logs','kibana','tomee','tomee/conf','tomee/logs','tomee/temp','tomee/work','tomee/webapps']){
  await mkdir(join(root,path),{recursive:true,mode:0o700});
 }
 await cp(join(installation,'elasticsearch/config'),join(root,'config/elasticsearch'),{recursive:true});
 await cp(join(installation,'tomee/conf'),join(root,'tomee/conf'),{recursive:true});
 await cp(join(installation,'visulia/tomee/server.xml'),join(root,'tomee/conf/server.xml'));
 await cp(join(installation,'visulia/tomee/app'),join(root,'tomee/webapps/ROOT'),{recursive:true});
 // cp can preserve source directory modes; restore the private outer boundary.
 for(const path of ['config','config/elasticsearch','config/kibana','tomee','tomee/conf','tomee/webapps'])await chmod(join(root,path),0o700);
}
