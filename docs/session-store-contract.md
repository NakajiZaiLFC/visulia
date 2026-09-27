# セッション永続ストアの利用契約

このモジュールは管理サーバー内部で使用する。利用者へSQL接続、ResourceStore、reportCleanupを直接公開しない。

## 保存先とデータ

- `SessionStore(path)`と`ResourceStore(path, clock?)`には同じ専用SQLiteファイルを渡す。
- 親ディレクトリは実行ユーザー所有かつ0700等の専用権限にする。存在しない場合は作成する。既存の共有ディレクトリを勝手にchmodしない。
- DBファイルは0600。シンボリックリンク、複数hard link、他ユーザー所有ファイルは拒否する。
- セッションのJSONは固定のフィールドだけを保存する。トークンはhashのみ。持ち込み本文、認証パスワードを追加しない。
- 保存レコードの破損は`CORRUPT_SESSION`として拒否する。データを空の状態へリセットしない。
- `node:sqlite`の安定度はrelease candidate。現在の検証環境はNode.js 25.8.2 / SQLite 3.53.4。LTSでの配布検証は別工程。

## 状態更新

- `heartbeat`と`requestClose`はIDとトークンを受け、BEGIN IMMEDIATE後に最新レコードを読む。呼び出し元の古いSessionを保存し直さない。
- 関数内の認証・期限・更新のどこかで失敗したら全変更をrollbackする。
- `claimExpired`は管理内部の単一coordinatorが使う。期限切れだけでなくclosing/cleanup_failedも再処理対象にする。複数workerの排他的なジョブ予約ではない。
- 時刻はcoordinatorの信頼できる時計を使用し、HTTP利用者から指定させない。期限の巻き戻り・不正値は拒否する。

## 環境を作成するproviderの順序

1. `SessionStore.insert`でセッションを記録する。
2. サーバーが生成したリソース名を`ResourceStore.plan`で記録する。
3. 実際の環境を作成する。この外部操作をSQLite transactionの中で待たない。
4. 成功したリソースを`markCreated`にする。

作成途中で停止した場合はplannedのまま残る。次のcoordinatorは名前と所有ラベルを照合して回収する。作成完了時に期限切れ等でmarkCreatedが拒否されても、実物を放置せず回収対象として扱う。

## 終了するproviderの順序

1. `requestClose`または`claimExpired`で状態をclosingにし、認証を失効させる。
2. `pending`でplanned/createdを取得し、実際のリソースを削除する。
3. 各削除の成功または実物の不存在を確認してから`markRemoved`を呼ぶ。
4. 全件回収後に`reportCleanup(id,true)`。残件がある場合は拒否される。
5. 失敗したら`reportCleanup(id,false)`として再試行対象に残す。

DBのremoved状態はproviderからの報告であり、実コンテナを独立検証した証拠ではない。providerはセッション単位で作成と削除を同時実行せず、再起動後に実物と記録を照合する。記録済み削除の後から、途中だった作成処理が完了して環境を残す競合もproviderで防ぐ。

実装済み試験は、一時ディレクトリ内の実SQLiteと2接続の状態遷移・rollbackを検証している。複数coordinatorによる同時回収、HTTP認証、Docker操作、Kibana表示は対象外。
