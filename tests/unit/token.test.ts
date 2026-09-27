import test from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, hashToken, matchesToken } from '../../src/session/token.js';
test('token is unique and only its matching hash authenticates', () => {
  const a = issueToken(); const b = issueToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.notEqual(hashToken(a), a);
  assert.equal(matchesToken(a, hashToken(a)), true);
  assert.equal(matchesToken(b, hashToken(a)), false);
  assert.equal(matchesToken('', hashToken(a)), false);
  assert.equal(matchesToken(a, 'bad-hash'), false);
});
