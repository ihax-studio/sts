# 管理者の複数デバイス共有受信(Firebaseルール反映)

## 目的

管理者「と」が **複数のデバイス(iPhone / iPad / Mac など)で同じ受信箱を共有** し、
どの端末で開いても利用者からの連絡(友達追加・会話)が全部見られるようにする。

通常の利用者は端末ごとに `uid` が変わると会話が分離してしまうが、
管理者だけは固定の共有アドレス `and_admin` を宛先にすることで、
「どの管理者デバイスでも同一の受信箱 `friends/and_admin` を読む」状態を作る。

このフェーズの肝は **クライアント側コードは既に実装済み** で、
残るは **Firebase Realtime Database のセキュリティルールを本番に反映する** こと。
ルールが古いままだと、2台目以降の管理者デバイスが `friends/and_admin` を **読めず**(権限エラー)、共有受信が機能しない。

---

## 現状(コード調査の結果・該当ファイル:行)

### A. 固定共有アドレスとアドレス解決(クライアント側・実装済み)

- `index.html:2695-2696`
  - `ADMIN_NAME="と"`, `ADMIN_AVA="img:/founder-icon.png"`, `ADMIN_COLOR="#1c1c1e"`
  - `var ADMIN_ID="and_admin";` ← 管理者の固定共有アドレス。コメント:「どの端末でも同じ宛先に届く（複数デバイス共有受信）」
- `index.html:2697`
  - `function myAddr(){ return (prof&&prof.admin)?ADMIN_ID:(uid||""); }`
  - 非管理者は従来どおり `uid`、**管理者だけ固定 `and_admin`** を自分のアドレスとして使う。
- `index.html:3372`
  - `function dmRoom(peer){ var a=[myAddr()||"me",peer].sort(); return "dm_"+a.join("_"); }`
  - 管理者は `and_admin` で部屋IDを作る → 全管理者デバイスで同一の `dm_…` 部屋になる。
- `index.html:3205`
  - `inviteLink()` も `myAddr()` を使うので、管理者の招待リンクは `#add=and_admin&…` になる。

### B. 受信監視(`watchFriends`・実装済み) — `index.html:3447-3464`

```js
function watchFriends(){ (authReady||Promise.resolve()).then(function(){ if(!db||!uid) return;
  var amAdmin=!!prof.admin;
  // 管理者は『共有受信箱 friends/and_admin』＋『旧 friends/<uid>』の両方を監視
  var bases = amAdmin ? [ADMIN_ID, uid] : [uid];
  function ingest(peer, info, owner){ … var room="dm_"+[owner,peer].sort().join("_"); …
    if(amAdmin && owner===ADMIN_ID){   // 共有受信箱: 連絡してきた利用者に「と」を書き戻す
      try{ db.ref("friends/"+peer+"/"+ADMIN_ID).update({ name:ADMIN_NAME, ava:ADMIN_AVA, color:ADMIN_COLOR, approved:true }); }catch(_){}
    }
    upsertRoom({room:room, peer:peer, …}); … }
  bases.forEach(function(base){ try{ var ref=db.ref("friends/"+base);
    ref.on("child_added",  function(s){ ingest(s.key, s.val(), base); });
    ref.on("child_changed",function(s){ ingest(s.key, s.val(), base); });
    ref.on("child_removed",function(s){ removeRoomByPeer(s.key); … });
  }catch(_){} });
}); }
```

- 管理者は `bases=[ADMIN_ID, uid]` の **2か所を `on()` で購読**:
  - `friends/and_admin` … 新しい共有受信箱(本フェーズの対象)
  - `friends/<uid>` … 旧来の自分宛て受信箱(過去の会話を復元するため残してある)
- `watchFriends()` の呼び出し元: `index.html:3995`
  `watchFriends(); watchGroups(); watchRoomsForNotif();`(自動purge廃止＝会話は勝手に消えない)

### C. 利用者→管理者への書き込み(双方向友達追加) — `index.html:3373-3378`

```js
function addByUid(peer,label){ if(!peer||peer===uid||peer===myAddr()) return; var room=dmRoom(peer); …
  var toAdmin=(peer===ADMIN_ID);
  try{ if(db&&uid) db.ref("friends/"+peer+"/"+uid).set({ name:…, ava:…, … }); }catch(_){}
  …
```

