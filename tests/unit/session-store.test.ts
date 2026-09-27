import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SessionStore } from '../../src/server/session-store.js';
import { createSession } from '../../src/session/lifecycle.js';
import { issueToken, hashToken } from '../../src/session/token.js';
import { tempDb } from '../helpers/temp-db.js';

function session(id = 'a', now = 0) {
  return createSession({ id, now, tokenHash: hashToken(issueToken()) });
}

test('reopen preserves sessions and duplicate IDs never overwrite', t => {
  const file = tempDb(t); const value = session();
  const first = new SessionStore(file);
  try {
    first.insert(value);
    assert.throws(() => first.insert({ ...value, tokenHash: hashToken(issueToken()) }));
  } finally { first.close(); }
  const second = new SessionStore(file);
  try {
    assert.deepEqual(second.get('a'), value);
    assert.equal(second.get('missing'), undefined);
  } finally { second.close(); }
});

test('database is private and stores no raw token or unexpected fields', t => {
  const file = tempDb(t); const token = issueToken(); const store = new SessionStore(file);
  try {
    const value = createSession({id:'a', now:0, tokenHash:hashToken(token)});
    assert.throws(() => store.insert({ ...value, token } as typeof value));
    store.insert(value);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { store.close(); }
  assert.equal(readFileSync(file).includes(Buffer.from(token)), false);
});

test('corrupt or contradictory stored data fails closed without resetting database', t => {
  const file = tempDb(t); const store = new SessionStore(file); const raw = new DatabaseSync(file);
  try {
    const good = session(); store.insert(good);
    const values: unknown[] = [
      '{broken-json', null, [], { ...good, state:'unknown' }, { ...good, createdAt:-1 },
      { ...good, lastHeartbeatAt:0.5 }, { ...good, idleExpiresAt:2_000_000 },
      { ...good, maxExpiresAt:1_900_000 }, { ...good, id:'different' },
      { ...good, state:'closing' }, { ...good, closeReason:'requested' },
      { ...good, tokenHash:'plaintext' }, { ...good, unexpected:'log payload' },
    ];
    for (const value of values) {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      raw.prepare('UPDATE sessions SET payload=? WHERE id=?').run(payload, 'a');
      assert.throws(() => store.get('a'), /CORRUPT_SESSION/);
      assert.equal(raw.prepare('SELECT payload FROM sessions WHERE id=?').get('a')?.payload, payload);
    }
  } finally { raw.close(); store.close(); }
});
