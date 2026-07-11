# meettomeet ↔ index のチャットトンネル統一(相互チャット)

## 目的

`meettomeet.html`(= `app.js`) と `index.html` は、見た目は同じ Shake-to-Shake チャットだが、
**Firebase 上では別々のデータツリー・別々の会話ID・別々のメッセージ構造**を使っており、
**両アプリ間で会話が通じない(相互にメッセージが見えない)**。

- `index.html` ユーザーが送ったメッセージは `rooms/dm_a_b/msgs` に入る。
- `meettomeet.html`(app.js) ユーザーは `chats/a__b/msgs` を見ている。
- たとえ同じ2人でも、書き込み先パスも会話IDも違うので**永久にすれ違う**。

このフェーズのゴールは「どちらのアプリから送っても、相手がどちらのアプリでも、
同じ1本の会話(トンネル)を読み書きできる」状態にすること。
ただし **E2E暗号化鍵が会話ID(cid/room)由来**であり、**Firebase ルールが両パスで全く別物**なので、
単純なパス変更では済まない。互換性・ルール・鍵整合の3点を揃えて設計する。

---

## 現状(コード調査の結果・該当ファイル:行)

> 重要な前提の訂正: メモリには「`meettomeet.html ≡ index.html`(byte一致)」とあるが**現状は不一致**。
> `index.html`(428KB) は**チャット実装を自前でインライン保持**(`app.js` を読み込んでいない: `grep -c 'src="app.js"' index.html` = 0)。
> `meettomeet.html`(16KB) は `app.js` を読み込んで委譲(`meettomeet.html:335` `<script src="app.js">`)。
> よって両者は**別実装の別アプリ**。本フェーズはこの2実装の会話層を統一する作業。

### A. 会話ID(DM room id)の違い

| | index.html(自前インライン) | app.js(meettomeet) |
|---|---|---|
| 関数 | `dmRoom(peer)` `index.html:3366` | `pairId(a,b)` `app.js:130` / `cidOf(t)` `app.js:28` |
| 形式 | `"dm_" + [myAddr(), peer].sort().join("_")` → `dm_a_b` | `a < b ? a+'__'+b : b+'__'+a` → `a__b`(**ダブルアンダースコア**) |
| 自分の識別子 | `myAddr()` = 管理者なら `"and_admin"`, それ以外は `uid` (`index.html:2691`) | 生の Firebase `uid` (`app.js:128,1939`) |
| グループ | `gid`(`rooms/<gid>`、`index.html:3251-3302`) | `gid`(`cidOf` が group 判定で `gid` を返す、`app.js:28` `isGroup` `app.js:27`) |

→ **同じ2人でも room ≠ cid**。`dm_uidA_uidB`(`dm_` 接頭・単一 `_` 連結) vs `uidA__uidB`(`__` 連結・接頭なし)。

### B. データツリー(パス)の違い

- index.html: `rooms/<room>/msgs`(送信 `index.html:3626` `sendMsg`, 購読 `index.html:3575` `openChat`)、`rooms/<room>/seen`(`3583`)、`rooms/<room>/typing`(`3587`)、`rooms/<room>/empty`(`3178`)、`rooms/<room>/msgs/<key>/r/<uid>`(リアクション `3032`)。
- app.js: `chats/<cid>/msgs`(送信 `app.js:801,809` `pushMessage`, 購読 `app.js:479,589`)、`chats/<cid>/last`(プレビュー、`app.js:207,809`)、`chats/<cid>/read/<uid>`(`app.js:592,770`)、`chats/<cid>/typing/<uid>`(`app.js:593,979`)、`chats/<cid>/empty`(`app.js:496,499`)。
- さらに app.js は**管理者の会話発見用に `convos/<cid>` をミラー**(`app.js:817-820` `pushMessage` 末尾、`adminMonitor` `app.js:471`)。index.html 側に `convos/` 相当は無い。

### C. メッセージ構造(フィールド)の違い

