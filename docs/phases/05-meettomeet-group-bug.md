# meettomeet グループ作成バグ修正

## 目的

meettomeet（chat-app）のグループ作成（3人以上のグループチャット）を確実に成功させる。
友達カードを 0.2 秒長押し → 複数選択 → 「グループ作成」で、403（権限）エラーや黙って失敗することなく
`groups/<gid>` と `chats/<gid>/last` が作られ、全メンバーの一覧にグループが現れる状態にする。

> 注意: グループ機能の DOM（`#groupBar` / `#grpMake` / `#grpDel`）と `app.js` の読み込みは
> **`meettomeet.html` と `classic.html` にのみ存在**し、デプロイ中のメインページ `index.html` には無い。
> したがって本フェーズの対象は `meettomeet.html`（+ それが読む `app.js` / `database.rules.json`）。

## 現状（コード調査の結果・該当ファイル:行）

### グループ作成本体

- `app.js:388-413` `async function createGroupFromSel()` … 選択モードからグループを作る本体。
  - `app.js:389-390` 選択集合 `_selSet` から自分以外を抽出 → `members = [uid, ...sel]`（重複排除）。
  - `app.js:391` **3人以上判定**: `if (members.length < 3) { toast('3人以上で作れます') ... return; }`
    （自分 + 友達2人 = 3 が下限。UI 側 `updateGroupBar` の `mk.disabled = (n < 2)`（`app.js:436`）と整合。
    `n` は選んだ友達数なので、ボタン活性化＝友達2人以上＝合計3人以上）。
  - `app.js:392` グループ上限: `Object.keys(groups).length >= 3` で「グループは3つまで」。
  - `app.js:393` **gid 算出**: `const gid = groupId(members);`
  - `app.js:394` **ローカル重複チェック**: `if (groups[gid]) { ... 既にあります ... return; }`
  - `app.js:397-398` **DB 重複チェック**: `db.ref('groups/'+gid).once('value')` → `snap.exists()` なら中止。
  - `app.js:401-402` `mObj`（メンバー集合 `{uid:true}`）と暗号化済み名前 `encName` / 初期 last `encLast` を用意。
  - `app.js:403-407` **① グループ本体＋メンバーシップを先に確定**（アトミック `update()`）:
    ```js
    const ups = {};
    ups['groups/' + gid] = { n: encName, m: mObj, o: uid, ts: TS() };
    members.forEach(u => ups['userGroups/' + u + '/' + gid] = true);
    await db.ref().update(ups);
    ```
  - `app.js:408-410` **② `chats/<gid>/last` は別の `set()` に分離**:
    ```js
    // last の write ルールは groups/<gid>/m/<uid> を参照するが、①と同一アトミック更新だと
    // pre-update root にまだメンバーが無く 403 → 作成全体が失敗していた（本バグの真因）。
    try { await db.ref('chats/' + gid + '/last').set({ f: uid, t: encLast, ts: TS() }); } catch (e) {}
    ```
  - `app.js:412` 例外時 `toast('作成できませんでした（権限）','error')`。

### gid 生成・グループ判定

- `app.js:29` `_ghash(s)` … FNV-1a 風の決定的ハッシュ（base36）。
- `app.js:30` `groupId(members)` … `'g_' + _ghash([...new Set(members)].sort().join('|'))`。
  メンバー集合（重複排除＋ソート）で**決定的**＝同一メンツは必ず同一 gid ＝重複防止の根拠。
- `app.js:27-28` `isGroup(t)` / `cidOf(t)`（グループは gid、1:1 は `pairId`）。

### 同期・監視

- `app.js:195-200` `db.ref('userGroups/'+uid)` の `on('value')` …
  自分の所属グループを監視。新規 gid を見つけたら `fetchGroup(g)`（`app.js:379-386`）で
  `groups/<gid>` を読み、`groups[g].members/owner/name` を復元 → `renderList()`。
  → **②の `chats/<gid>/last` が無くてもグループ自体は ① の `userGroups` 反映で一覧に出る**設計。
