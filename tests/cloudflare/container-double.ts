import {DurableObject} from 'cloudflare:workers';
/** SDK simulator: tests fencing only, not a VM or Docker image. */
export class Container<E> extends DurableObject<E> {
  private release: (()=>void)|undefined;
  private state:{running:boolean};
  constructor(ctx:DurableObjectState,env:E){
    const state={running:false};
    super(ctx,env);this.state=state;
    Object.defineProperty(ctx,'container',{value:{get running(){return state.running;},getTcpPort(port:number){return {async fetch(request:Request){return Response.json({authorization:request.headers.get('authorization'),cookie:request.headers.get('cookie'),port});}};}}});
  }
  private destroys=0;
  private startOptions:unknown;
  defaultPort?:number;
  requiredPorts?:number[];
  sleepAfter:string|number='10m';
  enableInternet=true;
  async startAndWaitForPorts(options:unknown) {
    this.startOptions=options;
    await new Promise<void>(resolve=>{this.release=resolve;});
    this.state.running=true;
    await this.onStart();
  }
  async destroy(){this.destroys++;this.state.running=false;await this.onStop();}
  async onStart(){}
  async onStop(){}
  async onActivityExpired(){}
  async fetch(){return new Response('auto-start should not be reachable');}
  async finishBoot(){this.release?.();}
  async inspect(){return {options:this.startOptions,agentToken:await this.ctx.storage.get('agentToken'),pending:Boolean(this.release),running:this.state.running,destroys:this.destroys,closed:await this.ctx.storage.get('closed')};}
}
