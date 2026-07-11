# P06 / P13 を有効化する：Firebaseルール反映 手順書

> **これが唯一の必須作業**。`database.rules.json` を本番Firebaseに反映すると、
> **P06（index↔meettomeet 相互チャット）・P13（管理者の複数デバイス共有受信）・P05（グループ作成）** が一度に有効になります。
>
> ⚠️ P06でindexのチャットは `rooms/` → `chats/<cid>` 規格に移行済み。**未反映だとindexのチャット自体が動きません**（特にリアクション用に追加した `chats/$cid/r` ルールが必要）。

- 対象プロジェクト: **`ichat-pwa`**（`firebase-config.js` の `databaseURL` = `https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app`）
- 反映するファイル: リポジトリ直下の **`database.rules.json`**（最新版。`friends/and_admin` と `chats/$cid/r` を含む）

---

## 方法A：Firebaseコンソールで貼る（最速・推奨／1分）

1. https://console.firebase.google.com/ → プロジェクト **ichat-pwa** を開く
2. 左メニュー **Build → Realtime Database** → 上部タブ **「ルール」**
3. エディタの中身を**全消し** → リポジトリの **`database.rules.json` の中身を全文貼り付け**
4. 右上 **「公開」** をクリック（"Publish" 確認が出たら承認）
5. エラーが出なければ反映完了。

> 中身は `docs/phases/13-admin-multidevice.md` または `git show HEAD:database.rules.json` で確認できます。

---

## 方法B：Firebase CLI（PCから）

```bash
# 初回のみ
npm i -g firebase-tools
firebase login

# リポジトリ直下で（database.rules.json と firebase.json がある場所）
cd ~/Downloads/chat-app
firebase deploy --only database --project ichat-pwa
```

`firebase.json` に `"database": { "rules": "database.rules.json" }` があれば上記でそのまま反映されます（無ければコンソール=方法Aが確実）。

---

## 反映後の動作確認（実機 or 2タブ）

### P06：index ↔ meettomeet 相互チャット
1. **同じ2人**を用意（A・B。**管理者ではない**一般ユーザー同士で確認。管理者は別仕様）。
2. A は `https://shake-to-shake.netlify.app/`（index）、B は `https://shake-to-shake.netlify.app/meettomeet.html` で開く。
3. 互いに友達追加（招待リンク/QR）→ A から送信。
4. ✅ **B（meettomeet）に同じ会話が表示され、返信が A（index）にも届く**＝統一成功。
   - どちらも `chats/<cid=A__B>/msgs` を読み書き（`cid` は uid を `__` で連結したもの）。
5. リアクション（index側でメッセージをダブルタップ→❤️）が**エラーなく付く**＝`chats/$cid/r` ルール反映OK。

### P13：管理者の複数デバイス
1. 端末1・端末2の両方で化学式（管理者シークレット）を入力して管理者化。
2. 利用者が招待リンク（管理者の `and_admin` 宛）からチャットを送る。
3. ✅ **両方の端末の友達一覧/受信に同じ利用者が出て、新着通知が来る**（`friends/and_admin` を全管理者端末が読めるため）。

### P05：グループ作成（meettomeet）
- 友達を 0.2s 長押し→複数選択→「グループ作成」で**「作成しました」**が出れば反映OK（以前は権限エラーで失敗していた）。

---

## うまくいかない時（切り分け）

| 症状 | 原因 | 対処 |
|---|---|---|
| indexでメッセージが送れない/出ない | ルール未反映（`chats` 書込拒否） | 方法A/Bで再反映。コンソールで公開エラーが無いか確認 |
| リアクションだけ付かない | `chats/$cid/r` ルール未反映（古いルール） | 最新 `database.rules.json` を貼り直し |
| グループ作成が権限エラー | `groups`/`userGroups`/`chats/last` ルール未反映 | 同上 |
| 2台目の管理者で受信箱が空 | `friends/and_admin` の `.read` 未反映 | 同上。`friends.and_admin.".read"="auth != null"` が入っているか確認 |
| 「console rules で permission denied」表示 | App Check 強制ON | コンソール App Check を「適用しない(unenforced)」に。CSPは反映済(www.google.com許可) |

---

## 補足：データ初期化（任意・容量確保）

ルール反映の前後どちらでもOK。コンソール → Realtime Database → データ で
`rooms`（旧index会話・もう使わない）/ `chats` / `convos` / `s2s` などを削除すると容量が空きます（`admin` は残す）。
P06でindexは `chats/` に移行したので、**旧 `rooms/` ノードは不要**＝消して問題ありません。

---

### 反映が終わったら
実機で上の「P06 相互チャット」を確認 → 崩れたら担当（このセッション）に「相互チャットがXXX」と伝えれば即修正します。