index.html(`sendMsg` `index.html:3623-3626`):
```js
var payload={ u:uid, name:prof.name||"匿名", ava:prof.ava||"🙂",
              color:prof.color||"#62d8ff", text:enc, t:ServerValue.TIMESTAMP };
if(q) payload.q={ n:q.n, t:q.t, c:q.c };  // 引用
// + リアクションは別ノード m.r[uid]=emoji (index.html:3030-3032)
```
- 送信者: `u`、本文: `text`、時刻: `t`、表示名/アバター/色を**メッセージ自体に同梱**。
- 読込: `renderMsg` `index.html:3576` が `m.u / m.text / m.t / m.q / m.r / m.name / m.ava` を参照。

app.js(`pushMessage` `app.js:803-805`):
```js
const node = { f: uid, t: encT, ts: TS() };
if (extra && extra.m != null) node.m = extra.m;   // 画像のTelegram message_id(平文)
```
- 送信者: `f`、本文: `t`(暗号文)、時刻: `ts`。名前/アバター/色は**メッセージに載せず** `users/<uid>` を別途参照(`fetchProfile` `app.js:202`)。
- 読込: `_ingestMsg` `app.js:733-744` が `raw.t`(string必須)、`raw.ts`、`raw.f` を参照。`raw.f===uid` で自分判定。

→ **フィールド名が総当りで非互換**: `u`↔`f`(送信者)、`text`↔`t`(本文)、`t`↔`ts`(時刻)。
特に **`t` の意味が逆**(index=時刻、app=本文)で、相手アプリでそのまま読むと壊れる。

### D. E2E暗号化(共通だが鍵が cid/room 由来)

両者とも**同一スキーム・同一 pepper**:
- 形式 `"e1:" + base64(iv12 ‖ AES-GCM-256暗号文)`(index.html:2710-2731 / app.js:137,153-172)。
- 鍵 = `PBKDF2(CHAT_PEPPER, salt = "mtm|" + cid, iterations=100000, SHA-256)` → AES-GCM-256。
- pepper は両方 `mtm-v1-7Qx2$Kp9!aZr4Lf8&Wd3^Nc6*Hb1@Vg5`(index.html:2717 のローカル定数 / `firebase-config.js:28` の `window.CHAT_PEPPER`、app.js:147 が後者を使用 → **値は一致**)。
- `encWith(cid,...)` / `decWith(cid,...)` も同じ I/F(index.html:2722,2728 / app.js:153,165)。

→ **鍵を分けているのは salt の cid だけ**。salt = `"mtm|"+cid`。
index は cid に `dm_a_b` を、app は `a__b` を入れる(送信時 `encWith(room,...)` `index.html:3625` / `encWith(cid,...)` `app.js:802`)。
**会話IDを統一しない限り、たとえ同じパスに置いても復号できない**(鍵が違う)。これが統一の核心制約。

### E. Firebase ルール(両パスで全く別物・ここが最大の壁)

`database.rules.json`:
- `rooms/$room`: **ほぼ無防備**。`".read"/".write" = "auth != null"` のみ(任意の認証ユーザーが任意の room を読み書き可、検証なし)。
- `chats/$cid`: **厳格**。
  - `.read` / `last`/`read`/`typing` の write = `$cid.contains(auth.uid) || groups/<cid>/m/<uid> || admin`。
  - `msgs/$mid` の `.write` は上記に加え「新規 or 自分(`data.f===uid`)の削除のみ」、`.validate` で `f===auth.uid && t.isString() && 1<=t.length<=8000 && ts.isNumber()`。
  - `empty` の write は admin のみ。
- `convos/$cid`: read=admin、write=`$cid.contains(uid) || group member || admin`。

→ 致命的ポイント: **`chats` ルールは `$cid.contains(auth.uid)` に依存**。
`pairId` の `a__b` は uid を生で含むので**この条件を満たす**。
一方 `dm_a_b`(index)は room 名に uid を含むが `rooms` 側は**そもそも contains 検証をしていない**。
つまり「`rooms` に寄せる = ルールが緩すぎ(なりすまし・他人会話の改ざんが可能)」「`chats` に寄せる = ルールが厳格で安全」。
**セキュリティ的には `chats` 側に寄せるのが正解**。ただし `chats.validate` が **`f`/`t`/`ts` 形式を強制**するので、index の `{u,text,t,...}` 構造はそのままでは**書き込み自体が拒否される**(検証違反)。

