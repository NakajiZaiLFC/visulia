import test from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, hashToken } from '../../src/session/token.js';
import { createSession, beginClose, finishClose, authorize } from '../../src/session/lifecycle.js';
import { cleanupCandidates, expiryReason } from '../../src/session/reaper.js';
test('failed cleanup stays revoked and retryable; deletion is idempotent', () => {
  const token = issueToken();
  const s = createSession({id:'session-a', tokenHash:hashToken(token), now:0});
  const closing = beginClose(s, 'requested');
  assert.throws(() => authorize(closing, token, 1));
  const failed = finishClose(closing, false);
  assert.equal(failed.state, 'cleanup_failed');
  assert.deepEqual(cleanupCandidates([failed], 1), ['session-a']);
  const deleted = finishClose(beginClose(failed, 'requested'), true);
  assert.equal(deleted.state, 'deleted');
  assert.deepEqual(beginClose(deleted, 'requested'), deleted);
  assert.deepEqual(cleanupCandidates([deleted], 1), []);
});
test('reaper picks expired sessions without modifying active neighbors', () => {
  const tokenHash = hashToken(issueToken());
  const a = createSession({id:'a', tokenHash, now:0});
  const b = createSession({id:'b', tokenHash, now:100_000});
  const before = JSON.stringify([a,b]);
  assert.equal(expiryReason(a, 300_000), 'idle');
  assert.deepEqual(cleanupCandidates([a,b], 300_000), ['a']);
  assert.equal(JSON.stringify([a,b]), before);
});

import { heartbeat, markReady } from '../../src/session/lifecycle.js';
import { SessionError } from '../../src/session/types.js';
const errorCode = (code: string) => (e: unknown) => e instanceof SessionError && e.code === code;

test('maximum expiration wins when idle and maximum coincide', () => {
  const token = issueToken();
  let s = createSession({id:'a', tokenHash:hashToken(token), now:0});
  for (let now = 200_000; now <= 1_600_000; now += 200_000) s = heartbeat(s, token, now);
  assert.equal(expiryReason(s, 1_799_999), undefined);
  assert.equal(expiryReason(s, 1_800_000), 'maximum');
});

test('invalid clock values cannot silently suppress cleanup', () => {
  const s = createSession({id:'a', tokenHash:hashToken(issueToken()), now:100});
  for (const now of [NaN, Infinity, -1, 0.5, 99]) {
    assert.throws(() => expiryReason(s, now), errorCode('INVALID_INPUT'));
    assert.throws(() => cleanupCandidates([s], now), errorCode('INVALID_INPUT'));
  }
  assert.throws(() => cleanupCandidates([], NaN), errorCode('INVALID_INPUT'));
});

test('only a closing session can report cleanup outcome', () => {
  const s = createSession({id:'a', tokenHash:hashToken(issueToken()), now:0});
  for (const active of [s, markReady(s, 1)]) {
    assert.throws(() => finishClose(active, true), errorCode('INVALID_STATE'));
    assert.throws(() => finishClose(active, false), errorCode('INVALID_STATE'));
  }
  const closing = beginClose(s, 'idle');
  assert.deepEqual(beginClose(closing, 'requested'), closing);
  const failed = finishClose(closing, false);
  assert.equal(beginClose(failed, 'requested').closeReason, 'idle');
  const deleted = finishClose(closing, true);
  assert.deepEqual(finishClose(deleted, true), deleted);
  assert.throws(() => finishClose(deleted, false), errorCode('INVALID_STATE'));
  assert.equal(expiryReason(deleted, 2_000_000), undefined);
});

test('every closing state rejects its former owner', () => {
  const token = issueToken();
  const s = createSession({id:'a', tokenHash:hashToken(token), now:0});
  const closing = beginClose(s, 'provision_failed');
  for (const stopped of [closing, finishClose(closing, false), finishClose(closing, true)]) {
    assert.throws(() => authorize(stopped, token, 1), errorCode('UNAUTHORIZED'));
    assert.throws(() => heartbeat(stopped, token, 1), errorCode('UNAUTHORIZED'));
  }
  assert.equal(s.state, 'provisioning');
  assert.deepEqual(cleanupCandidates([closing], 1), ['a']);
});
