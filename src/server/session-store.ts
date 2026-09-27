import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '../session/types.js';
import { openDatabase } from './database.js';
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

  close(): void { this.db.close(); }
}
