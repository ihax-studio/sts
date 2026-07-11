# emptyのサーバ側実削除＋サーバ定期バックアップ

## 目的

管理者が会話ごとに立てる `rooms/<room>/empty` フラグを「フラグだけ」で終わらせず、**サーバ側（Cloudflare Worker cron）で実際に古いメッセージを削除**する。あわせて、削除事故・DB流出に備えて **Firebase RTDB を定期的に JSON エクスポート（サーバ側バックアップ）** し、現状クライアント端末ローカルにしか無いバックアップ（`localStorage` の `gc_cbk`）への依存をなくす。

ねらいは2点:
1. 管理者が `💨`(empty) を ON にした会話の、一定時間（12〜20h）より古いメッセージを**確実に・端末非依存で**消す。
2. その削除や運用ミスで会話が消えても**サーバ側のスナップショットから復旧**できる状態にする（＝「再発防止」の本丸をクライアントからサーバへ移す）。

---

## 現状（コード調査の結果・該当ファイル:行）

### A. index.html（= 現行 Meet to Meet / globe-chat。`gc-` UI。データモデルは `rooms/<room>`）

- `EMPTY_TTL=24*3600*1000`（24時間）— `index.html:3176`
- `purgeRoomOld(room)` — `index.html:3177-3178`
  - `rooms/<room>/msgs` を `orderByChild("t").endAt(cutoff)` で読み、古いものを `c.ref.remove()`。
  - **ただしクライアントからは自動では呼ばれない**（コメント `index.html:3179-3180` に「管理者が明示操作した時のみ手動で呼べる」）。
- `toggleRoomEmpty(r)` — `index.html:3181-3185`
  - admin のみ。`r.empty` をトグルし `db.ref("rooms/"+r.room+"/empty").set(!!r.empty)` を書くだけ。
  - Dynamic Island メッセージに「会話は今は消えません」と明記＝**フラグのみで実削除なし**。
- empty ボタンUI — `index.html:3240-3241`（`fr-empty` ボタン、`💨`、title「empty ON（24時間より古い会話を消す）」）
- メッセージ送信 payload に `t:firebase.database.ServerValue.TIMESTAMP`（epoch ms）— `index.html:3631`。画像も同様 `index.html:3715`。**`t` は数値の epoch ms なので cutoff 比較に使える。**
- ローカルバックアップ（再発防止の現行実装）:
  - `backupChats()` — `index.html:3420-3427`。`prof.rooms` 各部屋の `msgs` を `limitToLast(200)` で読み、画像を除いたテキストを `localStorage["gc_cbk"]`（`{t, rooms:{room:[{u,name,text,t,q}...]}}`）に保存。**端末ローカルのみ。**
  - `restoreChatsFromBackup(silent)` — `index.html:3428-3435`。各 room の `msgs` が空（`numChildren()===0`）のときだけ `gc_cbk` から `push` で復元（重複防止）。
  - 起動時の自動配線 — `index.html:3994`：
    `restoreChatsFromBackup(true); setTimeout(backupChats, 8000); setInterval(backupChats, 300000);`（5分毎スナップショット＋空部屋の自動復元）。

### B. app.js（= 別系統の旧チャット UI。データモデルは `convos` + `chats/<cid>`）

- `chats/<cid>/empty` と `convos/<cid>/empty` を両方トグル — `app.js:496,499,510`
- このモデルが既存 cron 削除エンジンの対象（下記 C）。**index.html の `rooms/` とは別物。**

### C. worker/telegram-storage.js（= 既存の cron 削除エンジン。ただし対象は app.js の `convos`/`chats` モデルのみ）