- `app.js:204-209` `watchLast(p)` … `chats/<cidOf>/last` を監視しプレビュー復号。

### Firebase ルール（`database.rules.json`）

- `groups/$gid`（`database.rules.json:79-83`）
  - `.read`: `auth != null && (root.child('groups/'+$gid+'/m/'+auth.uid).exists() || 管理者)`
  - `.write`: `auth != null && (data.child('m/'+auth.uid).exists()` **既存メンバー** `|| (!data.exists() && newData.child('m/'+auth.uid).exists())` **新規作成時 newData に自分が居る** `|| 管理者)`
  - → ① の `groups/<gid>` 書き込みは「新規かつ `newData.m[uid]` がある」枝で通る。OK。
- `userGroups/$uid/$gid`（`database.rules.json:85-89`）
  - `.write`: `auth != null`（**任意の認証ユーザが他人の userGroups にも書ける**）。
  - → ① で `members.forEach(... ups['userGroups/'+u+'/'+gid]=true)`（自分以外も）を許容する根拠。
- `chats/$cid`（`database.rules.json:91-113`）
  - `.read`: `$cid.contains(auth.uid) || root.child('groups/'+$cid+'/m/'+auth.uid).exists() || 管理者`
  - `last`（`:101-103`）`.write`: 同上（`root.child('groups/'+$cid+'/m/'+auth.uid).exists()`）。
    → **`root.child(...)` は pre-update（更新適用前）のルート**を見るため、`groups/<gid>/m/<uid>`
    が先に commit 済みである必要がある＝②を①の後の独立 `set()` にした理由。
  - `msgs/$mid`（`:94-99`）write/validate、`empty`（`:104-106`）は**管理者のみ**、
    `read`/`typing`（`:107-112`）はメンバー判定。
- `convos/$cid`（`database.rules.json:73-77`）`.read` は管理者のみ。
  - グループ作成は **`convos/<gid>` を一切書かない**（`app.js` の `convos/` 書き込みは 1:1 の `sendMsg` 系のみ: `app.js:821,836`）。

## 実装手順（具体的・順序立て）

> 重要: `app.js:403-410` のコメントは「本バグの真因＝①②同一アトミック更新で last が 403」と
> 既に記しており、**コード上は分離済み（=修正済みの形）**。本フェーズはまず「現状で本当に直っているか」を
> 実機/headless で確認し、残課題（下記）を潰す。憶測で再修正しない。

### Step 0. 再現と切り分け（最優先）

1. `meettomeet.html` を 2 端末（A=作成者, B,C=メンバー）で開きログイン。互いに友達追加済みにする。
2. A で友達カードを 0.2 秒長押し → B,C を選択 → 「グループ作成（3人）」。
3. 失敗するなら **どの書き込みで失敗したか**を特定:
   - DevTools Console / Network で `update()`（①）と `set()`（②）の 403 を分離して確認。
   - ① が 403 → `groups/$gid` か `userGroups` のルール問題。
   - ② が 403 → `chats/<gid>/last` のルール（pre-update メンバー未反映）問題。

### Step 1.（① が通らない場合のみ）`groups/$gid` 新規作成枝の確認

- ルール `(!data.exists() && newData.child('m/'+auth.uid).exists())`（`database.rules.json:82`）が機能するか。
- `mObj` に必ず自分（`uid`）が含まれることを保証（`app.js:401` `members.forEach` で `members` に `uid` 入り。OK）。
- 同一アトミック内で `userGroups/<他者>/<gid>` も書くが、これは `auth != null` で許可（`:88`）。問題なし。

### Step 2.（② が通らない場合のみ）`last` を①の後に確実に直列化