- 利用者が招待リンク(`#add=and_admin`)から追加すると、`friends/and_admin/<利用者uid>` に **利用者自身のエントリを書き込む**。
- これが管理者側 `friends/and_admin` の `child_added` を発火 → 全管理者デバイスに表示される。

### D. 管理者主張(claimAdmin) — `index.html:2681`, `3821-3834`, `3142`

- `window.GC_ADMIN_SECRET = "h2so4+naoh->na2so4+h2o";`(`index.html:2681`)
- `claimAdmin()`(`index.html:3822`)が `admin/secretTry`→`admin/secret`(初回のみ)→`admin/uid` の順で書き込み、サーバ側ルールで `secretTry===secret` を検証して `admin/uid` を **現デバイスの uid** に再設定する。
- これにより `root.child('admin/uid').val() === auth.uid` を満たすデバイス＝「現在アクティブな管理者端末」になる。

### E. Firebase ルール — `database.rules.json:22-39`

**反映対象のルール本体(リポジトリ上では追加済み)**:

```json
"friends": {
  "and_admin": {
    ".read": "auth != null",
    "$peer": {
      ".write": "auth != null && (auth.uid === $peer || root.child('admin/uid').val() === auth.uid)"
    }
  },
  "$uid": {
    ".read":  "auth != null && (auth.uid === $uid || root.child('admin/uid').val() === auth.uid)",
    ".write": "auth != null && (auth.uid === $uid || root.child('admin/uid').val() === auth.uid)",
    "$peer": {
      ".write": "auth != null && (auth.uid === $peer || root.child('admin/uid').val() === auth.uid)"
    }
  }
}
```

- **問題点(なぜこの追加が必要か)**: `friends/$uid` の `.read` は「自分(`auth.uid===$uid`)か **現** `admin/uid` のみ」。
  `admin/uid` は**1端末しか持てない**(claimで上書き)。よって **2台目の管理者デバイス**(uid が `admin/uid` と一致しない)は `friends/and_admin` を `$uid` ルール経由では **読めない**。
- **解決**: `friends/and_admin` を独立ブロックにし、`.read="auth != null"`(全認証ユーザ読み取り可)に。`$peer.write` は従来どおり(利用者は自分のエントリのみ、管理者は全エントリ書込可)。
- このルール変更は **git commit `47c744b`** で `database.rules.json` に追加済み:
  「Firebaseルール: friends/and_admin を全認証ユーザ読み取り可に（管理者の複数デバイス共有受信A）」
- Firebase プロジェクト: `.firebaserc` の `default = "ichat-pwa"`、`firebase.json` の `database.rules = "database.rules.json"`。

> **要確認**: `friends/and_admin` の `.read` が `auth != null`(=ログイン済の全利用者が読める)になっており、
> 利用者一覧(誰が管理者に連絡したか)が一般利用者にも読めてしまう。本フェーズの設計上の許容範囲かはプロダクト判断が必要(プライバシー観点)。コミットメッセージ上は意図的な仕様。

---

## 実装手順(具体的・順序立て)

> コード(A〜D)は実装済み。本フェーズの実作業は **(1)ルール反映 → (2)動作確認** の2つ。

### 手順1: ルールを本番 Firebase に反映する

`database.rules.json` の **全文** を本番に反映する。方法はどちらか一方でよい(どちらも丸ごと上書き)。

#### 方法A: Firebase コンソール貼り付け(CLI不要・最速)

1. <https://console.firebase.google.com/> で プロジェクト **`ichat-pwa`** を開く。
2. 左メニュー **Realtime Database → ルール(Rules)** タブ。
3. リポジトリの `/Users/s_users/Downloads/chat-app/database.rules.json` の **全文をコピーして貼り付け**(既存内容を全置換)。
4. **公開(Publish)** を押す。
   - 注意: コンソールのルールエディタは末尾の余計な改行やコメントを嫌う場合があるが、本ファイルは標準JSONなのでそのまま貼れる。
   - 引き継ぎメモ(`引き継ぎ.local.md:58`)の方針どおり「編集毎に要再公開」。

#### 方法B: firebase CLI(`firebase deploy --only database`)

```sh
cd /Users/s_users/Downloads/chat-app
firebase login                      # 初回のみ。tibita00815@gmail.com でログイン
firebase deploy --only database     # database.rules.json を ichat-pwa に丸ごと反映
```