- `scheduled()` → `purgeExpired(env)` — `worker/telegram-storage.js:30, 122-166`
- `EMPTY_MIN` の既定は **600分（10時間）** — `:126`（コメントは「50分」だが実装の既定値は600）。
- 動作: `convos.json` を1回読み、`empty:true` かつ `now-ts > ttl` の `cid` だけ、Telegram実体(deleteMessage)→`chats/<cid>/msgs|last|read`・`convos/<cid>/t` を REST DELETE。`empty`/`friends`/`convos`本体は残す。
- **重大: この cron は `convos`/`chats/<cid>` しか見ない。index.html が使う `rooms/<room>/empty` は対象外＝今 index.html の empty は実削除されていない。**

### D. RTDB ルール（database.rules.json）

- `chats/$cid/msgs` に `.indexOn:["ts"]` あり — `:95`。`chats/$cid/empty` は admin のみ書込 — `:104-106`。
- `rooms/$room` は `.read/.write` ともに `auth != null` で**誰でも書ける**・**`empty` の admin 限定保護も `.indexOn` も無い** — `:55-60`。
  - → `rooms/<room>/empty` はクライアント側で admin チェックしているだけ（ルールでは保護されていない＝要確認の改善余地）。
  - → `rooms/<room>/msgs` に `t` の index が無いので、`purgeRoomOld` の `orderByChild("t")` はクライアントで index 警告になる可能性（**要確認**。Worker は REST で全件取得して自前フィルタにすれば index 不要）。

### E. Worker 設定・接続情報

- `worker/wrangler.toml`（既存 `shake-toshake` Worker、`telegram-storage.js`）— cron `["0 * * * *"]`（毎時）、secret: `FB_URL`, `FB_SECRET`, `EMPTY_MIN`, `TG_TOKEN`, `TG_CHAT`。
- `worker/wrangler-s2s.toml`（別 Worker `s2s-push`、`s2s-push.js`）— cron `["*/15 * * * *"]`。push 通知用。`FIREBASE_DB_URL` / `FIREBASE_SECRET` の REST 読みパターンあり（`s2s-push.js:43-46` `fbGet`）。
- RTDB URL: `https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app`（`firebase-config.js:5`）。projectId `ichat-pwa`（`.firebaserc`）。
- `firebase.json` は database ルールのデプロイのみ定義（`firebase deploy --only database`）。

---

## 実装手順（具体的・順序立て）

方針: **既存 `telegram-storage.js` の cron に、`rooms/` モデル用の purge を追加する**（新 Worker を増やさず、既存 `shake-toshake` Worker / `wrangler.toml` を拡張）。バックアップは同 cron 内で RTDB を JSON エクスポートして外部ストレージ（R2 もしくは Telegram）へ保存する。

### 手順0: TTL を決める（12〜20h）

- 既存 `EMPTY_MIN`（app.js 系）は触らず、**`rooms/` 用に別の env を追加**して干渉を避ける。
- 新 env: `ROOMS_EMPTY_MIN`（既定 `720`＝12h。20h なら `1200`）。
- index.html 側の表示「24時間より古い会話を消す」（`index.html:3240` の title、`EMPTY_TTL`）とサーバ TTL が**食い違う**点に注意。サーバを 12〜20h にするなら、index.html の `EMPTY_TTL` と title 文言も合わせる（任意・要判断）。

### 手順1: `purgeExpiredRooms()` を telegram-storage.js に追加

`scheduled()` を両モデル対応にする（`worker/telegram-storage.js:30`）:

```js
async scheduled(event, env, ctx) {
  ctx.waitUntil(Promise.all([
    purgeExpired(env),        // 既存: convos / chats/<cid>（app.js 系）
    purgeExpiredRooms(env),   // 追加: rooms/<room>（index.html 系）
    backupRtdb(env),          // 追加: 定期 JSON エクスポート（手順3）
  ]));
},
```

`rooms/` には `convos` のような軽量索引が無いため、**`rooms` のキー一覧を shallow で取得 → 各 room の `empty` だけ薄く読む** ことで使用量を抑える:

