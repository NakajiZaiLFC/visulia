# VISULIA Session Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一時解析環境の発行単位となるセッションの認証、状態遷移、期限、回収対象判定を独立して検証できるTypeScriptモジュールを作る。

**Architecture:** 時刻・ID・トークンを明示的に渡す純粋な状態処理と、Node.js標準cryptoによるトークン処理に分ける。HTTP、永続化、Composeの副作用は次段階の責務とする。モックの合格を実環境の削除成功と報告しない。

**Tech Stack:** TypeScript、Node.js標準`crypto`と`node:test`、tsc。

**Spec:** `docs/superpowers/specs/2026-09-27-reusable-log-analysis-design.md`

## Global Constraints

- 製品名VISULIA、実行名`visulia`。この段階はCLI公開ではなく内部モジュールの実装。
- heartbeat間隔は30秒、切断猶予は5分、デモ最大時間は30分を初期案とする。
- 新規起動は新規セッション、有効な再接続は同じセッションを使う。
- 他セッションの操作を禁止し、終了開始後は認証を無効化する。
- 専用環境の削除は後続の副作用実装に委ね、この段階では削除成功を仮定しない。
- 公開・サービス起動・ユーザーデータ送信はこの計画には含まない。

## Review Focus

1. 他セッションのトークンと不正長トークンを拒否する（Task 1/2）。
2. 最大期限ちょうどのheartbeatは期限を延長しない（Task 2）。
3. NaN、負値、時計の巻き戻りで期限判定を回避しない（Task 2）。
4. 終了要求の繰り返しと削除失敗で状態を復活させない（Task 3）。
5. 回収対象の列挙が有効な他セッションを書き換えない（Task 3）。

## ファイルと契約

```text
package.json                 privateな開発用設定、build/test/check
package-lock.json            依存の再現性
tsconfig.json                strict、ES modules、dist出力
.gitignore                   node_modules、dist、一時データの除外
src/session/types.ts         状態型、時間定数、SessionError
src/session/token.ts         トークンの発行・hash・照合
src/session/lifecycle.ts     作成・認証・ready・heartbeat・終了遷移
src/session/reaper.ts        期限判定と回収対象の抽出
tests/unit/token.test.ts     認証素材の試験
tests/unit/lifecycle.test.ts 状態・所有権・時刻の試験
tests/unit/reaper.test.ts    回収判定の試験
```

### Task 1: 認証素材と状態型

**Files:** 上記の開発設定、`types.ts`、`token.ts`、`token.test.ts`。

**Interfaces:** 次の型と関数を作る。時刻はUnix epochのミリ秒。

```ts
export const IDLE_MS = 300_000;
export const MAX_MS = 1_800_000;
export type State = 'provisioning' | 'ready' | 'closing' | 'cleanup_failed' | 'deleted';
export type Reason = 'requested' | 'idle' | 'maximum' | 'provision_failed';
export interface Session {
  id: string; tokenHash: string; state: State;
  createdAt: number; lastHeartbeatAt: number;
  idleExpiresAt: number; maxExpiresAt: number;
  closeReason?: Reason;
}
export class SessionError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'UNAUTHORIZED' | 'EXPIRED' | 'INVALID_STATE') {
    super(code);
  }
}
// token.ts
export function issueToken(): string;
export function hashToken(token: string): string;
export function matchesToken(token: string, hash: string): boolean;
```

- [ ] 開発設定を追加。`private: true`、`type: module`、`build: tsc`、`test: npm run build && node --test dist/tests/unit/*.test.js`、`check: tsc --noEmit`とする。TypeScriptとNode型定義のみ開発依存として追加しlockfileを保存する。`rootDir: .`、`outDir: dist`、`module: NodeNext`、`strict: true`を設定する。
- [ ] 次のテストを`token.test.ts`へ書く。

```ts
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
```

- [ ] `npm test`で未実装により失敗することを確認。
- [ ] 型を上記の通り実装。トークンは`randomBytes(32).toString('base64url')`、hashはSHA-256 hex。照合は形式検査後に`timingSafeEqual`を使う。

```ts
if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(hash)) return false;
return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'));
```

- [ ] `npm test`と`npm run check`が成功することを確認し、該当ファイルをcommitする（`feat: add session credential primitives`）。

### Task 2: セッション作成、所有権、準備完了、heartbeat

**Files:** `src/session/lifecycle.ts`、`tests/unit/lifecycle.test.ts`。

