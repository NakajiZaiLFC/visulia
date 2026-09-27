# Session core — 検証記録

2026-09-27 / Node.js 25.8.2 / npm 11.12.1

## 実装と証拠

- 89a369e: token発行、hash化、照合。テスト1件を失敗から成功へ。
- 6947ce9: 所有権、作成、ready、heartbeat。累計7件成功。
- 7f85282: 終了、回収候補、削除失敗からの再試行。累計13件成功。
- `npm test`: 13件成功、失敗0件。
- `npm run check`: 成功。
- 独立レビュー: 6a40362..7f85282。Critical/Important/Minorの指摘なし。
- レビュー側でも13件の試験と型検査を確認。不正長token、改行、安全整数上限付近を追加検証。

## 設計上の判断

- 新規作成した専用リポジトリのcodex/initial-designで継続し、追加worktreeは作成していない。既存製品変更との混在はないが、実装commitは現在のbranchに残る。
- 未実装のimportエラーだけをREDとせず、インターフェースの仮実装に対する失敗を確認してから実装した。仮実装は製品コードに残していない。
- 新規repoにはbase branchやremoteがないため、そのままローカル保持。merge/push/publishは行っていない。

## レビューで対象外とした範囲と引き継ぎ

1. HTTP認証と外部入力: HTTP層で内部関数を無認証公開しない。
2. 永続化・排他: 古いスナップショットによる更新復活をDB transactionで防ぐ。
3. 実削除・Compose分離・途中作成回収: 実providerで検証し、状態試験で代替しない。
4. 破損Sessionの防御: 永続化境界で検証する。現時点は生成・遷移関数を通った値が前提。
5. CLI/npm/ブラウザー/公開デモ: 未実装であり、この段階の合格範囲外。

## 環境と残作業

Docker CLIとCompose v5.1.3は存在するが、`docker info`は `/Users/nassy/.docker/run/docker.sock` が存在せず接続失敗。Dockerの起動や設定変更は行っていない。

公開サーバーとnpm公開先は未設定。次は `docs/superpowers/plans/2026-09-27-visulia-durable-session-store.md` に従い状態・所有リソースの永続化を実装する。SQLiteの試験はDockerなしで実施できる。環境の発行とDashboardの実機検証には動作するコンテナ基盤が必要。
