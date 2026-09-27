# VISULIA

VISULIAは、npmで導入する対話型CLIから一時的なログ解析環境を利用するプロジェクトです。作者の公開サーバー上で、利用者ごとにElasticsearch・Kibana・Vectorの環境を割り当て、デモログまたは持ち込みログを解析する構想です。

**現在は開発初期です。npmには未公開で、公開サーバー・Dashboardはまだ利用できません。CLIは開発用接続先で検証中です。**

## 実装済み

- セッション用トークンの発行とhashによる照合。
- 所有者の認証、5分の切断猶予、30分の最大有効期間。
- 準備中・利用可能・終了処理中・削除失敗・削除済みの状態遷移。
- 期限切れの回収対象判定と、削除失敗後の再試行の状態管理。
- SQLiteによるセッションと所有リソースの永続化。再オープン後も期限・失効を維持。
- トランザクションによるheartbeatと終了状態の更新。未回収リソースがあれば削除完了を拒否。

- Vector/VRLによる2形式のアクセスログ解析、厳密なSchema検証、不正行の隔離。
- 継続追記、読み取り再開、ディスクバッファ、renameローテーションの投入設定と実Vectorテスト。未修正版Vectorで断続的な停止を確認しており、修正版ビルドでの再検証が残っています。
- Cloudflare WorkersのセッションAPIと、Durable Objectsによる認証・利用枠・期限管理。
- Containerの起動・削除アダプター。起動中の終了、削除失敗の再試行、異常終了後の失効に対応。
- コンテナ内サービスの起動処理、個別認証情報、停止処理、専用ファイル領域の準備。認証付き管理APIと実行イメージの定義を追加し、リモートでの実サービス検証を準備しています。
- TomEEデモアプリとアクセスログ設定、デモリクエスト生成処理。実TomEEでの動作確認は未実施です。

Cloudflare向けの制御処理はworkerdで検証しています。Container本体はテスト用の代替実装で検証した段階で、Elasticsearch・Kibanaの実行イメージと実環境へのデプロイは未完了です。SQLiteは自己ホスト向けの構成要素であり、Workersでの保存先はDurable Objectsです。

## 開発中のCLI

Node.js 24以上で、ビルド後に `node dist/src/cli/main.js --server https://接続先` を実行します。
`npm pack`したパッケージをインストールすると、実行名は `visulia` です。npmには未公開です。

メニューは `init / demo / upload / template / config / check / ingest / status / stop / reparse / query / dashboard / kibana / quit`。
まずdemo生成完了をstatusで確認し、check、ingestの順に進みます。投入中にもdemoを追加生成できます。
initではログ形式・時間単位・サービス名・環境名を対話で設定します。templateで現在の設定を新規ファイルへ取得し、編集したmetadata・parser・mappingのJSONをconfigで読み込みます。uploadは選んだファイルの送信確認後に実行します。
接続用トークンはメモリだけで保持し、終了時に専用環境の削除を要求します。
`kibana`で60秒・1回限りのブラウザ接続リンクを発行できます。`dashboard`はES|QLを検証して新しいDashboardを作成する候補実装です。実機の保存・描画確認と自己ホスト導入ガイドはまだ完了していません。

## 開発用の検証

```sh
npm ci
npm test
npm run check
npm run test:worker
npm run check:worker
```

現時点の検証環境はNode.js 25.8.2 / npm 11.12.1です。公開版の対応Node.jsバージョンは配布検証で確定します。

## 今後の利用体験

1. 手元にVISULIAをインストールし、`visulia`を起動。
2. 専用の一時環境とアカウントを取得。
3. 生成デモログか、自分が選んだログファイルを投入。
4. Parser、Mapping、ES|QL、Kibanaのパネルを編集して調査。
5. 終了後または期限切れ後に、その環境を削除。

解析中はログをサーバー側に一時保存します。「一切保存しない」仕組みではありません。公開デモへのアップロードは外部送信に当たります。外部送信できないログには、今後提供する社内自己ホスト構成を使用します。

設計と計画は`docs/superpowers/`、実装の検証記録は`docs/evidence/`にあります。

Cloudflareでの構成は`docs/architecture/cloudflare.md`に記載しています。`wrangler.containers.example.jsonc`は実行イメージを組み込むための未完成の構成案で、そのままデプロイするものではありません。`wrangler.types.jsonc`は型生成だけに使用します。

ログ形式・時間単位・Mappingの編集範囲・配信保証は`docs/pipeline-contract.md`、実Vectorによる検証は`docs/evidence/2026-09-27-vector-pipeline.md`を参照してください。

実行イメージとリモート検証の手順は`docs/runtime-image.md`を参照してください。
