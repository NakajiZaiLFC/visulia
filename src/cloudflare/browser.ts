/** Fragment credentials never reach access logs or Referer headers. */
export function browserLanding(id:string):Response{
 const nonce=crypto.randomUUID().replaceAll('-','');
 const script=`const fragment=new URLSearchParams(location.hash.slice(1)),ticket=fragment.get('ticket'),dashboard=fragment.get('dashboard');history.replaceState(null,'',location.pathname);(async()=>{if(!ticket)throw Error();const response=await fetch('/s/${id}/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket}),credentials:'same-origin'});if(!response.ok)throw Error();location.replace('/s/${id}/kibana/'+(dashboard&&/^[A-Za-z0-9_-]{1,128}$/.test(dashboard)?'app/dashboards#/view/'+dashboard:''));})().catch(()=>{document.getElementById('status').textContent='リンクが無効または期限切れです。CLIで新しいリンクを発行してください。';});`;
 return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VISULIA — Kibana</title><p id="status">専用のKibanaへ接続しています…</p><script nonce="${nonce}">${script}</script></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`}});
}
export async function readTicket(request:Request):Promise<string|undefined>{
 if(!request.body)return undefined;
 const reader=request.body.getReader();let text='',size=0;
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return undefined;}text+=new TextDecoder().decode(value);}
  const parsed=JSON.parse(text);return typeof parsed?.ticket==='string'?parsed.ticket:undefined;
 }catch{return undefined;}finally{reader.releaseLock();}
}
