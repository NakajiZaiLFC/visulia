import { createSession } from '../session/lifecycle.js';
import { IDLE_MS, MAX_MS, type Session } from '../session/types.js';

/** Decode the persistence boundary without echoing corrupt or sensitive payloads. */
export function decodeSession(payload: unknown, rowId: string): Session {
  try {
    if (typeof payload !== 'string') throw new Error();
    const s = JSON.parse(payload) as Session;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error();
    const fields = ['id', 'tokenHash', 'state', 'createdAt', 'lastHeartbeatAt', 'idleExpiresAt', 'maxExpiresAt', 'closeReason'];
    if (Object.keys(s).some(key => !fields.includes(key))) throw new Error();
    createSession({ id: s.id, tokenHash: s.tokenHash, now: s.createdAt });
    if (s.id !== rowId || !['provisioning','ready','closing','cleanup_failed','deleted'].includes(s.state)) throw new Error();
    for (const value of [s.lastHeartbeatAt, s.idleExpiresAt, s.maxExpiresAt]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error();
    }
    if (s.maxExpiresAt !== s.createdAt + MAX_MS
      || s.lastHeartbeatAt < s.createdAt || s.lastHeartbeatAt >= s.maxExpiresAt
      || s.idleExpiresAt !== s.lastHeartbeatAt + Math.min(IDLE_MS, s.maxExpiresAt - s.lastHeartbeatAt)) throw new Error();
    const active = s.state === 'provisioning' || s.state === 'ready';
    if (active ? s.closeReason !== undefined
      : !['requested','idle','maximum','provision_failed'].includes(s.closeReason ?? '')) throw new Error();
    return s;
  } catch {
    throw new Error('CORRUPT_SESSION');
  }
}
