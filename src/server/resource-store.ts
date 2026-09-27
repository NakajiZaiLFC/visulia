import type { DatabaseSync } from 'node:sqlite';
import { SessionError } from '../session/types.js';
import { expiryReason } from '../session/reaper.js';
import { openDatabase, transaction } from './database.js';
import { decodeSession } from './session-record.js';

export type ResourceKind = 'compose_project' | 'volume' | 'network' | 'upload_dir';
export interface OwnedResource {
  sessionId: string; kind: ResourceKind; name: string;
  state: 'planned' | 'created' | 'removed';
}

function validateIdentity(sessionId: string, kind: ResourceKind, name: string): void {
  const prefix = `visulia-${sessionId}-`;
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 64 || /[^a-z0-9-]/.test(sessionId)
    || !['compose_project','volume','network','upload_dir'].includes(kind)
    || typeof name !== 'string' || !name.startsWith(prefix) || name.length <= prefix.length
    || name.length > 200 || /[^a-z0-9-]/.test(name)) throw new SessionError('INVALID_INPUT');
}

/** Internal ownership registry. Caller identity is established at the future HTTP boundary. */
export class ResourceStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly clock: () => number = Date.now) { this.db = openDatabase(path); }

  private assertActive(id: string): void {
    const row = this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id);
    if (!row) throw new SessionError('UNAUTHORIZED');
    const session = decodeSession(row.payload, id);
    if (session.state !== 'provisioning' && session.state !== 'ready') throw new SessionError('INVALID_STATE');
    if (expiryReason(session, this.clock())) throw new SessionError('EXPIRED');
  }

  plan(resource: Omit<OwnedResource, 'state'>): void {
    const {sessionId, kind, name} = resource;
    validateIdentity(sessionId, kind, name);
    transaction(this.db, () => {
      this.assertActive(sessionId);
      const prior = this.db.prepare('SELECT session_id,state FROM resources WHERE kind=? AND name=?').get(kind, name);
      if (prior) {
        if (prior.session_id !== sessionId) throw new SessionError('UNAUTHORIZED');
        if (prior.state !== 'planned' && prior.state !== 'created') throw new SessionError('INVALID_STATE');
        return;
      }
      this.db.prepare("INSERT INTO resources(session_id,kind,name,state) VALUES (?,?,?,'planned')").run(sessionId, kind, name);
    });
  }

  markCreated(sessionId: string, kind: ResourceKind, name: string): void {
    validateIdentity(sessionId, kind, name);
    transaction(this.db, () => {
      this.assertActive(sessionId);
      const result = this.db.prepare("UPDATE resources SET state='created' WHERE session_id=? AND kind=? AND name=? AND state='planned'").run(sessionId, kind, name);
      if (result.changes !== 1) throw new SessionError('INVALID_STATE');
    });
  }

  markRemoved(sessionId: string, kind: ResourceKind, name: string): void {
    validateIdentity(sessionId, kind, name);
    transaction(this.db, () => {
      const row = this.db.prepare('SELECT state FROM resources WHERE session_id=? AND kind=? AND name=?').get(sessionId, kind, name);
      if (!row) throw new SessionError('UNAUTHORIZED');
      if (!['planned','created','removed'].includes(String(row.state))) throw new Error('CORRUPT_RESOURCE');
      this.db.prepare("UPDATE resources SET state='removed' WHERE session_id=? AND kind=? AND name=?").run(sessionId, kind, name);
    });
  }

  pending(sessionId: string): OwnedResource[] {
    return this.db.prepare("SELECT session_id,kind,name,state FROM resources WHERE session_id=? AND state!='removed' ORDER BY kind,name")
      .all(sessionId).map(row => {
        const resource: OwnedResource = {
          sessionId: String(row.session_id), kind: row.kind as ResourceKind,
          name: String(row.name), state: row.state as OwnedResource['state'],
        };
        try { validateIdentity(resource.sessionId, resource.kind, resource.name); }
        catch { throw new Error('CORRUPT_RESOURCE'); }
        if (resource.state !== 'planned' && resource.state !== 'created') throw new Error('CORRUPT_RESOURCE');
        return resource;
      });
  }

  close(): void { this.db.close(); }
}
