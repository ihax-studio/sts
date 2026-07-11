# Shake-to-Shake 画像ストレージ（Telegram中継）セットアップ

worker（`shake-toshake`）の画像保存を **Telegram Bot 中継**で動かす手順。
**容量は実質無制限・完全無料**。アプリの利用者は Telegram 不要。**あなた（オーナー）だけ Telegram アカウントが1つ必要**（初回セットアップのみ・使い捨て可）。

> 画像を送らない／cdot（超軽量ドット）で十分なら、この設定は不要です。

---

## 1. Telegram アカウントを用意（使い捨てOK）
スマホの Telegram アプリ、または <https://web.telegram.org> でアカウントを1つ作る（電話番号が要る）。

## 2. Bot を作ってトークンを取得
1. Telegram で **@BotFather** を開く。
2. `/newbot` を送る → Bot名 と ユーザー名（末尾 `bot`）を決める。
3. 返ってくる **トークン**（例 `123456789:AAE...xyz`）をコピー。← これが `TG_TOKEN`

## 3. 保存用チャンネルを作って Bot を管理者に
1. Telegram で **新しいチャンネル**を作成（非公開でOK）。
2. チャンネルの「管理者」に、作った Bot を **管理者として追加**（投稿権限を付ける）。
3. チャンネルに何か1回投稿しておく（chat_id 検出用）。

## 4. chat_id を取得
デプロイ後に worker の `/chatid`（getUpdates）を開くと候補が出ます（手順6のあと）。
先に知りたい場合はブラウザで:
```
https://api.telegram.org/bot<TG_TOKEN>/getUpdates
```
を開き、チャンネル投稿の `chat.id`（例 `-1001234567890`）を控える。← これが `TG_CHAT`

## 5. wrangler にログイン（初回のみ）
ターミナルで（このセッションなら先頭に `!` を付けて実行）:
```
! npx wrangler login
```

## 6. シークレットを設定してデプロイ
`~/work/Shake-to-Shake/worker` で:
```
cd ~/work/Shake-to-Shake/worker
npx wrangler secret put TG_TOKEN      # 手順2のトークンを貼る
npx wrangler secret put TG_CHAT       # 手順4の chat_id（-100...）を貼る
npx wrangler deploy                    # shake-toshake を更新
```

## 7. 動作確認
```
curl -X POST "https://shake-toshake.s-users15.workers.dev/up?name=t.jpg&type=image/jpeg" \
  --data-binary "@/path/to/any.jpg"
```
→ `{"ok":true,"id":"...","mid":...}` が返れば成功。以後、PWA/CLIの画像は Telegram に保存され、`/dl?id=<id>` で配信されます。

---

## うまくいかない時
- `{"ok":false,"err":"Not Found"}` = **トークンが無効** → 手順2をやり直し、`secret put TG_TOKEN` し直して再デプロイ。
- `chat not found` / 403 = Bot がチャンネルの**管理者になっていない**、または `TG_CHAT` が違う → 手順3・4を確認。
- `worker not configured` = `TG_TOKEN`/`TG_CHAT` 未設定 → 手順6。

## R2 を使いたい場合（Telegram不要・10GB無料）
`wrangler.toml` の `[[r2_buckets]]` 3行のコメントを外し、ダッシュボードで R2 を有効化 →
`npx wrangler r2 bucket create s2s-media` → `npx wrangler deploy`。
worker は `MEDIA` バインディングがあれば自動で R2 を使います（コード変更不要）。