---

## 実装手順(具体的・順序立て・コード断片可)

### 設計判断: 「`chats/<cid>` + `app.js` 形式」に統一する(rooms を廃止方向へ)

理由:
1. **ルールが安全**(`$cid.contains(uid)` + `validate` でなりすまし/改ざんを防止)。`rooms` は無防備で本番にできない。
2. app.js 側は既に `convos` ミラー・`last` プレビュー・empty mode・read/typing が `chats` ツリー前提で整備済み。
3. cid = `pairId` は uid を生で含むためルール条件を自然に満たす。`dm_` 形式はルール強化時に作り直しが必要。

→ **index.html の自前チャット層を、app.js と同じ `chats/<cid>` 規格に合わせて書き換える**のが本筋。
2アプリのチャットコードを二重保守しないため、**理想は index.html も `app.js` を読み込んで委譲**(下記 Plan B)。
ただし index.html は巨大な独自 UI(`gc*` DOM・3D地球儀等)を抱えるので、まず **Plan A(index 側を chats 規格へ最小改修)** を推奨し、将来 Plan B(完全委譲)へ寄せる。

---

### Plan A: index.html の自前チャット層を `chats/<cid>` 規格へ合わせる(推奨・段階的)

#### A-1. 会話IDを統一(`dmRoom` → `pairId` 相当)

`index.html:3366` の `dmRoom` を、app.js の `pairId` と**完全一致**させる:
```js
// 旧: return "dm_"+[myAddr()||"me",peer].sort().join("_");
function dmRoom(peer){ var a=myAddr()||uid, b=peer; return a<b ? a+"__"+b : b+"__"+a; } // = pairId(a,b)
```
- 注意: **`myAddr()` は管理者で `and_admin` を返す**(`index.html:2691`)。app.js は生 uid。
  管理者会話を統一するなら「管理者の cid を何にするか」を app.js と揃える要がある(下記 落とし穴)。**要確認**: app.js 側に `and_admin` 相当の固定アドレス概念があるか(grepでは app.js は生uidのみ。管理者DM の cid 取り扱いは別途設計)。
- グループは `rooms/<gid>` → `chats/<gid>` へ移行(`isGroup`/`cidOf` 準拠)。`groups/<gid>/m/<uid>` メンバ表が `chats` ルールの前提なので、index のグループ作成(`index.html:3302` `rooms/<gid>/meta`)を `groups/<gid>/m/...` + `userGroups` 書き込みに作り替える(app.js のグループ規格に合わせる)。**要確認**: app.js のグループ作成/参加コードの正確な書き込み形(本調査では未読、`groups/$gid/m/$uid` ルール前提のみ確認)。

#### A-2. 送信パス/フィールドを `chats` 規格へ

`sendMsg` `index.html:3618-3628` を書き換え:
```js
var cid=chatRoom;                       // = pairId 形式
encWith(cid, t).then(function(enc){
  var id=db.ref("chats/"+cid+"/msgs").push().key;
  var node={ f:uid, t:enc, ts:firebase.database.ServerValue.TIMESTAMP };
  // 引用・名前・ava・色は app.js 規格に載せない(本文 t 内マーカ or users/ 参照へ)
  var ups={}; ups["msgs/"+id]=node;
  // last プレビュー(app.js と互換):
  encWith(cid, t.slice(0,60)).then(function(encLast){
    ups["last"]={ f:uid, t:encLast, ts:firebase.database.ServerValue.TIMESTAMP };
    db.ref("chats/"+cid).update(ups);
    // convos ミラー(管理者発見用・a/b は平文 uid):
    var lo=uid<peer?uid:peer, hi=uid<peer?peer:uid;
    encWith(cid, t.slice(0,40)).then(function(encCv){
      db.ref("convos/"+cid).update({ a:lo, b:hi, t:encCv, ts:firebase.database.ServerValue.TIMESTAMP });
    });
  });
});
```
- **`validate` 制約**: `node` は `f`(=自分uid)・`t`(string,1〜8000)・`ts`(number) **のみ**。`u/name/ava/color/q` を直接足すと**書き込みが validate で拒否される可能性**(現ルールは `f/t/ts` 以外の子ノードを明示禁止していないが、`f===auth.uid` と各型を必須化済み。`u` を別キーで足すこと自体は通るが、app.js 側は読まないので無意味)。**名前・アバターは `users/<uid>` 参照に寄せる**(app.js 規格 `fetchProfile` `app.js:202`)。引用/スタイルは app.js が採用する**本文プレフィックス方式**(`cxq:` `app.js:618` / `cxsty:` `app.js:626` / `cxhap:` `app.js:637`)に合わせる。

