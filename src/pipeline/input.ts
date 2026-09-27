/** Shared upload/offline decoding; preserve original bytes outside this function. */
export function decodeLogs(bytes:Uint8Array):string[]{
 if(bytes.byteLength>10*1024*1024)throw new Error('INVALID_LOG_INPUT');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('INVALID_LOG_INPUT');}
 const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
 const result=lines.map(line=>line.endsWith('\r')?line.slice(0,-1):line);
 if(result.length>20000||result.some(line=>Buffer.byteLength(line)>65536))throw new Error('INVALID_LOG_INPUT');return result;
}