**Interfaces:** Task 1のSession/SessionError/matchesTokenを使う。

```ts
export function createSession(input: {id: string; tokenHash: string; now: number}): Session;
export function authorize(session: Session, token: string, now: number): void;
export function markReady(session: Session, now: number): Session;
export function heartbeat(session: Session, token: string, now: number): Session;
```

- [ ] 下記の試験を追加。hash済みでない秘密情報がSessionへ入らないことも確認する。

```ts
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
```

- [ ] `npm test`で失敗を確認。
- [ ] `createSession`でidを`^[a-z0-9-]{1,64}$`、hashを64桁hex、時刻を非負safe integerとして検証する。初期状態はprovisioning、idle期限はnow+IDLE_MS、最大期限はnow+MAX_MS。加算後もsafe integerを検証する。
- [ ] 認証・状態処理を以下の順で実装する。

```ts
// authorize: caller input, token, active state, deadline の順で検証
// now < session.lastHeartbeatAt はINVALID_INPUT
// token不一致/closing/cleanup_failed/deletedはUNAUTHORIZED
// now >= Math.min(idleExpiresAt, maxExpiresAt) はEXPIRED
// markReady: サーバー内部用。provisioningからのみ遷移、期限も検査
// heartbeat: authorize後にコピーを返す。元オブジェクトを変更しない
return { ...session, lastHeartbeatAt: now,
  idleExpiresAt: Math.min(now + IDLE_MS, session.maxExpiresAt) };
```

- [ ] 不正id・hash・overflow、期限後markReady、readyから再度markReadyが失敗する試験を追加する。`assert.throws(() => createSession({id:'../a', tokenHash:hashToken(issueToken()), now:0}), rejects('INVALID_INPUT'))`を含める。
- [ ] `npm test`と`npm run check`を実行しcommitする（`feat: enforce session ownership and lease lifecycle`）。

### Task 3: 終了と期限切れ回収の判定

**Files:** `lifecycle.ts`に終了処理を追加、`reaper.ts`、`reaper.test.ts`。

**Interfaces:** 副作用実行側だけが以下の内部関数を呼ぶ。利用者の終了要求はHTTP層でauthorizeを通す。

```ts
export function beginClose(session: Session, reason: Reason): Session;
export function finishClose(session: Session, success: boolean): Session;
export function expiryReason(session: Session, now: number): 'idle' | 'maximum' | undefined;
export function cleanupCandidates(sessions: readonly Session[], now: number): string[];
```

- [ ] 次のテストを追加する。

```ts
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
```

- [ ] `npm test`で失敗を確認。
- [ ] `beginClose`はactive状態からclosingへ、cleanup_failedからclosingへ遷移する。既存のcloseReasonを維持する。closing/deletedは同じ状態を返す。`finishClose`はclosingのみ受け付け、成功時deleted、失敗時cleanup_failed。deletedへの成功再通知は同じ状態を返し、それ以外はINVALID_STATE。
- [ ] `expiryReason`は時刻を検証し、active状態だけを対象に最大期限→idle期限の順に判定する。`cleanupCandidates`はclosing/cleanup_failed/期限切れのIDを返し、deletedは除外する。入力は変更しない。

```ts
return sessions.filter(s =>
  s.state === 'closing' || s.state === 'cleanup_failed' || expiryReason(s, now) !== undefined
).map(s => s.id);
```

- [ ] 最大期限とidle期限が一致した場合のmaximum優先、期限1ms前、deletedの除外、不正時刻、readyからのfinishClose拒否を追加試験する。
- [ ] `npm test`と`npm run check`を実行しcommitする（`feat: define idempotent session cleanup transitions`）。

## 完了と次段階への引き継ぎ

- [ ] 上記の全試験と型検査の結果を報告する。
- [ ] HTTP認証、DBの排他・永続化、実リソースの削除、Dockerの分離は未実施と明記する。
- [ ] 第2段階でこのSessionを永続化し、heartbeat/回収の競合をトランザクションで解決する計画を作る。
- [ ] 第2段階では作成開始前の所有権記録、Composeへのセッションラベル、途中作成の回収、認証失効を実装する。純粋な判定だけを公開サーバーへ接続しない。

## 計画自己レビュー

第1段階の要件をTask 1〜3へ割り当て済み。全体の残りはdelivery計画の第2〜6段階で明示している。APIは本書内で定義したものだけを使用する。秘密のhash化、別セッションの拒否、期限境界、不正時刻、失敗後の再試行を試験に含めた。
