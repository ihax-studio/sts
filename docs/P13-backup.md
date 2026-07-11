# P13: Cloudflare R2 バックアップ（Firebaseを「正」に保ったまま二重化）

## 方針（合意事項）
- **Firebase RTDB が常に source of truth。** 今のチャット送受信は一切変えない。
- R2 はあくまで**二重化（災害復旧）**。テキストのみ・**直近2年**・画像inlineは除外で **~10MB** を維持。
- **Firebase本体の purge（古いデータ削除）は、R2への往復（バックアップ→復元）が検証で通るまで有効化しない。**

## 仕組み（実装済みコード）
- `worker/telegram-storage.js` の `backupRtdb(env)`（日次Cron, 既定 JST3時）が RTDB を読み、
  - 2年より古いメッセージは**バックアップ対象外**（Firebase本体は消さない）、
  - 画像inline(dataURL)は `[img]` に置換（テキスト/構造のみ）、
  - `env.BACKUP_BUCKET`（R2 binding）があれば `rtdb-YYYY-MM-DD.json` を R2 に保存、Telegram にも従来どおり送信。
- `GET /backup-latest` … R2 の最新 `rtdb-*.json` を返す（`BACKUP_BUCKET` binding 時のみ）。災害復旧の取得口。

## 有効化手順（ユーザー作業）
> Worker は `~/work/Shake-to-Shake/worker/`。`npx wrangler` を使用（要 Node）。

1. R2 バケット作成
   ```
   npx wrangler r2 bucket create s2s-backup
   ```
2. `worker/wrangler.toml` の R2 binding 2行のコメントを外す（`[[r2_buckets]]` / `binding="BACKUP_BUCKET"` / `bucket_name="s2s-backup"`）。
3. バックアップ用の env を設定（未設定なら）
   ```
   npx wrangler secret put FB_URL      # 例: https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app
   npx wrangler secret put FB_SECRET   # RTDB データベースシークレット(読取専用推奨)
   # 任意: BACKUP_HOUR(UTC,既定18=JST3時) / BACKUP_OFF=1 で停止
   ```
4. デプロイ
   ```
   npx wrangler deploy
   ```

## 検証（往復が通るまで purge は絶対に入れない）
1. **バックアップ生成**: Cronを待つか、ダッシュボードで一度手動実行 → R2 に `rtdb-YYYY-MM-DD.json` が出来る。
2. **サイズ確認**: そのJSONが概ね ~10MB 以内・テキストのみ（`img` は `[img]`）・2年より古いmsgが無いこと。
3. **取得確認**: `https://<worker>/backup-latest` が最新JSONを返す（`X-Backup-Key` ヘッダに日付）。
4. **復元の往復**: テスト用に Firebase の一部を消し、`/backup-latest` の内容から書き戻せること（手動 or 復元ツール）を確認。
5. ↑がすべて通って初めて、Firebase の「2年超の自動purge（可逆・admin限定）」の導入を検討する。**それまでは Firebase を縮小しない。**

## 現状の安全性（容量）
- 既存でも日次フルバックアップ（Telegram）は動作。R2 は binding 設定で追加されるだけ。
- チャット本文は暗号文 `t`＋`ts` 中心で軽量。画像は R2 メディア(`worker/media-r2.js`)or Telegram に本体を置き、RTDB には短い参照のみ → RTDB は元々肥大しにくい。
- 2年フィルタにより、バックアップ側は線形に増えない（古い分は対象外）。