- `firebase.json`(`{"database":{"rules":"database.rules.json"}}`)と `.firebaserc`(`default: ichat-pwa`)を参照するので、追加引数は不要。
- `firebase-tools` 未インストールなら `npm i -g firebase-tools`(または `npx firebase deploy --only database`)。
  - **要確認**: この環境は Darwin 27 で `brew` 不可(メモリ参照)。`npm`/`npx` が使えるかは未確認。使えない場合は **方法A(コンソール貼付)を採用**する。

### 手順2: 反映直後のサニティチェック

- コンソール Realtime Database → **ルール** タブで `friends/and_admin` ブロックが入っていること、公開日時が今であることを確認。
- コンソールの **ルールプレイグラウンド(Rules Playground)** で:
  - Location: `/friends/and_admin`、Type: `read`、Authenticated: ON(任意の uid) → **Allowed** になること。
  - Location: `/friends/and_admin/<適当なuid>`、Type: `write`、Authenticated: 同じ `<適当なuid>` → **Allowed**(自分のエントリ)。
  - Location: `/friends/and_admin/<別uid>`、Type: `write`、Authenticated: `admin/uid` 以外の一般 uid → **Denied**(他人のエントリは書けない)。

### 手順3: 実機での動作確認(下「検証方法」に詳細)

---

## 対象ファイル/関数

| 役割 | ファイル:行 | 関数/識別子 |
|---|---|---|
| 固定共有アドレス定義 | `index.html:2696` | `var ADMIN_ID="and_admin"` |
| アドレス解決 | `index.html:2697` | `myAddr()` |
| DM部屋ID生成 | `index.html:3372` | `dmRoom(peer)` |
| 受信監視(2拠点購読) | `index.html:3447-3464` | `watchFriends()` |
| 友達追加(利用者→管理者書込) | `index.html:3373-3378` | `addByUid(peer,label)` |
| 招待リンク生成 | `index.html:3205` | `inviteLink()` |
| 管理者主張 | `index.html:3822-3834` | `claimAdmin()` |
| 管理者secret | `index.html:2681` | `window.GC_ADMIN_SECRET` |
| 管理者一覧(users読み) | `index.html:3138-3147` | `openAdminList()` |
| セキュリティルール | `database.rules.json:22-39` | `friends/and_admin` ブロック |
| Firebase設定 | `firebase.json`, `.firebaserc` | プロジェクト `ichat-pwa` |

---

## 注意点・落とし穴

1. **ルール未反映 = 静かに失敗する**
   - `watchFriends()` の `ref.on(...)` は `try{}catch(_){}` で囲まれ(`index.html:3459-3463`)、`child_removed` も含めエラーをログに出さない。
   - 2台目管理者で `friends/and_admin` の `.read` が拒否されると、`on()` がエラーを返すだけで **UI上は単に「友達が増えない」** という症状になり、原因が分かりにくい。→ まずルール反映を疑う。
2. **`admin/uid` は1端末しか名乗れない**
   - 各管理者デバイスでアプリを開く/`openAdminList()` を開くたびに `claimAdmin()`(`index.html:3142`)が走り、`admin/uid` が **最後に開いた端末** に上書きされる。
   - `friends/and_admin` の **読み取りは** 新ルールで `admin/uid` に依存しないので問題ないが、`friends/$uid`(旧受信箱)の読み取りや `users` 一覧読み取りは依然 `admin/uid===auth.uid` 依存。複数端末で同時に管理画面を使うと claim を奪い合う可能性がある。**要確認**(本フェーズの範囲外だが関連リスク)。
3. **`friends/and_admin` が全認証ユーザに読める**(プライバシー)
   - 上記「現状E」の要確認事項。連絡してきた利用者の uid 一覧が一般利用者にも読めてしまう。意図的仕様(コミット47c744b)だが、必要なら `.read` を `admin/uid` 限定に絞る再設計を検討。
4. **既存の管理者プロフィールに `prof.admin` が立っているか**
   - `myAddr()` / `watchFriends()` は `prof.admin`(localStorage)で分岐する。新端末では管理者登録(`regNext(asAdmin=true)`・`index.html:3853`)または管理者パス入力で `prof.admin=true` になっている必要がある。`prof.admin` が無いと **その端末は普通の利用者扱い**で `and_admin` を監視しない。
