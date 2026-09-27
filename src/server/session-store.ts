import type { DatabaseSync } from 'node:sqlite';
import { SessionError, type Session } from '../session/types.js';
import { authorize, beginClose, heartbeat } from '../session/lifecycle.js';
import { expiryReason } from '../session/reaper.js';
import { openDatabase, transaction } from './database.js';
import { decodeSession } from './session-record.js';

export class SessionStore {
  private readonly db: DatabaseSync;
  constructor(path: string) { this.db = openDatabase(path); }

  insert(session: Session): void {
    const payload = JSON.stringify(session);
    decodeSession(payload, session.id);
    this.db.prepare('INSERT INTO sessions(id,payload) VALUES (?,?)').run(session.id, payload);
  }

  get(id: string): Session | undefined {
    const row = this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id);
    return row ? decodeSession(row.payload, id) : undefined;
  }

  private require(id: string): Session {
    const session = this.get(id);
    if (!session) throw new SessionError('UNAUTHORIZED');
    return session;
  }

  private save(session: Session): Session {
    const payload = JSON.stringify(session);
    decodeSession(payload, session.id);
    this.db.prepare('UPDATE sessions SET payload=? WHERE id=?').run(payload, session.id);
    return session;
  }

  heartbeat(id: string, token: string, now: number): Session {
    return transaction(this.db, () => this.save(heartbeat(this.require(id), token, now)));
  }

  requestClose(id: string, token: string, now: number): Session {
    return transaction(this.db, () => {
      const session = this.require(id);
      authorize(session, token, now);
      return this.save(beginClose(session, 'requested'));
    });
  }

  /** Internal, single-coordinator recovery scan, not an exclusive worker lease. */
  claimExpired(now: number): Session[] {
    if (!Number.isSafeInteger(now) || now < 0) throw new SessionError('INVALID_INPUT');
    return transaction(this.db, () => {
      const result: Session[] = [];
      for (const row of this.db.prepare('SELECT id,payload FROM sessions ORDER BY id').all()) {
        const session = decodeSession(row.payload, String(row.id));
        const reason = expiryReason(session, now);
        if (reason || session.state === 'closing' || session.state === 'cleanup_failed') {
          result.push(this.save(beginClose(session, session.closeReason ?? reason ?? 'requested')));
        }
      }
      return result;
    });
  }

  close(): void { this.db.close(); }
}
