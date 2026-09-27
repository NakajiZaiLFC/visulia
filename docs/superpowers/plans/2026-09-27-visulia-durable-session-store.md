# VISULIA Durable Session Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** サーバー再起動後もセッション状態と所有リソースを追跡でき、heartbeatと終了処理が競合しても終了状態を復活させない永続ストアを作る。

**Architecture:** 既存の純粋なsessionモジュールをSQLiteのトランザクションで囲む。DBに所有リソースの予定を記録してから環境を発行し、実際に削除できた後だけ回収完了にする。Dockerの操作は次のprovider実装の責務であり、この計画の試験は実SQLiteを使用する。

**Tech Stack:** TypeScript、Node.js `node:sqlite`のDatabaseSync、node:test。Node.js 25.8.2で検証し、新しいAPIを使わず、公開前に対象LTSでも検証する。

**Spec:** `docs/superpowers/specs/2026-09-27-reusable-log-analysis-design.md`

## Global Constraints

- 1セッションは独立した環境の所有者。別の所有者へ更新・削除しない。
- heartbeat間隔は30秒、切断猶予は5分、デモ最大時間は30分。
- 管理DBへ持ち込み本文、平文トークン、ES管理者パスワードを記録しない。
- 元のsessionモジュールの状態遷移を使い、重複実装しない。
- 本計画は永続化まで。実コンテナの分離や削除が成功したとは報告しない。

## Review Focus

1. 既存IDのinsertで別セッションが上書きされない（Task 1）。
2. DB再オープン後の失効と期限を維持する（Task 1/2）。
3. 同じDBへの2接続で古いheartbeatがclosingを復活させない（Task 2）。
4. 外部操作の前に記録したリソースを再起動後に回収できる（Task 3）。
5. 回収途中の例外でdeletedと誤表示しない（Task 3）。

## ファイル構成

- `src/server/session-store.ts`: SQLite接続・スキーマ・トランザクション・状態操作。
- `src/server/resource-store.ts`: セッションが所有する予定/現存/削除済みリソース。
- `tests/unit/session-store.test.ts`: 一時DB上の永続化と競合。
- `tests/unit/resource-store.test.ts`: 所有権と回収状態。
- `tests/helpers/temp-db.ts`: テストだけで使う一時ディレクトリの生成と終了後削除。

### Task 1: セッションを実DBに保存して再オープン

**Interfaces:**

```ts
// session-store.ts
export class SessionStore {
  constructor(path: string);
  insert(session: Session): void;
  get(id: string): Session | undefined;
  close(): void;
}
```

- [x] 次のテストを作り、未実装の失敗を確認する。

```ts
test('reopen preserves sessions and duplicate IDs never overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'visulia-store-'));
  try {
    const file = join(dir, 'sessions.db');
    const session = createSession({id:'a', tokenHash:hashToken(issueToken()), now:0});
    const first = new SessionStore(file);
    try {
      first.insert(session);
      assert.throws(() => first.insert({...session, tokenHash:hashToken(issueToken())}));
    } finally { first.close(); }
    const second = new SessionStore(file);
    try {
      assert.deepEqual(second.get('a'), session);
      assert.equal(second.get('missing'), undefined);
    } finally { second.close(); }
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
```

