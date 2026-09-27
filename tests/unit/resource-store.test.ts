import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SessionStore } from '../../src/server/session-store.js';
import { ResourceStore, type ResourceKind } from '../../src/server/resource-store.js';
import { createSession } from '../../src/session/lifecycle.js';
import { hashToken, issueToken } from '../../src/session/token.js';
import { tempDb } from '../helpers/temp-db.js';

function setup(file: string) {
  const sessions = new SessionStore(file); const token = issueToken();
  for (const id of ['a','b','a-b']) sessions.insert(createSession({id, tokenHash:hashToken(token), now:0}));
  return { sessions, token };
}
const resource = { sessionId:'a', kind:'volume' as const, name:'visulia-a-data' };

test('planned resources survive restart and cannot be changed by another owner', t => {
  const file = tempDb(t); const {sessions} = setup(file); sessions.close();
  const first = new ResourceStore(file, () => 1);
  try { first.plan(resource); first.plan(resource); } finally { first.close(); }
  const second = new ResourceStore(file, () => 2);
  try {
    assert.deepEqual(second.pending('a'), [{...resource, state:'planned'}]);
    assert.throws(() => second.markRemoved('b', 'volume', resource.name));
    assert.throws(() => second.markCreated('b', 'volume', resource.name));
    assert.deepEqual(second.pending('a'), [{...resource, state:'planned'}]);
    assert.deepEqual(second.pending('b'), []);
    second.markCreated('a', 'volume', resource.name);
    assert.equal(second.pending('a')[0]?.state, 'created');
  } finally { second.close(); }
});

test('invalid names, kinds, owners and overlapping prefixes never acquire another resource', t => {
  const file = tempDb(t); const {sessions} = setup(file); const resources = new ResourceStore(file, () => 1);
  try {
    for (const name of ['/tmp/a','../a','visulia-a-../b','visulia-b-data','visulia-a-','visulia-a-x\n']) {
      assert.throws(() => resources.plan({...resource, name}));
    }
    assert.throws(() => resources.plan({...resource, kind:'shell' as ResourceKind}));
    assert.throws(() => resources.plan({...resource, sessionId:'missing', name:'visulia-missing-data'}));
    resources.plan({...resource, sessionId:'a-b', name:'visulia-a-b-data'});
    assert.throws(() => resources.plan({...resource, name:'visulia-a-b-data'}));
    assert.deepEqual(resources.pending('a'), []);
    assert.equal(resources.pending('a-b').length, 1);
  } finally { resources.close(); sessions.close(); }
});

test('removed resources cannot be resurrected and deleted cleanup is idempotent', t => {
  const file = tempDb(t); const {sessions, token} = setup(file); const resources = new ResourceStore(file, () => 1);
  try {
    resources.plan(resource);
    sessions.requestClose('a', token, 1);
    assert.throws(() => sessions.reportCleanup('a', true), /INVALID_STATE/);
    assert.equal(sessions.get('a')?.state, 'closing');
    sessions.reportCleanup('a', false);
    assert.equal(sessions.get('a')?.state, 'cleanup_failed');
    assert.deepEqual(sessions.claimExpired(2).map(s=>s.id), ['a']);
    assert.throws(() => resources.markCreated('a', 'volume', resource.name));
    resources.markRemoved('a', 'volume', resource.name); // cleanup even if creation was interrupted
    resources.markRemoved('a', 'volume', resource.name);
    assert.deepEqual(resources.pending('a'), []);
    assert.equal(sessions.reportCleanup('a', true).state, 'deleted');
    assert.equal(sessions.reportCleanup('a', true).state, 'deleted');
    assert.throws(() => resources.plan(resource));
    assert.throws(() => resources.markCreated('a', 'volume', resource.name));
    assert.equal(sessions.get('b')?.state, 'provisioning');
  } finally { resources.close(); sessions.close(); }
});

test('new resources and create completion reject expired sessions even before the reaper runs', t => {
  const file = tempDb(t); const {sessions} = setup(file); let now = 1;
  const resources = new ResourceStore(file, () => now);
  try {
    resources.plan(resource);
    resources.markRemoved('a', 'volume', resource.name);
    assert.throws(() => resources.plan(resource), /INVALID_STATE/);
    resources.plan({...resource, name:'visulia-a-other'});
    now = 300_000;
    assert.throws(() => resources.plan({...resource, name:'visulia-a-new'}), /EXPIRED/);
    assert.throws(() => resources.markCreated('a', 'volume', 'visulia-a-other'), /EXPIRED/);
    assert.equal(resources.pending('a')[0]?.state, 'planned');
  } finally { resources.close(); sessions.close(); }
});

test('cleanup completion rolls back if its database write fails', t => {
  const file = tempDb(t); const {sessions, token} = setup(file); const raw = new DatabaseSync(file);
  try {
    sessions.requestClose('a', token, 1);
    raw.exec("CREATE TRIGGER fail_cleanup BEFORE UPDATE ON sessions WHEN OLD.id='a' BEGIN SELECT RAISE(ABORT,'cleanup failure'); END;");
    assert.throws(() => sessions.reportCleanup('a', true), /cleanup failure/);
    assert.equal(sessions.get('a')?.state, 'closing');
    raw.exec('DROP TRIGGER fail_cleanup');
    assert.equal(sessions.reportCleanup('a', true).state, 'deleted');
  } finally { raw.close(); sessions.close(); }
});
