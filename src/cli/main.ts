#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {readFile,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createDashboard} from '../dashboard/create.js';
import {pullDashboardTemplate,applyDashboardTemplate} from '../dashboard/template.js';
import {exportRunTemplate,saveTemplateFile} from './templates.js';
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
  let latestDashboard:string|undefined;
  console.log('準備できました。まず demo でサンプルを生成し、check → ingest の順に進めます。');
  while(!abort.signal.aborted){
   const command=await ask('\ninit / demo / upload / template / config / check / ingest / status / stop / reparse / query / dashboard / dashboard-pull / dashboard-apply / kibana / quit','status');
   if(command==='quit')break;
   try{
    if(command==='init'){
     const current=await client.api(path),metadata={...current.config.metadata};
     const format=await ask('ログ形式: pipe-v1 / common-v1',metadata.format);
     if(!['pipe-v1','common-v1'].includes(format))throw new Error('INVALID_FORMAT');
     metadata.format=format;
     metadata.duration_unit=format==='common-v1'?'none':await ask('処理時間の単位: ns / us / ms / s','us');
     if(!['none','ns','us','ms','s'].includes(metadata.duration_unit))throw new Error('INVALID_DURATION_UNIT');
     for(const [key,label] of [['service_name','サービス名'],['service_version','サービスのバージョン'],['environment','環境名'],['host_name','サーバー名']])metadata[key!]=await ask(label!,metadata[key!]);
     showRun(await client.api(path+'/config','PUT',{...current.config,metadata}));
     console.log('設定を更新しました。ログを用意し、checkで再検証してください。');
    }else if(command==='template'){
     const file=await ask('現在のParser・Mapping・metadataを保存する新しいファイルのパス','visulia-config.json');
     await exportRunTemplate(file,await client.api(path));
     console.log('設定テンプレートを保存しました。編集後、configで読み込み、checkまたはreparseを実行してください。');
    }else if(command==='demo'){
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
    }else if(command==='dashboard'){
     console.log('クエリを検証し、新しいDashboardを作成しています…');
     const result=await createDashboard(run.id,client.api.bind(client));latestDashboard=result.id;
     console.log('Dashboardの保存を確認しました。60秒以内に開いてください。\n'+await client.browserLink(result.id));
    }else if(command==='dashboard-pull'){
     const id=await ask('取得するDashboard ID',latestDashboard??'');
     const file=await ask('保存先（新規ファイル）','visulia-dashboard.json');
     await saveTemplateFile(file,await pullDashboardTemplate(run.id,id,client.api.bind(client)));
     console.log('編集用テンプレートを保存しました。dashboard-applyで新しいDashboardとして適用できます。');
    }else if(command==='dashboard-apply'){
     const file=await ask('編集したDashboardテンプレートのパス');
     const info=await stat(file);if(!info.isFile()||info.size>1024*1024)throw new Error('INVALID_TEMPLATE_FILE');
     console.log('現在のログの期間・参照先に合わせ、クエリを検証して新しいDashboardを作成します。');
     const result=await applyDashboardTemplate(run.id,JSON.parse(await readFile(file,'utf8')),client.api.bind(client));latestDashboard=result.id;
     console.log('保存を確認しました。60秒以内に開いてください。\n'+await client.browserLink(result.id));
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
 const hints:Record<string,string>={
  RUN_ACTIVE:'生成または投入が実行中です。stopしてから変更してください。',
  CHECK_REQUIRED:'現在の設定とログをcheckで検証してから実行してください。',
  REPARSE_REQUIRED:'既存データと設定が異なります。reparseで再解析してください。',
  LOGS_REQUIRED:'先にdemoでログを生成するか、uploadでファイルを送信してください。',
  CAPACITY:'デモ環境の利用枠が埋まっています。時間をおいて接続してください。',
  COOLDOWN:'直前に環境を作成しました。1分ほど待って接続してください。',
  TEMPLATE_EXISTS:'同名のファイルがあります。別の保存先を指定してください。',
  INVALID_CONFIG:'設定を適用できませんでした。metadata・Parser・Mappingを確認してください。',
  VECTOR_EXECUTION_FAILED:'Parserの実行に失敗しました。templateで設定を取得して構文を確認してください。',
  UNSUPPORTED_QUERY_TEMPLATE:'このクエリの参照先を安全に置換できませんでした。FROM句以外の参照先を確認してください。',
  UNSUPPORTED_TEMPLATE_PANEL:'このテンプレート操作はインラインES|QLパネルとテキストパネルに対応しています。ライブラリ参照などはKibanaで編集してください。',
  DASHBOARD_INCOMPLETE:'Kibana APIが一部のパネルを返せませんでした。欠落したテンプレートとして保存せず停止しました。',
  TEMPLATE_RUN_REFERENCE_MISSING:'現在の解析先を参照するクエリがありません。Dashboard IDとテンプレートを確認してください。',
  INVALID_DEMO:'デモにはpipe-v1・usの設定と、指定範囲内の件数・レートが必要です。',
 };
 return Object.hasOwn(hints,message)?hints[message]!: /^[A-Z][A-Z0-9_]{0,79}$/.test(message)?message:'OPERATION_FAILED';
}

function showRun(result:any){console.log(JSON.stringify({state:result.state,bytes:result.bytes,check:result.check,demo:result.demo},null,2));}
