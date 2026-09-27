#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {readFile,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {SessionClient} from './client.js';

const args=process.argv.slice(2);
if(args.includes('--help')||args.includes('-h')){
 console.log('VISULIA\n使い方: visulia [--server https://デモサーバー]\n接続先は VISULIA_SERVER でも指定できます。\n専用の一時環境でログを解析します。終了時に環境を削除します。');
}else if(args.length&&!(args.length===2&&args[0]==='--server')){
 console.error('使い方: visulia [--server https://デモサーバー]');process.exitCode=1;
}else{
 const abort=new AbortController();
 const terminal=createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY??false});
 let bufferedLines=0;
 terminal.on('line',()=>{bufferedLines++;});
 const lines=terminal[Symbol.asyncIterator]();
 const stop=()=>{abort.abort();terminal.close();};
 terminal.on('SIGINT',stop);
 terminal.on('close',()=>{if(bufferedLines===0)abort.abort();});
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 async function ask(message:string,fallback=''){
  process.stdout.write(message+(fallback?` [${fallback}]`:'')+': ');
  const answer=await lines.next();if(!answer.done)bufferedLines--;if(answer.done||abort.signal.aborted)throw new Error('INPUT_CLOSED');
  return answer.value.trim()||fallback;
 }
 let client:SessionClient|undefined;
 try{
  const server=args[1]??process.env.VISULIA_SERVER??await ask('VISULIAサーバーのURL');
  client=new SessionClient(server,fetch,abort.signal);
  console.log('接続先: '+client.server+'\nログはこのサーバーの一時領域に保存されます。切断後は期限切れで削除されます。');
  await client.create();client.heartbeat(()=>{console.error('接続を維持できませんでした。終了して削除を要求します。');stop();});
  console.log('専用環境を準備しています…');
  const deadline=Date.now()+300000;
  while(true){
   const status=await client.status();if(status.state==='ready')break;
   if(status.state!=='provisioning'||Date.now()>deadline)throw new Error('PREPARATION_FAILED');
   await delay(1000,undefined,{signal:abort.signal});
  }
  const config={metadata:{format:'pipe-v1',duration_unit:'us',service_name:'tomee',service_version:'10.2.0',environment:'demo',host_name:'demo'},parser:await readFile(new URL('../../../templates/parsers/access.vrl',import.meta.url),'utf8'),mapping:JSON.parse(await readFile(new URL('../../../templates/mappings/access.json',import.meta.url),'utf8'))};
  const run=await client.api('/runs','POST',config),path='/runs/'+run.id;
  console.log('準備できました。まず demo でサンプルを生成し、check → ingest の順に進めます。');
  while(!abort.signal.aborted){
   const command=await ask('\ndemo / upload / config / check / ingest / status / stop / reparse / query / kibana / quit','status');
   if(command==='quit')break;
   try{
    if(command==='demo'){
     const scenario=await ask('normal / errors / slow / mixed','mixed');
     const count=Number(await ask('リクエスト数（1〜1800）','20'));
     const rate=Number(await ask('1秒あたりのリクエスト数（1〜5）','2'));
     const result=await client.api(path+'/demo','POST',{scenario,count,rate});
     console.log('生成を開始しました。status で進捗、stop で停止できます。');console.log(JSON.stringify(result.demo));
    }else if(command==='upload'){
     const file=await ask('送信するUTF-8アクセスログのパス');
     const info=await stat(file);if(!info.isFile()||info.size>10*1024*1024)throw new Error('INVALID_LOG_FILE');
     if(await ask(`${client.server}へこのファイルを送信します。送信する場合は yes`)!=='yes')continue;
     showRun(await client.api(path+'/logs','PUT',new Uint8Array(await readFile(file))));
    }else if(command==='config'){
     const file=await ask('metadata / parser / mapping を含む設定JSONのパス');
     const info=await stat(file);if(!info.isFile()||info.size>1024*1024)throw new Error('INVALID_CONFIG_FILE');
     showRun(await client.api(path+'/config','PUT',JSON.parse(await readFile(file,'utf8'))));
    }else if(['check','ingest','stop','reparse'].includes(command)){
     showRun(await client.api(path+'/'+command,'POST'));
    }else if(command==='status'){
     const result=await client.api(path);console.log(JSON.stringify({state:result.state,bytes:result.bytes,check:result.check,demo:result.demo},null,2));
    }else if(command==='kibana'){
     console.log('60秒以内にこのリンクをブラウザで開いてください。CLIを終了すると環境は削除されます。\n'+await client.browserLink());
    }else if(command==='query'){
     const query=await ask('ES|QL',`FROM visulia-${run.id} | STATS requests = COUNT(*) BY http.response.status_code`);
     console.log(JSON.stringify(await client.api('/elasticsearch/_query','POST',{query}),null,2));
    }else console.log('メニューにある操作を入力してください。');
   }catch(error){console.error('操作できませんでした: '+safeError(error));}
  }
 }catch(error){if(!abort.signal.aborted&&!(error instanceof Error&&error.message==='INPUT_CLOSED')){console.error('終了しました: '+safeError(error));process.exitCode=1;}}
 finally{
  terminal.close();
  if(client)try{
   const result=await client.close();
   console.log(result.state==='deleted'?'専用環境の削除を確認しました。':result.state==='absent'?'接続を終了しました。':'削除処理を要求しました。サーバー側で回収を続けます。');
  }catch{console.error('削除完了を確認できませんでした。サーバー側の期限切れ回収に委ねます。');process.exitCode=1;}
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 }
}
function safeError(error:unknown){
 const message=error instanceof Error?error.message:'';
 return /^[A-Z][A-Z0-9_]{0,79}$/.test(message)?message:'OPERATION_FAILED';
}

function showRun(result:any){console.log(JSON.stringify({state:result.state,bytes:result.bytes,check:result.check,demo:result.demo},null,2));}
