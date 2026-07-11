# Shake to Shake（シェイクでシェア）デプロイ手順 — S4〜S8

最終更新: 2026-06-28 / 対象コミット: `main` = S4〜S8 反映済み（Netlify 自動配信）

---

## 0. いま何が動いていて、何をすればいいか（結論）

| 機能 | 中身 | 状態 | あなたの作業 |
|---|---|---|---|
| **S4 通知UI / S5 カメラ / S7 ギャラリー**（クライアント） | `index.html` ほか | ✅ **本番反映済**（push to main → Netlify） | なし。実機で確認するだけ |
| **S8 通知スケジュール**（`s2s-push` Worker） | 毎日3〜5回/04:00〜23:30 に「🫨シェイクをしよう👀」を一斉送信 | ⚠️ **旧コードでデプロイ済** | **再デプロイ**（→ 第2章） |
| **S6 R2画像＋700MB管理**（`s2s-media` Worker） | s2s写真を Cloudflare R2 に保存＋自動掃除 | ❌ **未デプロイ** | **任意**。R2 にするなら（→ 第3章） |

> **Telegram について**: s2s の写真は **R2 を使えば Telegram 不要**です（第3章）。R2 を立てる前の暫定状態では、写真は既存の保存用 Worker（`shake-toshake` = `STORAGE_URL`）に載ります。**S8 と S6 のデプロイはどちらも Telegram を一切使いません**（Firebase と Push と R2 だけ）。

### 現在デプロイ済みの Worker（health で確認した実態）
| Worker URL | 役割 | 状態 |
|---|---|---|
| `https://shake-toshake.s-users15.workers.dev` | チャット/写真の保存（Telegram版・`STORAGE_URL`） | 稼働中 |
| `https://shake-push.s-users15.workers.dev/push` | Web Push 送信本体（チャット通知と共用） | 稼働中＝**これが `PUSH_URL`** |
| `https://s2s-push.s-users15.workers.dev` | s2s スケジュール通知（`s2s-push.js`） | 稼働中だが**旧コード→要再デプロイ** |
| `https://s2s-media.s-users15.workers.dev` | s2s 写真の R2 保存（`media-r2.js`） | **未デプロイ** |

### 共通の前提
```bash
cd ~/work/Shake-to-Shake/worker      # 作業はこのディレクトリで
npx wrangler --version               # 無ければ: npm i -g wrangler  または npx を使う
npx wrangler login                   # 未ログインなら（ブラウザが開く）
```
> このターミナルから直接打てない場合は、Claude Code のプロンプトに `! <コマンド>` を付けて実行すると出力がそのまま会話に出ます。

---

## 2. S8：通知スケジューラを「再デプロイ」する（必須）

`s2s-push` は既に動いていますが、コードが旧版（平日/休日分岐）です。リポジトリ側を **毎日3〜5回・04:00〜23:30** に更新済みなので、**コードを上書きデプロイ**するだけ。

> `wrangler deploy` は **secret を消しません**。既に設定済みなら再設定は不要です。

```bash
cd ~/work/Shake-to-Shake/worker
npx wrangler deploy -c wrangler-s2s.toml
```

### secret（未設定の場合のみ）
```bash
npx wrangler secret put FIREBASE_DB_URL -c wrangler-s2s.toml
#   → https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app
npx wrangler secret put FIREBASE_SECRET -c wrangler-s2s.toml
#   → Firebase コンソール → プロジェクト設定 → サービスアカウント → データベースシークレット（レガシートークン）
npx wrangler secret put PUSH_URL        -c wrangler-s2s.toml
#   → https://shake-push.s-users15.workers.dev/push      ← 上の表で稼働確認済みの送信Worker
```
設定済みか確認: `npx wrangler secret list -c wrangler-s2s.toml`

### 動作確認
```bash
# 窓判定を無視して即・全員に通知（ADMIN_KEY を設定している場合は &key=... も付ける）
curl "https://s2s-push.s-users15.workers.dev/?force=1"
#   → "sent N"（N=購読者数）が返り、端末に「🫨シェイクをしよう👀」が届けばOK
#   通知タップ → アプリが開いてシェイクUI（端末画像を振る画面）が出れば S4 まで通って成功
```
- cron は `wrangler-s2s.toml` の `crons = ["*/15 * * * *"]`（15分毎・コード側 `INTERVAL=15` と一致）。
- 通知が来ない時: ①`secret list` に3つ揃っているか ②`PUSH_URL` が正しい送信Workerか ③受信側で通知許可ON（iOSはホーム画面追加=PWA必須）。

---

## 3. S6：s2s 写真を Cloudflare R2 に保存する（任意・Telegram不要にする）

R2 にすると s2s の写真本体が R2 に乗り、**700MB を超えたら古い順に自動削除**（お気に入り=保護）＋削除時に実体も消えます。**Telegram は使いません。**