```js
// rooms/<room>/empty が true で、最新メッセージが ttl より古い room の msgs を削除する。
// friends/users/profile は触らない（会話本文＝msgsのみ）。
async function purgeExpiredRooms(env) {
  const FB = (env.FB_URL || '').replace(/\/+$/, '');
  if (!FB || !env.FB_SECRET) return;
  const A = '?auth=' + encodeURIComponent(env.FB_SECRET);
  const ttl = (parseInt(env.ROOMS_EMPTY_MIN, 10) || 720) * 60 * 1000; // 既定12h
  const nowMs = Date.now();

  // 1) room キー一覧だけ取得（shallow=値を取らずキーだけ＝軽量）
  let keys;
  try { keys = await (await fetch(FB + '/rooms.json?shallow=true&auth=' + encodeURIComponent(env.FB_SECRET))).json(); }
  catch (e) { return; }
  if (!keys || typeof keys !== 'object') return;

  for (const room of Object.keys(keys)) {
    // 2) empty フラグだけ薄く読む（false/未設定は即スキップ＝書込0）
    let empty;
    try { empty = await (await fetch(FB + '/rooms/' + room + '/empty.json' + A)).json(); }
    catch (e) { continue; }
    if (empty !== true) continue;

    // 3) 最新メッセージの t を1件だけ読む（limitToLast=1 を REST で）
    let lastMsg;
    try {
      lastMsg = await (await fetch(FB + '/rooms/' + room + '/msgs.json?orderBy=%22t%22&limitToLast=1&auth=' + encodeURIComponent(env.FB_SECRET))).json();
    } catch (e) { continue; }
    if (!lastMsg || typeof lastMsg !== 'object') continue; // 既に空ならスキップ
    const newest = Math.max(...Object.values(lastMsg).map(m => Number(m && m.t) || 0));
    if (!newest || nowMs - newest <= ttl) continue;        // まだ新しい会話は残す

    // 4) ttl より古いメッセージだけ削除（cutoff = now - ttl）。新しい分は必ず残す。
    const cutoff = nowMs - ttl;
    let msgs;
    try {
      msgs = await (await fetch(FB + '/rooms/' + room + '/msgs.json?orderBy=%22t%22&endAt=' + cutoff + '&auth=' + encodeURIComponent(env.FB_SECRET))).json();
    } catch (e) { continue; }
    if (!msgs || typeof msgs !== 'object') continue;

    // (任意) 画像メッセージの Telegram 実体も消すなら msgs[k].m を deleteMessage（purgeExpired と同形）。
    //   ただし index.html の rooms/<room>/msgs の画像は img:dataURL 直埋め（index.html:3715）で
    //   Telegram message_id を持たない可能性が高い → deleteMessage は不要/空振り。要確認。

    // Firebase 本文を multi-path DELETE（PATCH で各キーを null）
    const patch = {};
    for (const k of Object.keys(msgs)) patch[k] = null;
    try {
      await fetch(FB + '/rooms/' + room + '/msgs.json' + A, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
    } catch (e) {}
    // empty フラグは残す＝次の新着からまた ttl カウント（purgeExpired と同じ方針）。
  }
}
```

ポイント:
- `orderBy="t"` を REST で使うには **RTDB ルールに `rooms/$room/msgs` の `.indexOn:["t"]` が必要**（無いと REST はソートできずエラー or 全件）。手順2 で追加。
- `endAt(cutoff)` で「古いものだけ」消し、`limitToLast=1` の `newest` で会話全体の生死を判定（churn 防止）。
- 友達情報・アカウント・`empty` フラグ・`seen`/`typing` は消さない（`msgs` のみ）。

### 手順2: RTDB ルールに `rooms/$room/msgs` の index を追加（database.rules.json）

`:55-60` の `rooms` ブロックを:

```json
"rooms": {
  "$room": {
    ".read": "auth != null",
    ".write": "auth != null",
    "msgs": { ".indexOn": ["t"] },
    "empty": {
      ".write": "auth != null && root.child('admin/uid').val() === auth.uid"
    }
  }
}
```