5. **書き戻しループに注意**
   - `watchFriends()` の `ingest()` 内で `owner===ADMIN_ID` のとき `friends/<peer>/and_admin` に `update()` する(`index.html:3454-3455`)。これが相手側の `child_changed` を誘発するが、内容が同一なら実害は小さい。挙動変更時はループ増幅に注意。
6. **SW キャッシュ**
   - クライアント側コードは既にデプロイ済みのはずだが、もし `index.html` を変更した場合は `sw.js` の `VER` を上げないと旧版がキャッシュから出る(`引き継ぎ.local.md:57`)。本フェーズはルールのみなので通常は不要。

---

## 検証方法(headless/実機)

### A. ルール単体検証(コンソール・最速)

- 上記「手順2」のルールプレイグラウンドで read/write の Allowed/Denied を確認。これだけで反映成否は判定できる。

### B. 2台シミュレーション(実機・本命)

1. **利用者端末**(またはブラウザ): 管理者の招待リンク(`#add=and_admin&…`)を開く → 連携プロンプトで「繋がる」。
   - これで `friends/and_admin/<利用者uid>` に書き込まれる(`addByUid`)。
   - コンソール Realtime Database のデータタブで `friends/and_admin/<利用者uid>` が出現することを確認。
2. **管理者デバイス1**(`admin/uid` を現在持つ端末)で受信箱に利用者が出る → ここは旧来から動く。
3. **管理者デバイス2**(別の iPhone/iPad、`prof.admin=true` だが `admin/uid` ではない端末)でアプリを開く:
   - `watchFriends()` が `friends/and_admin` を購読し、**手順1で追加された利用者が友達一覧に出れば成功**。
   - ルール未反映だと **ここで出ない**(read拒否)→ フォールバック(下記)へ。
4. 双方向確認: デバイス2から該当利用者にメッセージ送信 → 利用者側に届き、デバイス1でも同じ部屋(`dm_and_admin_<uid>`)で見えること。

### C. headless での確認(任意)

- ルール反映自体はブラウザ不要(コンソール/CLIで完結)。
- DOM/監視ロジックの回帰確認をするなら、PWA を standalone で開く必要がある制約(`index.html:3851` アカウント作成は standalone 必須)があるため、`prof` を localStorage に直接注入したテストハーネスが必要。**本フェーズは主にルール反映なので headless 検証は必須ではない**。

### フォールバック(ルール未反映 / 反映できない場合)

- **コードは安全に縮退する**: `watchFriends()` は `bases=[ADMIN_ID, uid]` の **両方** を購読する(`index.html:3450`)。
  `friends/and_admin` の read が拒否されても、`friends/<uid>`(旧受信箱)の購読は **その端末が `admin/uid` を claim している間は** 従来どおり動く。
  → つまり **「現在アクティブな管理者端末1台」では引き続き受信できる**。失われるのは「2台目以降の同時共有受信」のみ。
- 暫定運用: ルールを反映できない間は、管理者は **1台の端末でのみ** 管理画面を使い(その端末が `admin/uid` を保持)、他端末では `openAdminList()`/管理操作をしない。
- `firebase CLI` が環境制約(Darwin27/brew不可)で動かない場合は **方法A(コンソール貼り付け)** を使う。これは外部ツール不要で確実。

---

## 優先度・工数・依存

- **優先度: 高**。コード(クライアント)は実装・コミット済みで、**ルール反映 1ステップが欠けているだけ** で機能が無効化されている。反映しないとリリース済みコードの意図どおりに動かない。
- **工数: S(小)**。本質はルール本番反映+動作確認のみ。コード変更不要。
  - ルール反映: 数分(コンソール貼付 or `firebase deploy --only database`)。
  - 検証: 2端末シミュレーションで15〜30分。
- **依存**:
  - `database.rules.json`(git `47c744b`)に `friends/and_admin` ブロックが入っていること(確認済み)。
  - Firebase プロジェクト `ichat-pwa` への管理者権限(コンソール or `firebase login`)。
  - 各管理者端末で `prof.admin=true`(管理者登録/パス入力済み)。
- **要確認事項(再掲)**:
  - `npm`/`npx`/`firebase-tools` がこの環境で使えるか(使えなければコンソール方式)。
  - `friends/and_admin` を全認証ユーザに読ませる設計のプライバシー妥当性。
  - 複数端末同時運用時の `admin/uid` claim 奪い合い(`friends/$uid`・`users` 読みに影響)。
