import { SessionError, type Session } from './types.js';

function validateTime(now: number, minimum = 0): void {
  if (!Number.isSafeInteger(now) || now < minimum) throw new SessionError('INVALID_INPUT');
}

export function expiryReason(session: Session, now: number): 'idle' | 'maximum' | undefined {
  validateTime(now, session.lastHeartbeatAt);
  if (session.state !== 'provisioning' && session.state !== 'ready') return undefined;
  if (now >= session.maxExpiresAt) return 'maximum';
  if (now >= session.idleExpiresAt) return 'idle';
  return undefined;
}

/** Pure selection; does not delete resources or mutate stored sessions. */
export function cleanupCandidates(sessions: readonly Session[], now: number): string[] {
  validateTime(now);
  return sessions.filter(session => {
    const reason = expiryReason(session, now);
    return session.state === 'closing' || session.state === 'cleanup_failed' || reason !== undefined;
  }).map(session => session.id);
}