- 既に `await db.ref().update(ups)`（①, `app.js:407`）→ その後 `await ... set(...)`（②, `app.js:410`）で直列化済み。
- もし環境差で ② がまだ 403 になるなら、② の前に「自分のメンバーシップが反映されたか」を一度読んで確認してから書く:
  ```js
  await db.ref().update(ups);                                   // ①
  await db.ref('groups/' + gid + '/m/' + uid).once('value');    // 反映待ち（read-after-write）
  try { await db.ref('chats/' + gid + '/last').set({ f: uid, t: encLast, ts: TS() }); } catch (e) {}  // ②
  ```
  （`last` は無くてもグループ自体は `userGroups` 監視で一覧化されるため、② 失敗は致命ではない＝既に `try/catch` で握っている。）

### Step 3. 重複 gid の二重防御を維持

- ローカル `groups[gid]`（`app.js:394`）＋ DB `once('value')`（`app.js:397-398`）の両方を残す。
- gid はメンバー集合で決定的（`app.js:30`）なので、同一メンツの作成は必ず弾かれる。変更不要。

### Step 4.（任意・整合改善）admin 可視性

- 現状グループは `convos/<gid>` を作らないため admin 一覧（`convos` 読みは管理者のみ・`:74`）に出ない。
  管理者からグループも見たいなら ① の `ups` に次を足す（ルール `convos/$cid` write は
  `$cid.contains(auth.uid) || groups/<gid>/m/<uid> || 管理者`・`:76` で gid メンバーなら通る）:
  ```js
  ups['convos/' + gid + '/g'] = true;            // グループ会話マーカー
  ups['convos/' + gid + '/ts'] = TS();
  ```
  → **要確認**: admin 側 UI がグループ `convos` を正しく描画できるか（`_userConvIds` は `cv.g||isGroup(cid)` を除外している・`app.js:503`）。今フェーズのスコープ外なら触らない。

### Step 5. 回帰防止

- `leaveGroup`（`app.js:414-421`）と `userGroups` 監視（`app.js:195-200`）が、抜けた/解散グループを
  ローカル `groups` から消す挙動を壊さないこと（作成直後に自分が一覧から消えないか確認）。

## 対象ファイル/関数

| ファイル | 箇所 | 役割 |
|---|---|---|
| `/Users/s_users/Downloads/chat-app/app.js` | `createGroupFromSel()` `388-413` | グループ作成本体（①②分離） |
| `/Users/s_users/Downloads/chat-app/app.js` | `groupId()` `30` / `_ghash()` `29` | 決定的 gid（重複防止） |
| `/Users/s_users/Downloads/chat-app/app.js` | `fetchGroup()` `379-386` | gid から `groups/<gid>` を復元 |
| `/Users/s_users/Downloads/chat-app/app.js` | `userGroups` 監視 `195-200` | 所属グループ同期・一覧反映 |
| `/Users/s_users/Downloads/chat-app/app.js` | `updateGroupBar()` `432-438` / `tryEnterSel` `425-428` | 選択UI・3人以上の活性判定 |
| `/Users/s_users/Downloads/chat-app/app.js` | `leaveGroup()` `414-421` | 退出（回帰確認用） |
| `/Users/s_users/Downloads/chat-app/database.rules.json` | `groups` `79-83` / `chats/last` `101-103` / `userGroups` `85-89` / `convos` `73-77` | 書き込み権限ルール |
| `/Users/s_users/Downloads/chat-app/meettomeet.html` | `#groupBar` `48` / `#grpDel` `50` / `#grpMake` `51` / `app.js` 読込 `335` | グループUIと配線 |

## 注意点・落とし穴

1. **`root.child(...)` は更新適用前のルートを見る**（Firebase RTDB の仕様）。
   `chats/<gid>/last` の write 判定（`database.rules.json:102`）は `groups/<gid>/m/<uid>` を参照するので、
   **メンバーシップ確定（①）→ last 書き込み（②）の順序を絶対に崩さない**。同一 `update()` に戻すと 403 で再発する。
2. **`groups` の新規作成は `newData.child('m/'+auth.uid)` 枝でしか通らない**（`:82`）。
   `mObj` に必ず自分を入れること（現状 OK）。`o`（owner）は別フィールドで権限には無関係。