#### A-3. 受信(購読)を `chats` 規格へ

`openChat` `index.html:3575` の購読を差し替え:
```js
chatRef=db.ref("chats/"+cid+"/msgs").orderByChild("ts").limitToLast(120);
chatRef.on("child_added",function(s){ var raw=s.val()||{}; if(typeof raw.t!=="string")return;
  decWith(cid, raw.t).then(function(plain){
    var m={ _key:s.key, _room:cid, u:raw.f, text:plain, t:Number(raw.ts)||Date.now() };
    // renderMsg が参照する u/text/t に詰め替え。名前/avaは users/<raw.f> から補完。
    renderMsg(m, cid); /* ... */ });
});
```
- `seen/typing` も `rooms/.../seen` → `chats/<cid>/read/<uid>` + `chats/<cid>/typing/<uid>` へ(app.js `app.js:592-593,770,979` と同パス・同形式)。
  - index の seen は `rooms/<room>/seen/<uid> = timestamp`(`index.html:3520,3583`)、app は `chats/<cid>/read/<uid> = ts`(`app.js:592,770`)→ **意味は同じ(最終閲覧ts)なのでキー名だけ `read` に寄せれば互換**。
- リアクション(`m.r`、`index.html:3030`): app.js 側に `r` ノード読取は無い → **app では表示されない**(片側機能)。`chats.msgs.$mid` の `.write` は「新規 or 自分の削除」のみ許可なので、**他人メッセージへのリアクション追記(`.../r/<uid>`)はルールで拒否される可能性大**。リアクションは当面 index 内部限定 or ルール拡張が必要(落とし穴参照)。

#### A-4. empty mode / 24h purge の整合

- index の `purgeRoomOld` `index.html:3173`(`rooms/<room>/msgs` を `t` で endAt 削除) は **`chats/<cid>/msgs` を `ts` で**削除に変更。
- empty フラグ: index は `rooms/<room>/empty`、app は `chats/<cid>/empty`(write=admin限定)+ `convos/<cid>/empty`。**`chats.empty` は admin しか書けない**ので、index の一般ユーザー empty トグル(`toggleRoomEmpty` `index.html:3177` は `prof.admin` ガード済 = OK)はそのまま admin 限定で `chats/<cid>/empty` + `convos/<cid>/empty` を更新する形に。

---

### Plan B: index.html も `app.js` に完全委譲(最終形・別フェーズ推奨)

`meettomeet.html` と同様に index.html から自前 `gc*` チャットを撤去し、`<script src="app.js">` を読み込んで app.js の `pushMessage`/`ingestMsg`/UI を使う。
- 利点: **二重実装が消える**(統一が構造的に保証される)。
- 障壁: index.html の UI(3D地球儀・gc DOM・helloグリーティング等)と app.js の DOM(`#msgs`/`#scrChat`)が別物。app.js は IIFE 内で `window` 非公開関数が多く、HTML の id 契約(`#msgs`,`#scrChat`,`#chName`...)に強く依存。index 側に app.js が期待する DOM 骨格を用意するか、app.js を関数公開して呼ぶ改修が要る。**規模大 → 本フェーズでは Plan A、Plan B は後続フェーズ**。

---

### ブリッジ案(移行期の互換・任意)