- `msgs/.indexOn:["t"]` … Worker の `orderBy="t"` と index.html の `purgeRoomOld` の `orderByChild("t")` 警告解消。
- `empty/.write` を admin 限定に … 現状 `rooms` は誰でも書けるため、empty 偽装を防ぐ（`chats/$cid/empty` と同じ保護に揃える。任意だが推奨）。
- デプロイ: `firebase deploy --only database`（`firebase.json` 経由）。

### 手順3: サーバ定期バックアップ（RTDB JSON エクスポート）

同 cron 内 `backupRtdb(env)` で会話本文を外部へスナップショット。保存先は **Cloudflare R2（推奨・カード不要枠あり）** か **既存 Telegram チャンネル**（`telegram-storage.js` が既に `TG_TOKEN/TG_CHAT` を持つ）。

R2 版（`wrangler.toml` に R2 バインド `BACKUP` を追加）:

```js
// rooms 配下を丸ごと（または msgs だけ）JSON 化して R2 に日付キーで保存。
async function backupRtdb(env) {
  const FB = (env.FB_URL || '').replace(/\/+$/, '');
  if (!FB || !env.FB_SECRET || !env.BACKUP) return;       // BACKUP = R2 バケットの binding
  const A = '?auth=' + encodeURIComponent(env.FB_SECRET);
  let data;
  try { data = await (await fetch(FB + '/rooms.json' + A)).json(); } catch (e) { return; }
  if (!data) return;
  const key = 'rtdb/rooms-' + new Date().toISOString().slice(0, 13) + '.json'; // 1時間粒度
  try { await env.BACKUP.put(key, JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } }); } catch (e) {}
}
```

Telegram 版（R2 を使わない場合）: 上の `data` を `Blob` 化して `sendDocument`（`telegram-storage.js:67-75` と同形）でチャンネルへ。

頻度の考え方:
- 全 `rooms` ダンプは重くなり得るので、cron 毎時のうち **1日数回**（例: 時刻が 0/6/12/18 時のときだけ）に間引く。`backupRtdb` 冒頭で `if (new Date().getUTCHours() % 6 !== 0) return;` 等。**要確認: rooms 全体サイズ**（画像が dataURL で `msgs` に入っていると巨大化。バックアップ対象から `img` を除外する整形を入れるのが安全）。

### 手順4: wrangler.toml に env / R2 を追記（worker/wrangler.toml）

```toml
# 追加 secret（コメントに追記。値は wrangler secret put で投入）
#   npx wrangler secret put ROOMS_EMPTY_MIN   # 720(=12h) 〜 1200(=20h)
# R2 を使う場合（バックアップ保存先）:
[[r2_buckets]]
binding = "BACKUP"
bucket_name = "mtm-rtdb-backup"
```

- cron は既存 `["0 * * * *"]`（毎時）のままで 12〜20h TTL に対し十分。
- secret 投入は `worker/` で `npx wrangler deploy`（`wrangler.toml` 既定）後に `npx wrangler secret put ROOMS_EMPTY_MIN`。
- `FB_URL`/`FB_SECRET` は既存 empty 用と共用（`wrangler.toml:18-24` に既出）。

### 手順5（任意・整合）: index.html の TTL と文言をサーバに合わせる

- `EMPTY_TTL`（`index.html:3176`）と empty ボタン title（`index.html:3240`）を 12〜20h に統一。
- index.html の `setInterval(backupChats, ...)` ローカルバックアップ（`index.html:3994`）はサーババックアップ完成後も**残してよい**（端末側の保険）。ただし「再発防止の本丸はサーバ」へ役割が移る。

---

## 対象ファイル/関数

