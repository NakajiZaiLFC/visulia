import test from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, hashToken } from '../../src/session/token.js';
import { createSession, authorize, markReady, heartbeat } from '../../src/session/lifecycle.js';
import { MAX_MS, SessionError } from '../../src/session/types.js';
const rejects = (code: string) => (e: unknown) => e instanceof SessionError && e.code === code;
test('owner heartbeat extends idle lease but never maximum lifetime', () => {
  const token = issueToken();
  const original = createSession({id: 'session-a', tokenHash: hashToken(token), now: 0});
  let s = markReady(original, 0);
  for (let now = 200_000; now < MAX_MS; now += 200_000) s = heartbeat(s, token, now);
  assert.equal(s.idleExpiresAt, MAX_MS);
  assert.equal(original.lastHeartbeatAt, 0);
  assert.equal(JSON.stringify(s).includes(token), false);
  assert.throws(() => heartbeat(s, token, MAX_MS), rejects('EXPIRED'));
  assert.throws(() => authorize(s, issueToken(), 1_600_000), rejects('UNAUTHORIZED'));
});
test('idle boundary and invalid clock are rejected', () => {
  const token = issueToken();
  const s = createSession({id: 'session-a', tokenHash: hashToken(token), now: 100});
  assert.throws(() => heartbeat(s, token, 300_100), rejects('EXPIRED'));
  for (const now of [NaN, Infinity, -1, 99]) {
    assert.throws(() => heartbeat(s, token, now), rejects('INVALID_INPUT'));
  }
});
test('session B credential cannot authenticate session A', () => {
  const a = issueToken(); const b = issueToken();
  const s = createSession({id: 'session-a', tokenHash: hashToken(a), now: 0});
  assert.throws(() => authorize(s, b, 1), rejects('UNAUTHORIZED'));
});

test('creation rejects invalid identifiers, hashes, timestamps and overflow', () => {
  const input = { id: 'session-a', tokenHash: hashToken(issueToken()), now: 0 };
  for (const id of ['../a', '', 'UPPER', 'a'.repeat(65), 'a\n']) {
    assert.throws(() => createSession({ ...input, id }), rejects('INVALID_INPUT'));
  }
  for (const tokenHash of ['', 'a'.repeat(63), 'z'.repeat(64)]) {
    assert.throws(() => createSession({ ...input, tokenHash }), rejects('INVALID_INPUT'));
  }
  for (const now of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createSession({ ...input, now }), rejects('INVALID_INPUT'));
  }
});

test('ready transition requires a live provisioning session and preserves its lease', () => {
  const s = createSession({ id: 'a', tokenHash: hashToken(issueToken()), now: 10 });
  const ready = markReady(s, 20);
  assert.equal(ready.state, 'ready');
  assert.equal(s.state, 'provisioning');
  assert.equal(ready.idleExpiresAt, 300_010);
  assert.throws(() => markReady(ready, 20), rejects('INVALID_STATE'));
  assert.throws(() => markReady(s, 300_010), rejects('EXPIRED'));
  assert.throws(() => markReady(s, 9), rejects('INVALID_INPUT'));
});

test('live owner can reconnect until one millisecond before idle expiration', () => {
  const token = issueToken();
  const s = createSession({id: 'a', tokenHash: hashToken(token), now: 0});
  assert.doesNotThrow(() => authorize(s, token, 299_999));
  const updated = heartbeat(s, token, 299_999);
  assert.equal(updated.lastHeartbeatAt, 299_999);
  assert.equal(updated.idleExpiresAt, 599_999);
});
