import {DurableObject} from 'cloudflare:workers';
/** SDK simulator: tests fencing only, not a VM or Docker image. */
export class Container<E> extends DurableObject<E> {
  private release: (()=>void)|undefined;
  private started=false;
  private destroys=0;
  defaultPort?:number;
  requiredPorts?:number[];
  sleepAfter:string|number='10m';
  enableInternet=true;
  async startAndWaitForPorts(_options:unknown) {
    await new Promise<void>(resolve=>{this.release=resolve;});
    this.started=true;
    await this.onStart();
  }
  async destroy(){this.destroys++;this.started=false;await this.onStop();}
  async onStart(){}
  async onStop(){}
  async onActivityExpired(){}
  async fetch(){return new Response('auto-start should not be reachable');}
  async finishBoot(){this.release?.();}
  async inspect(){return {pending:Boolean(this.release),running:this.started,destroys:this.destroys,closed:await this.ctx.storage.get('closed')};}
}