| ファイル | 箇所 | 変更内容 |
|---|---|---|
| `worker/telegram-storage.js` | `scheduled()` `:30` | `purgeExpiredRooms` / `backupRtdb` を `waitUntil` に追加 |
| `worker/telegram-storage.js` | 末尾（`purgeExpired` の後） | `purgeExpiredRooms(env)` を新規追加（手順1） |
| `worker/telegram-storage.js` | 末尾 | `backupRtdb(env)` を新規追加（手順3） |
| `database.rules.json` | `rooms` `:55-60` | `msgs/.indexOn:["t"]`、`empty/.write` を admin 限定（手順2） |
| `worker/wrangler.toml` | `:17-25` 付近 | `ROOMS_EMPTY_MIN` secret コメント、`[[r2_buckets]]`（手順4） |
| `index.html` | `EMPTY_TTL` `:3176` / title `:3240`（任意） | サーバ TTL と文言整合（手順5） |

関連（変更不要・参照のみ）: `index.html` の `toggleRoomEmpty`(`:3181`) `purgeRoomOld`(`:3177`) `backupChats`(`:3420`) `restoreChatsFromBackup`(`:3428`)、`firebase-config.js`、`.firebaserc`、`firebase.json`。

---

## 注意点・落とし穴

1. **データモデルが2系統ある（最重要）**: 既存 cron `purgeExpired` は `convos`/`chats/<cid>`（app.js 系）専用で、**index.html の `rooms/<room>/empty` には一切効いていない**。本フェーズの本体は「`rooms/` 用 purge の新規追加」。既存 `purgeExpired` を流用・改名しないこと（別モデルを壊す）。
2. **`rooms` に索引が無い**: `convos` のような管理者索引が無いので、shallow でキー一覧 → 各 room の `empty` 薄読み、で使用量を抑える設計が必須。全 `rooms.json` を毎分丸読みしない。
3. **`orderBy="t"` には `.indexOn:["t"]` が必要**（手順2）。無いと REST のソート/`endAt` が失敗するか全件取得になり高コスト。index.html の `purgeRoomOld` も同じ index に依存（**現状 index が無く警告の可能性＝要確認**）。
4. **`rooms` の write が無認証で開いている**（`database.rules.json:55-60`）。`empty` の admin 限定化（手順2）をしないと、empty フラグを他者が偽装してメッセージを消させられる。**要対応 or 要判断**。
5. **画像の実体**: index.html の `rooms/<room>/msgs` 画像は `img:dataURL` 直埋め（`index.html:3715`）で Telegram message_id (`m`) を持たない見込み → `deleteMessage` は不要/空振り。**app.js 系（`chats`）は `m`=message_id を持つ**ので、両者を混同して deleteMessage を投げないこと。**要確認: rooms 側に Telegram 中継経由の画像があるか。**
6. **バックアップ肥大化**: `rooms` 全体に dataURL 画像が入ると JSON が巨大化。バックアップは `img` を除外整形するか `msgs` のテキストのみに絞る。R2/Telegram の容量・転送も考慮。
7. **TTL の二重定義**: index.html `EMPTY_TTL`(24h) とサーバ既定(10h/12h)が食い違う。サーバが「真実の削除者」になるので、表示文言（`index.html:3240`「24時間より古い〜」）をサーバ TTL に合わせないとユーザ説明とズレる。
8. **`FB_SECRET`（レガシーDBシークレット）はルールを越える**。Worker からの DELETE/PATCH はルール無視で全消し可能＝コードの cutoff/empty 判定にバグがあると会話全消し事故。**cutoff（`endAt`）と「最新が ttl 超のときだけ」二重ガードを必ず維持**。
9. **冪等性**: cron は重複起動し得る。`PATCH ... = null` は冪等なので可。`backupRtdb` のキーは時刻粒度で上書き（同時刻なら同キー＝重複保存しない）。
10. **既存 `EMPTY_MIN` を上書きしない**: app.js 系の挙動を変えないため、`rooms` 用は新 env `ROOMS_EMPTY_MIN` を使う（既存 `EMPTY_MIN` と分離）。

