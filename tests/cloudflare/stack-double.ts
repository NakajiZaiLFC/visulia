import { DurableObject } from 'cloudflare:workers';
export class TestStack extends DurableObject {
  async boot(_id: string) {
    if((this.env as {FAIL_BOOT?:string}).FAIL_BOOT==='1') throw new Error('boot failed');
    await this.ctx.storage.put('running', true);
  }
  async isStopped() {return !(await this.ctx.storage.get('running'));}
  async simulateCrash() {await this.ctx.storage.put('running',false);}
  async failRemoval() { await this.ctx.storage.put('fail',true); }
  async allowRemoval() { await this.ctx.storage.delete('fail'); }
  async remove() {
    if(await this.ctx.storage.get('fail')) throw new Error('destruction failed');
    await this.ctx.storage.put('running', false);
  }
  async proxy(_request: Request) { return Response.json({service:'stack-double'}); }
}

import { SessionController, Registry } from '../../src/cloudflare/control.js';
import type { Session } from '../../src/session/types.js';
export class TestSession extends SessionController {
  async initializeResult(id:string) {
    try { await this.initialize(id,'a'.repeat(64)); return 'accepted'; }
    catch(error) { return error instanceof Error?error.message:'unknown'; }
  }
  async expire() {
    const s=await this.ctx.storage.get<Session>('session');
    if(s) await this.ctx.storage.put('session',{...s,idleExpiresAt:Date.now()-1});
    await this.alarm();
  }
  async retryCleanup() {await this.alarm();}
  async hasSessionData() {return Boolean(await this.ctx.storage.get('session'));}
}

export class TestRegistry extends Registry {
  async scheduleSweep(at:number) {await this.ctx.storage.setAlarm(at);}
  async nextSweep(){return this.ctx.storage.getAlarm();}
  async expireReservation(id:string){await this.ctx.storage.put('lease:'+id,Date.now()-1);await this.alarm();}
}