両アプリを同時に本番運用しつつ会話を通すなら、**サーバ側(Cloudflare Worker `worker/`)で双方向ミラー**:
- `rooms/dm_a_b/msgs` に来た `{u,text,t}` を `chats/a__b/msgs` の `{f,t,ts}` へ**再暗号化して**転記(逆も)。
- ただし**暗号文の salt が cid 依存**なので、Worker が **平文化(復号)→相手 cid の鍵で再暗号化**する必要があり、**Worker に pepper を持たせる = E2E が崩れる**。
- → ブリッジは「E2E を諦める」前提でしか成立しない。**非推奨**。統一(Plan A)で会話IDと鍵を1本化するのが正道。

---

## 対象ファイル/関数

| ファイル | 関数/箇所 | 変更内容 |
|---|---|---|
| `index.html` | `dmRoom` `:3366` | `pairId`(`a__b`)へ統一。`myAddr()` の `and_admin` 扱いを app と合わせる(要確認) |
| `index.html` | `sendMsg` `:3618-3628` | 送信先 `rooms/`→`chats/<cid>`、フィールド `{u,text,t}`→`{f,t,ts}`、`last`+`convos` ミラー追加 |
| `index.html` | `openChat`/`renderMsg` `:3562-3600` | 購読 `chats/<cid>/msgs` orderByChild `ts`、`raw.f/raw.t/raw.ts` を `u/text/t` に詰替え |
| `index.html` | `seenRef`/`typeRef` `:3583,3587` | `rooms/.../seen|typing` → `chats/<cid>/read|typing/<uid>` |
| `index.html` | `reactMsg`/`retractMsg` `:3030-3034` | パスを `chats/<cid>/msgs/...`。リアクション `r/<uid>` はルール要拡張(落とし穴) |
| `index.html` | `purgeRoomOld` `:3173` / `toggleRoomEmpty` `:3177` | `chats/<cid>` + `ts` 基準、empty は admin 限定で `chats.empty`+`convos.empty` |
| `index.html` | グループ作成 `:3302` ほか | `rooms/<gid>/meta` → `groups/<gid>/m/...` + `userGroups`(app.js グループ規格・要確認) |
| `app.js` | (基本変更なし) | 規格の正準。index 側を合わせる。管理者DM cid の扱いだけ要確認 |
| `database.rules.json` | `rooms` ブロック | 統一完了後に**読み取り専用 or 削除**(移行期は残置)。リアクション許可するなら `chats.msgs.$mid` の write/validate 拡張 |

---

## 注意点・落とし穴

1. **`t` の意味が逆**: index の `t`=時刻、app の `t`=本文。詰め替えを誤ると本文が時刻になり全件壊れる。`raw.f/raw.t/raw.ts` を必ず明示マッピング。
2. **鍵 salt = cid**: 会話IDを `a__b` に統一しない限り、同じパスに置いても**復号不能**(`mtm|dm_a_b` ≠ `mtm|a__b`)。**IDの統一が暗号互換の前提**。
3. **`chats` の `.validate`**: `f===auth.uid && t.isString() && 1<=len<=8000 && ts.isNumber()`。index の `{u,name,ava,color,text,q}` をそのまま書くと、本文を `t` に入れ忘れる/`f` を欠くと**書込拒否**。名前・ava・色は `users/<uid>` 参照へ寄せる(本文に載せない設計が app.js の正準)。
4. **リアクション/引用の非互換**: app.js はメッセージ `r` ノードを読まず、引用は本文プレフィックス `cxq:`。さらに **`chats.msgs.$mid` の write は「新規 or 自分の削除」のみ**で、**他人メッセージへの `r/<uid>` 追記はルール上拒否**される。リアクションを残すなら `database.rules.json` の `chats/$cid/msgs/$mid` に `r/$u` のサブルール(`auth.uid===$u`)追加が必要。**要ルール改修**。
5. **管理者(`and_admin`)の扱い**: index は `myAddr()` が管理者で `and_admin` を返し `dm_and_admin_<peer>` で共有受信箱を作る(`index.html:3366,3444-3449` `friends/and_admin`)。app.js は生 uid 前提。cid を `pairId` 化すると**管理者会話の宛先が変わり、既存の `and_admin` 共有受信が壊れる**。管理者DMの cid 規格(`and_admin` を uid 位置に入れるのか)を app.js と擦り合わせる。**要確認**: app.js 側に管理者固定アドレスの会話導出があるか(本調査では未発見=生uidのみ)。
6. **`rooms` ルールが無防備**: 移行完了まで `rooms` を残すと、なりすまし書込の余地が残る。完了後すみやかに read-only/削除。
7. **既存メッセージの移行**: 過去の `rooms/dm_a_b/msgs` は cid も salt も違うため**自動では `chats` で読めない**。移行スクリプト(復号→再暗号→`chats` へ)を回すか、過去ログは切り捨てる判断が要る。empty mode 運用なら自然消滅を待つ手も。
8. **グループルール前提**: `chats`/`convos` のグループ条件は `groups/<cid>/m/<uid>` の存在に依存。index のグループを `chats/<gid>` に載せるには、先に `groups/<gid>/m/...` メンバ表と `userGroups` を app.js 規格で用意しないと**読み書き全拒否**。
9. **デプロイ整合**: `database.rules.json` 変更は Firebase Console / `firebase deploy --only database` 反映が必要(ルールは push だけでは効かない)。`build-index.mjs` は現状「危険」(メモリ参照)なので**回さない**。index.html は直接編集。

