import {writeFile} from 'node:fs/promises';
/** Export is explicit and exclusive; the server remains the active configuration. */
export async function exportRunTemplate(path:string,run:unknown):Promise<void>{
 const config=(run as {config?:{metadata?:unknown;parser?:unknown;mapping?:unknown}})?.config;
 if(!config||typeof config.parser!=='string'||!config.metadata||!config.mapping)throw new Error('INVALID_RESPONSE');
 const text=JSON.stringify({metadata:config.metadata,parser:config.parser,mapping:config.mapping},null,2)+'\n';
 if(Buffer.byteLength(text)>1024*1024)throw new Error('TEMPLATE_TOO_LARGE');
 try{await writeFile(path,text,{flag:'wx',mode:0o600});}
 catch(error){throw new Error((error as NodeJS.ErrnoException).code==='EEXIST'?'TEMPLATE_EXISTS':'TEMPLATE_WRITE_FAILED');}
}