### 3-1. R2 バケット作成 → Worker デプロイ
```bash
cd ~/work/Shake-to-Shake/worker
npx wrangler r2 bucket create s2s-media            # 初回のみ
npx wrangler deploy -c wrangler-media.toml
#   → 出てくる URL を控える（例: https://s2s-media.s-users15.workers.dev）
```
> R2 無料枠は 10GB。`wrangler-media.toml` の `CAP_MB="700"` で 700MB 上限を効かせています。

### 3-2. ライフサイクル（孤児掃除＋700MB管理）用の secret
掃除 cron が「どの画像が今の投稿で使われているか/お気に入りか」を判定するために Firebase を読みます。
```bash
npx wrangler secret put FB_URL    -c wrangler-media.toml
#   → https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app
npx wrangler secret put FB_SECRET -c wrangler-media.toml
#   → 上と同じ データベースシークレット（読み取り用）
```
> **安全装置**: `FB_URL`/`FB_SECRET` が未設定、または Firebase が読めない時、掃除 cron は **何も削除しません**（誤って全消しする事故を防止）。`/up` `/m` `/rm` 自体は secret 無しでも動きます。
> cron は `wrangler-media.toml` の `crons = ["30 18 * * *"]`（毎日 UTC18:30 = JST 3:30）。

### 3-3. クライアントを R2 に切り替える（ここで初めて s2s が R2 を使う）
`index.html` の中の **`var MEDIA_URL="";`**（"Cloudflare R2" のコメント直下、6045行目付近）に、3-1 で出た URL を貼る:
```js
var MEDIA_URL="https://s2s-media.s-users15.workers.dev";
```
保存して push:
```bash
cd ~/work/Shake-to-Shake
git add index.html
git commit -m "S6: enable R2 for s2s (set MEDIA_URL)"
git push origin HEAD:main      # → Netlify が再配信
```
> `MEDIA_URL` が空のうちは従来どおり（`STORAGE_URL` の保存Worker）に載ります。**埋めた瞬間に s2s 写真だけ R2 配信＋700MBライフサイクル**に切り替わります。チャット画像はこの設定の影響を受けません（別系統のまま）。

### 動作確認
```bash
curl "https://s2s-media.s-users15.workers.dev/health"     # → {"ok":true,"service":"s2s-media-r2"}
```
アプリでシェイク→撮影→シェア後、ギャラリーに写真が出ればOK（写真URLが `…/m/<key>` 形式になります）。

---

## 4. データ構造とコード対応（参考）

- 投稿ノード: `s2s/<uid> = { ts, imgs[], best, n [, keys[]] [, loc] [, music] [, fav] }`（1ユーザー最新1件）
  - `imgs[]` … R2なら表示URL、Telegramなら file_id（表示側が両対応）。
  - `keys[]` … R2 の `/m/<key>`。削除時に `/rm?key=` で実体削除＋cron掃除に使用。
  - `fav` … お気に入り（ギャラリー左上 pin）。**R2の700MB掃除で保護**される。
- スケジュール式は **`index-s2s.js` の `dayTimes` と `worker/s2s-push.js` の `dayTimes` を必ず一致**させること（日付シードで全端末＋サーバー同時刻）。今は両方「毎日3〜5回・04:00〜23:30」で一致済み。片方だけ変えると通知時刻とアプリ内の窓判定がズレます。
- 通知本文/遷移: `s2s-push.js` が `body:"🫨シェイクをしよう👀"`, `url:"/?s2s=1"`, `s2s:1` を送り、`gc-sw.js` の `notificationclick` が s2s を検知して `openShakePrompt`（振って撮影）へ。

---

## 5. 既知の制限（仕様の確認事項）

- **「古い投稿を 500×500/1024色 に再圧縮」「first/recent5/dedup」は未対応**。現スキーマが「1ユーザー最新1件」で履歴を持たないことと、Cloudflare Workers 単体では画像の再エンコードが出来ない（要 Cloudflare Images=有料）ため。クライアントが既に **≈800px / ≈33k色 / ≤77KB** で上げるので、通常 700MB には届きにくい想定。必要なら「投稿履歴スキーマ＋Cloudflare Images」で別途実装します。
- **非globe背景のタイトル画面の「横並び投稿リスト/last5」のホーム配置は未実装**（ホームレイアウトに踏み込むため、実機で置き場所を決めてから対応）。現状はアカウントカードのスワイプ／フィードからギャラリーが開きます。

---

## 6. まとめ（最短ルート）

1. `cd ~/work/Shake-to-Shake/worker && npx wrangler deploy -c wrangler-s2s.toml` → `curl ".../?force=1"` で通知テスト（**これだけで通知は新スケジュールに**）。
2. R2 を使うなら第3章（バケット作成→deploy→`MEDIA_URL` を埋めて push）。**Telegram は触らなくてOK。**
