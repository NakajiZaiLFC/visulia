export const IDLE_MS = 300_000;
export const MAX_MS = 1_800_000;
export type State = 'provisioning' | 'ready' | 'closing' | 'cleanup_failed' | 'deleted';
export type Reason = 'requested' | 'idle' | 'maximum' | 'provision_failed';
export interface Session {
  id: string;
  tokenHash: string;
  state: State;
  createdAt: number;
  lastHeartbeatAt: number;
  idleExpiresAt: number;
  maxExpiresAt: number;
  closeReason?: Reason;
}
export class SessionError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'UNAUTHORIZED' | 'EXPIRED' | 'INVALID_STATE') {
    super(code);
    this.name = 'SessionError';
  }
}