---

## 検証方法（headless / 実機）

### Worker 単体（ローカル／要 secret）
- `worker/` で `npx wrangler dev --test-scheduled`（`telegram-storage.js`）→ `curl "http://localhost:8787/__scheduled"` で `scheduled()` を手動発火。
- 事前に RTDB に検証用 room を1つ作る:
  - `rooms/test1/empty = true`、`rooms/test1/msgs/<k>/t` を「now-13h」相当の epoch ms にした古いメッセージ＋「now」近傍の新しいメッセージを各1件。
  - 期待: 古い方だけ消え、新しい方は残る。`empty` フラグは残る。`friends`/`users` は不変。
- REST 直叩きで cutoff ロジック単体確認:
  ```
  curl "$FB_URL/rooms/test1/msgs.json?orderBy=%22t%22&endAt=<cutoff>&auth=$FB_SECRET"
  ```
  返る集合が「古いものだけ」か（index が効いているか＝400 `Index not defined` が出ないか）。
- バックアップ: `backupRtdb` 実行後、R2 に `rtdb/rooms-YYYY-MM-DDTHH.json` が出来ているか（`npx wrangler r2 object get` か R2 ダッシュボード）。中身が `rooms` の JSON か。

### ルール（headless）
- `firebase deploy --only database` 後、`rooms/<room>/empty` を **非 admin の auth** で書こうとして拒否されること（手順2 を入れた場合）。RTDB ルールシミュレータでも可。
- `rooms/<room>/msgs` の `orderBy="t"` が Index 警告を出さないこと。

### クライアント（headless：DOM/関数）
- index.html を開き、admin プロフィールで `toggleRoomEmpty(r)` 後 `db.ref("rooms/"+r.room+"/empty")` が `true` か（`index.html:3182`）。`fr-empty` ボタンに `.on` が付くか（`index.html:3240`）。
- これは**フラグ書き込みだけ**で、実削除はサーバ cron 後に反映＝即時には消えない点を確認（仕様どおり）。

### 実機（iPhone PWA）
- admin 端末で `💨` ON → 数時間〜TTL 経過後、対象会話の古いメッセージがサーバ cron 後に消えること（cron 毎時なので最大1時間遅延）。
- 同会話を別端末で開き、消えた後に新規送信→ふたたび溜まり、再び TTL でサーバ削除されること（empty フラグが残る挙動）。
- 復元: わざと msgs を空にし、サーババックアップ（R2/Telegram）から手動 import で復旧できることを1回確認（運用 runbook 化）。
- **要確認**: `firebase deploy --only database` の実行権限・CLI ログイン、`wrangler` の Cloudflare ログイン、R2 バケット作成権限（カード要否）。

---

## 優先度・工数・依存

- 優先度: **高**。empty が「フラグだけで実削除されていない」＝ユーザに約束した自動削除が未実装。かつ再発防止バックアップが端末ローカル依存で、サーバ流出・端末紛失に弱い。
- 工数: **L**。
  - `purgeExpiredRooms` 追加（M）＋ `backupRtdb`（M）＋ ルール index/権限（S）＋ wrangler/R2 設定（S）＋ 実機 TTL 検証（時間がかかる）。
  - 既存 `purgeExpired`（app.js 系）を壊さない配慮と、2モデル混在の検証で嵩む。
- 依存:
  - RTDB ルール変更（`database.rules.json` → `firebase deploy --only database`）。
  - `worker/wrangler.toml`（既存 `shake-toshake` Worker）への env/R2 追記と `wrangler deploy`、`wrangler secret put ROOMS_EMPTY_MIN`。
  - 秘密情報: `FB_URL`/`FB_SECRET`（既存）、R2 バケット（新規・要確認）。
  - 任意整合: index.html `EMPTY_TTL`/title（`index.html:3176,3240`）→ build-index.mjs / push origin main → Netlify。
