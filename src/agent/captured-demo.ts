import {DemoCapture} from './demo-capture.js';
import {generateDemo,type DemoOptions} from './demo.js';
/** Capture is opened before requests so previously generated data never leaks in. */
export async function generateCapturedDemo(options:DemoOptions,line:(value:string)=>Promise<void>,signal:AbortSignal,path='/work/raw/access.log',fetcher:typeof fetch=fetch){
 const capture=new DemoCapture(path,signal);await capture.begin();
 await generateDemo(options,async record=>{
  if(record.error)throw new Error('DEMO_REQUEST_FAILED');
  await line(await capture.take(record.id));
 },signal,fetcher);
}
