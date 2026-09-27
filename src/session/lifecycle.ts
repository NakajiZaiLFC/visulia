import { IDLE_MS, MAX_MS, SessionError, type Session } from './types.js';
import { matchesToken } from './token.js';

function validateTime(now: number, minimum = 0): void {
  if (!Number.isSafeInteger(now) || now < minimum) throw new SessionError('INVALID_INPUT');
}

function assertLive(session: Session, now: number): void {
  if (now >= Math.min(session.idleExpiresAt, session.maxExpiresAt)) throw new SessionError('EXPIRED');
}

export function createSession(input: { id: string; tokenHash: string; now: number }): Session {
  const { id, tokenHash, now } = input;
  if (typeof id !== 'string' || id.length < 1 || id.length > 64 || /[^a-z0-9-]/.test(id)
    || typeof tokenHash !== 'string' || tokenHash.length !== 64 || /[^a-f0-9]/.test(tokenHash)) {
    throw new SessionError('INVALID_INPUT');
  }
  validateTime(now);
  validateTime(now + MAX_MS);
  return {
    id, tokenHash, state: 'provisioning', createdAt: now, lastHeartbeatAt: now,
    idleExpiresAt: now + IDLE_MS, maxExpiresAt: now + MAX_MS,
  };
}

export function authorize(session: Session, token: string, now: number): void {
  validateTime(now, session.lastHeartbeatAt);
  if (!matchesToken(token, session.tokenHash)
    || (session.state !== 'provisioning' && session.state !== 'ready')) {
    throw new SessionError('UNAUTHORIZED');
  }
  assertLive(session, now);
}

export function markReady(session: Session, now: number): Session {
  validateTime(now, session.lastHeartbeatAt);
  if (session.state !== 'provisioning') throw new SessionError('INVALID_STATE');
  assertLive(session, now);
  return { ...session, state: 'ready' };
}

export function heartbeat(session: Session, token: string, now: number): Session {
  authorize(session, token, now);
  // Cap the delta before addition to avoid overflow near MAX_SAFE_INTEGER.
  const idleExpiresAt = now + Math.min(IDLE_MS, session.maxExpiresAt - now);
  return { ...session, lastHeartbeatAt: now, idleExpiresAt };
}