- [x] `DatabaseSync`を開き、foreign_keysを有効化、busy_timeoutを5000msに設定する。管理者専用ディレクトリにDBを置き、ファイル権限を0600にする。セッションは下記テーブルへパラメータでbindして挿入する。

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
) STRICT;
```

- [x] payloadはSessionのJSONのみとし、読取り時に型、state、数値のsafe integer、期限の順序を検証する。不正な保存データはエラーにし、暗黙に初期化しない。`INSERT OR REPLACE`を使用しない。
- [x] 作成時のDB modeをstatで検証し、破損JSONを挿入した場合getが失敗するテストを追加する。`npm test`、`npm run check`を実行しcommitする。

### Task 2: heartbeatと終了を排他的に更新

**Interfaces:** SessionStoreに追加する。

```ts
heartbeat(id: string, token: string, now: number): Session;
requestClose(id: string, token: string, now: number): Session;
claimExpired(now: number): Session[];
```

- [x] 次のシナリオを一時ファイルDBへの2接続で試験する。

```ts
const a = new SessionStore(file);
const b = new SessionStore(file);
try {
  a.insert(createSession({id:'a', tokenHash:hashToken(token), now:0}));
  b.get('a'); // simulate a reader observing the old provisioning state
  a.requestClose('a', token, 1);
  assert.throws(() => b.heartbeat('a', token, 2),
    (e: unknown) => e instanceof SessionError && e.code === 'UNAUTHORIZED');
  assert.equal(b.get('a')?.state, 'closing');
} finally { a.close(); b.close(); }
```

- [x] 未実装の失敗を確認後、各更新を次の構造で実装する。

```ts
db.exec('BEGIN IMMEDIATE');
try {
  // Read current row inside this transaction, never accept a caller's stale Session.
  // Apply authorize/heartbeat/beginClose from src/session/lifecycle.ts.
  // UPDATE sessions SET payload = ? WHERE id = ? using bound values.
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
```

- [x] requestCloseはlive所有者にだけ許可。見つからないIDはUNAUTHORIZEDとして返し、他人のIDの存在を漏らさない。認証失敗や期限切れでDBを書き換えない。
- [x] claimExpiredは同一transactionで読取り・期限判定・closingへの変更を行う。cleanup_failedもclosingへ戻して回収対象として返す。deletedは返さない。claimは管理者内部用で公開HTTPに直接公開しない。
- [x] 別トークン拒否、期限ちょうどのheartbeat拒否、期限前claimで未変更、終了後再オープンでも拒否、transaction中例外のrollbackをテストする。全テストと型検査後commitする。

### Task 3: 副作用より先に所有リソースを記録

**Interfaces:**

```ts
export type ResourceKind = 'compose_project' | 'volume' | 'network' | 'upload_dir';
export interface OwnedResource {
  sessionId: string; kind: ResourceKind; name: string;
  state: 'planned' | 'created' | 'removed';
}
// Same database as sessions, foreign keys enabled.
export class ResourceStore {
  constructor(path: string);
  plan(resource: Omit<OwnedResource, 'state'>): void;
  markCreated(sessionId: string, kind: ResourceKind, name: string): void;
  markRemoved(sessionId: string, kind: ResourceKind, name: string): void;
  pending(sessionId: string): OwnedResource[];
  close(): void;
}
// SessionStore: reportCleanup(id: string, success: boolean): Session
```

- [x] 一時DBでリソースをplannedとして記録し、作成完了前にclose/reopenするテストを書く。再オープンしたpendingにplannedが残ること、BのmarkRemovedでAのリソースが変化しないことをassertする。
- [x] 未実装の失敗を確認し、次のテーブルを実装する。

```sql
CREATE TABLE IF NOT EXISTS resources (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('planned','created','removed')),
  PRIMARY KEY(kind, name)
) STRICT;
```

- [x] リソース名はサーバーが生成し`visulia-<sessionId>-`で始まる値に限定する。kindは固定列挙。絶対パス・ユーザー入力をリソース名に使わない。ディレクトリ操作時の実パスは後続providerが管理rootから組み立てる。
- [x] planはactiveセッションにのみ許可。同じ所有者・同じ内容の再実行は変更なし、他所有者やremovedからの再作成は拒否。markCreatedはplannedからだけ許可、removedを復活させない。markRemovedはplanned/createdからremoved、再実行は変更なし。すべてWHEREにsession_idを含める。
- [x] reportCleanupは同じtransaction内でpendingが空であることを確認してからfinishClose(..., true)する。失敗時はfinishClose(..., false)。pendingが残れば成功通知を拒否する。
- [x] `reportCleanup(id,true)`をpendingありで呼ぶとdeletedにならないこと、plannedのままでもmarkRemovedできること、最後の削除後にのみdeletedへ移ることを試験する。全テストと型検査後commitする。

## 完了条件と次の実装

- [x] 実SQLiteの再オープンと2接続の状態競合をテストした結果を記録する。
- [x] DBに平文トークンやログ本文を保存しないことを確認する。
- [x] HTTPサーバー、環境発行provider、実サービスでの回収は別の次工程として明記する。
- [x] providerはplan→create→markCreated、終了は認証失効→remove→markRemoved→reportCleanupの順を使う。実処理をDB transaction中にawaitしない。

参考: https://nodejs.org/api/sqlite.html 。`node:sqlite`の安定度はrelease candidateであり、実装時に使用中NodeでのAPI可用性を確認する。

実装・検証記録: `docs/evidence/2026-09-27-durable-session-store.md`。provider向け契約: `docs/session-store-contract.md`。