---

## 検証方法(headless/実機)

ローカル(`python3 -m http.server 8765` を chat-app で起動 → puppeteer/chromium、メモリの描画デバッグ環境):

1. **cid 一致テスト(単体・headless可)**: `dmRoom(b)`(index) と `pairId(uid,b)`(app) が**同一文字列**を返すことを2環境で確認(`a__b`)。
2. **暗号往復(headless可)**: 同一 cid で `encWith(cid, "テスト")` → `decWith(cid, ...)` が index/app 双方で平文一致すること。`mtm|`+cid salt が一致するか(pepper 一致は確認済)。
3. **クロス書込(2タブ headless)**: 同一 Firebase で、タブ1=index・タブ2=meettomeet(app.js)。`cx_me` 注入でゲート回避、`#suspendedOv` を `.remove()`(メモリの headless 手順)。タブ1から送信 → タブ2の `#msgs` に**復号された同一本文**が出ることを DOM で確認。逆方向も。
4. **ルール検証**: Firebase Emulator か実プロジェクトで、`chats/a__b/msgs/<id>` に `{f:他人uid,...}` を書こうとして**validate 拒否**(`f===auth.uid` 違反)になること、自分宛 cid 以外(`$cid.contains(uid)` 不成立)で**read 拒否**になることを確認。
5. **リアクション**: ルール拡張前は他人メッセージへの `r/<uid>` 書込が**PERMISSION_DENIED**になることを確認(=拡張が必要な根拠)。
6. **実機(要端末)**: iOS PWA 2台(index 端末 / meettomeet 端末)で相互送受信・既読 👀・タイピング・通知バナー(app.js `showAppBanner`)・empty mode 消滅。**実Firebase認証・iOS固有(safe-area/haptic/通知音 autoplay)は headless 不可 → 実機必須**。「直した」と言い切らず端末確認を促す。

---

## 優先度・工数・依存

- **優先度: 中〜高**。「相互チャット」はアプリの中核価値(2アプリが分断していると会話が成立しない)。ただし現状 index/meettomeet を別ユーザー層に出していないなら緊急度は運用次第。
- **工数: XL**(設計重め・データ層全面整合)。
  - Plan A(index を chats 規格へ最小改修): L〜XL(cid統一・送受信フィールド詰替・seen/typing・empty・グループ・ルール拡張・移行判断)。
  - Plan B(完全委譲): XL+(別フェーズ)。
- **依存**:
  - `database.rules.json` の改修(リアクション許可・移行期の `rooms` 残置/削除)→ **Firebase Console / `firebase deploy --only database` 反映が前提**。
  - app.js のグループ作成/参加・管理者DM cid 規格の**正確な読込(本フェーズ未読部分=「要確認」)**。
  - 既存 `rooms/` メッセージの移行可否判断(復号→再暗号スクリプト or 切り捨て)。
  - メモリ既知の制約: `build-index.mjs` は回さない / 配信物 `shaketoshake.css` と `index-extras.css` 両方に CSS 追記 / JS は `app.js` 直接編集。
