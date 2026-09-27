# VISULIA Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** npm導入した利用者が、作者のサーバーに一時解析環境を作り、自分のログと設定で調査でき、終了後に環境を回収できるVISULIAを公開可能にする。

**Deployment update (2026-09-27):** 公開デモの配置はユーザー承認によりWorkers + Containersへ変更。以下のCompose表記は当初案であり、公開デモの現行構成は`docs/architecture/cloudflare.md`を参照する。社内自己ホスト・既存ES/Kibana接続の要求は削除しない。

**Architecture:** CLIはHTTPSで管理APIへ接続する。管理APIが実行セッションごとに認証と専用サービス・ネットワーク・ボリュームを発行する。ES|QLで検索・集計し、Kibanaで編集・描画する。

**Tech Stack:** TypeScript/Node.js、Docker Compose、TomEE、Vector/VRL、Elasticsearch、Kibana。

**Spec:** `docs/superpowers/specs/2026-09-27-reusable-log-analysis-design.md`

## Global Constraints

- 製品名: VISULIA / CLI実行名: `visulia`。npm登録名は小文字の`visulia`を候補とする（取得可否は未確認。必要ならscopeを使用）。
- CLIの初回検証対象はmacOS/Linux。
- heartbeat間隔は30秒、切断猶予は5分、デモ最大時間は30分を初期案とする。
- 公開デモ利用者にDockerを要求しない。作者の環境へ接続する。
- セッション別にES/Kibana/Vector、設定、ネットワーク、保存領域を分離する。
- セッション中の一時保存を認め、終了後に削除する。即時の物理消去は保証しない。
- 持ち込みログを許容し、公開デモへの送信先を明示する。
- 管理者の秘密情報、持ち込み本文は管理ログへ出さない。
- 実機試験、画面試験、他者試用はそれぞれ別の証拠として記録する。

## Review Focus

1. 別セッションのIDを指定した操作は認証が正しくても拒否する（第1段階Task 2、第2段階HTTP試験）。
2. セッション期限とheartbeatの競合で期限が延長されない（第1段階Task 2/3）。
3. 環境作成途中の失敗・削除途中の再起動でも孤立したリソースを回収する（第2段階）。
4. アップロードのパス名、サイズ、処理失敗で他領域に書き込まない（第3段階）。
5. 編集済みのDashboardをテンプレート適用で黙って上書きしない（第4段階）。

## 分割と順序

全体を一つの巨大な計画にせず、下記の成果物ごとに詳細計画を作り、順番に実装する。これらは機能削減ではない。第1段階の詳細計画を同時に保存している。

| 段階 | 成果物 | 検証による区切り |
| --- | --- | --- |
| 1 | セッション認証・状態遷移・期限・回収対象の契約 | 外部サービスなしで所有権、期限、冪等な終了を検証 |
| 2 | 管理API、永続状態、専用Compose環境、アカウント発行、HTTPS/ブラウザー認証 | 2環境の同時作成・互いのアクセス拒否・片方だけ削除・管理プロセス再起動後の回収 |
| 3 | TomEE生成器、アップロード、編集できるParser、Vector収集、Schema検証 | 生成・持ち込みの両経路で件数、単位、不正行、再送、ローテーションを実機検証 |
| 4 | ES|QL、Mapping/template編集、Kibana編集、再解析 | 同名テンプレートの独立編集、API反映と画面表示、差分確認後の再適用 |
| 5 | 対話CLIとnpm成果物、管理者向けsetup | Dockerなし端末へnpm成果物を導入し、遠隔環境を作成・編集・終了できる |
| 6 | 公開環境でのE2E、資源上限、削除検証、README・動画 | 期限切れ回収、データ非残存、外部通信不要の自己ホスト検証、公開用証拠 |

第2段階でサービスの固定バージョン、公式イメージ、API、権限と利用条件を調査する。初回実装で過去記録のElasticバージョンを盲目的に採用しない。実装・試験に使ったdigestを記録する。

## 責務と予定ディレクトリ

```text
src/session/           認証、所有権、状態、期限（第1段階）
src/server/            HTTP API、永続状態、定期回収（第2段階）
src/provision/         Compose・資格情報・所有リソース管理（第2段階）
infra/                サーバー構成とセッション用Compose雛形
demo/                 TomEEアプリと負荷生成器（第3段階）
src/ingest/            アップロードと検証・再解析の制御
config/parsers/        VRLと形式ごとの検証サンプル
config/schema/         共通SchemaとMapping
src/elastic/          ES|QL、Mapping、Kibana API（第4段階）
dashboards/           編集可能な初期テンプレート
src/cli/              visuliaの対話とコマンド（第5段階）
tests/unit/           状態とデータ処理の独立した試験
tests/integration/    HTTPと実サービスの試験
tests/e2e/            導入から終了までの試験
docs/evidence/        環境・期待値・観測結果・未確認事項
```

## 全体の受入チェック

- [ ] 空の利用端末にnpm成果物を導入し、公開サーバーへ接続できる。
- [ ] セッションごとに異なるアカウント・接続先・サービス・ボリュームを発行できる。
- [ ] 生成ログと持ち込みログを別々に投入し、元の入力と件数・値が一致する。
- [ ] Parser/Mapping/ESテンプレート/ES|QL/Dashboardを利用者が変更できる。
- [ ] 同名リソースを2セッションで作成しても相互に影響しない。
- [ ] ESへの一時的な接続断とログローテーション後に回復する。
- [ ] 正常終了、CLI強制終了、サーバー再起動後の期限切れを回収できる。
- [ ] APIだけでなく、Kibana画面でパネル編集と元ログへの到達を確認する。
- [ ] バックアップ・管理ログに持ち込み本文が残らない構成を検証する。
- [ ] 社内自己ホスト構成で外向き通信を遮断して基本機能を試験する。
- [ ] 実ホストの負荷試験から同時利用上限を定める。
- [ ] GitHub/npmの公開先とライセンスを決定し、公開物を確認してから公開する。

## 実行時の現在地

設計書のみ存在する新規リポジトリ。Node.js v25.8.2、npm 11.12.1、dockerコマンドの存在を確認した。Docker daemonの稼働・サービスの取得・公開サーバー・npm登録名は未確認。第1段階はこれらに依存しない。以降の詳細計画は、第1段階の確定した契約を引き継いで作成する。