3. **`userGroups/$uid/$gid` の write が `auth != null`（誰でも可・`:88`）**。
   他者の userGroups に書く設計に依存している（① で全メンバー分書く）。ルールを厳格化すると作成が壊れる。
4. **`groups` 3つ上限**は 2 箇所（`tryEnterSel` `app.js:426` と `createGroupFromSel` `app.js:392`）。片方だけ直さない。
5. **3人未満トースト**（`app.js:391`）と UI 活性（`app.js:436` `n<2`）の閾値ズレに注意。`n`＝友達数、`members.length`＝自分込み。
6. **`last` 失敗はサイレント**（`try/catch` 握り潰し・`app.js:410`）。
   作成自体は ① で成立するので、「グループは作れたがプレビューが空」になり得る。失敗時の再送 or 既定文言表示を検討（任意）。
7. **`convos/<gid>` 未作成**＝管理者一覧に出ない（既知・スコープ判断）。触る場合は admin UI 側の除外ロジック（`app.js:503`）も併せて確認。
8. デプロイ中の `index.html` にはグループ UI が無い（`app.js` 未読込）。検証は `meettomeet.html` で行う。

## 検証方法（headless / 実機）

### headless（ルール単体）

- Firebase Emulator + `@firebase/rules-unit-testing` で `database.rules.json` を直接検証:
  - 認証ユーザ A が `update({ 'groups/g_X': {m:{A:true,B:true,C:true},o:A,...}, 'userGroups/A/g_X':true, ... })` → **許可**。
  - その後 A が `set('chats/g_X/last', {...})` → **許可**（メンバー反映後）。
  - ① と ② を**同一 `update()`** にまとめた場合 → `chats/g_X/last` が **拒否**されることを再現テストで固定化（回帰防止）。
  - 非メンバー D が同 gid を作成（`newData.m` に D が居ない）→ **拒否**。
- **要確認**: 現環境に emulator 設定（`firebase.json` は 53 byte・ルールパスのみの可能性）があるか。無ければ手順に追加が必要。

### 実機（meettomeet.html）

1. 3端末（A 作成・B/C 被招待、相互フレンド済み）で `meettomeet.html` を開く。
2. A: 友達カード 0.2s 長押し → B,C 選択 → 「グループ作成（3人）」。
   - 期待: `haptic.confirm()` ＋ トースト「グループを作成しました」＋ 選択モード解除（`exitSelMode`）。
3. B,C: `userGroups/<uid>` 監視（`app.js:195`）でグループが**自動で一覧に出る**ことを確認。
4. グループを開いて送信 → 3人で受信できること（`chats/<gid>/msgs`・ルール `:94-99`）。
5. 重複作成: 同じ B,C をもう一度選んで作成 → 「同じメンバーのグループは既にあります／作れません」で弾かれる（`app.js:394` or `398`）。
6. 退出: `leaveGroup`（`app.js:414`）→ 一覧から消え、他メンバーは残る。
7. Console / Network に 403 が出ていないことを確認（特に `chats/<gid>/last` PUT）。

## 優先度・工数・依存

- **優先度**: medium。コードは既に①②分離済み（`app.js:403-410` のコメントが真因と修正を明記）。
  まず「本当に直っているか」の検証が主で、未修正なら最小差分で直列化を補強する段階。
- **工数**: S〜M（検証中心なら S、emulator 整備＋convos/admin 整合まで広げると M）。
- **依存**:
  - 既存の `database.rules.json` の `groups` / `chats/last` / `userGroups` ルールが**デプロイ済み**であること
    （`firebase deploy --only database` 相当。**要確認**: 本番に最新ルールが反映済みか）。
  - グループUIは `meettomeet.html`（+ `classic.html`）に存在。`index.html` には無い（同フェーズで `index.html` に
    グループ機能を載せるかは別判断＝スコープ外）。
  - `app.js` の `encWith/decWith`（`app.js:153-165`）・`TS()`（`app.js:131`）・`pairId` 等の既存ヘルパに依存。
