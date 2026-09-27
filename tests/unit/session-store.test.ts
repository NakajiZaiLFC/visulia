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

import { SessionError } from '../../src/session/types.js';
import { beginClose, finishClose } from '../../src/session/lifecycle.js';
const code = (expected: string) => (error: unknown) => error instanceof SessionError && error.code === expected;

test('a second connection cannot resurrect a closed session from a stale snapshot', t => {
  const file = tempDb(t); const token = issueToken();
  const a = new SessionStore(file); const b = new SessionStore(file);
  try {
    a.insert(createSession({id:'a', tokenHash:hashToken(token), now:0}));
    const stale = b.get('a');
    a.requestClose('a', token, 1);
    assert.throws(() => b.heartbeat('a', token, 2), code('UNAUTHORIZED'));
    assert.equal(stale?.state, 'provisioning');
    assert.equal(b.get('a')?.state, 'closing');
  } finally { a.close(); b.close(); }
  const reopened = new SessionStore(file);
  try { assert.throws(() => reopened.heartbeat('a', token, 3), code('UNAUTHORIZED')); }
  finally { reopened.close(); }
});

test('unauthorized and expired requests do not change persisted state', t => {
  const store = new SessionStore(tempDb(t)); const token = issueToken();
  const value = createSession({id:'a', tokenHash:hashToken(token), now:0});
  try {
    store.insert(value);
    for (const id of ['a', 'missing']) {
      assert.throws(() => store.heartbeat(id, issueToken(), 1), code('UNAUTHORIZED'));
      assert.throws(() => store.requestClose(id, issueToken(), 1), code('UNAUTHORIZED'));
    }
    assert.throws(() => store.heartbeat('a', token, 300_000), code('EXPIRED'));
    assert.throws(() => store.requestClose('a', token, 300_000), code('EXPIRED'));
    assert.deepEqual(store.get('a'), value);
    const updated = store.heartbeat('a', token, 299_999);
    assert.equal(updated.idleExpiresAt, 599_999);
    assert.deepEqual(store.get('a'), updated);
  } finally { store.close(); }
});

test('claim changes only expired and retryable sessions, preserving the first reason', t => {
  const store = new SessionStore(tempDb(t));
  const a = session('a'); const b = session('b', 100_000);
  try {
    store.insert(a); store.insert(b);
    store.insert(finishClose(beginClose(session('c'), 'requested'), false));
    store.insert(finishClose(beginClose(session('d'), 'requested'), true));
    assert.deepEqual(store.claimExpired(100_001).map(s => s.id), ['c']);
    assert.deepEqual(store.get('a'), a);
    const claimed = store.claimExpired(300_000);
    assert.deepEqual(claimed.map(s => [s.id, s.state, s.closeReason]),
      [['a','closing','idle'], ['c','closing','requested']]);
    assert.deepEqual(store.get('b'), b);
    assert.equal(store.get('d')?.state, 'deleted');
    assert.throws(() => store.claimExpired(NaN), code('INVALID_INPUT'));
  } finally { store.close(); }
});

test('batch claim rolls back earlier changes if a later database update fails', t => {
  const file = tempDb(t); const store = new SessionStore(file); const raw = new DatabaseSync(file);
  try {
    const a = session('a'); const b = session('b'); store.insert(a); store.insert(b);
    raw.exec("CREATE TRIGGER fail_b BEFORE UPDATE ON sessions WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
    assert.throws(() => store.claimExpired(300_000), /simulated failure/);
    assert.deepEqual(store.get('a'), a); assert.deepEqual(store.get('b'), b);
    raw.exec('DROP TRIGGER fail_b');
    assert.deepEqual(store.claimExpired(300_000).map(s => s.id), ['a','b']);
  } finally { raw.close(); store.close(); }
});
