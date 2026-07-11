# シェイク共有のSNS化(通知ゲート/40分窓/Telegram保存)

## 目的

現状の globe-chat（= `index.html`）のシェイク共有は「チャットを開いている状態で端末を振る → 全カメラ撮影 → **その開いているチャットルームへ画像メッセージとして直接送信**」という"チャット添付"の挙動になっている。

これを memory 設計（旧 meettomeet 版の `index-s2s.js` が実装していた SNS モデル）へ寄せる:

- **通知ゲート**: 通知 ON のユーザーだけが投稿/閲覧できる（`Notification.permission === "granted"` が条件）。
- **40分窓（シェイクタイム）**: 日付シードで全端末同時刻に開く「窓」が 1 日数回あり、**窓が開いている 40 分間だけ投稿できる**。窓は worker cron（`worker/s2s-push.js`）が Web Push で一斉通知して開始を知らせる。
- **Telegram 画像保存**: 撮った画像は RTDB に base64 を直書きせず、Cloudflare Worker 経由で Telegram に保存（`storage.js` の `window.Store` / `worker/telegram-storage.js`）。RTDB には Telegram の `file_id` だけ載せる（軽量）。
- **s2s 集約 + 通知でしか見れない**: 投稿は `s2s/<uid>` の 1 ノードに集約（1 人 1 投稿の最新だけ）。フィードは「自分 + 友達の最新 1 件」を fan-out で読む。閲覧導線は通知/アカウント面のシェイク・スイッチ経由（既存の `setupShakePeek` / `viewShakePost`）。

要するに「`index-s2s.js` が旧 meettomeet UI 向けに作った S2S の仕組みを、globe-chat（`index.html`）の DOM・関数群へ移植する」フェーズ。

## 現状(コード調査の結果・該当ファイル:行)

### A. globe-chat（index.html）側 ＝ 移植先（現状は"チャット添付"）

- **シェイク検知 `onMotion`** … `index.html:3721-3726`
  ```js
  function onMotion(e){
    if(!prof.shake) return;
    var a=e.accelerationIncludingGravity||e.acceleration; if(!a) return;
    var mag=Math.abs(a.x||0)+Math.abs(a.y||0)+Math.abs(a.z||0), now=Date.now();
    if(mag>32 && now-_shakeAt>1500){ _shakeAt=now; haptic(); if(chatRoom&&DEV.canCapture) shootAndSend(); }
  }
  ```
  → **`chatRoom` がある時だけ `shootAndSend()`**。窓判定・通知ゲートは一切無い。
- **`enableMotion()`** … `index.html:3728-3735`。`DeviceMotionEvent.requestPermission()` を通して `devicemotion` に `onMotion` を結線。起動時 `boot()` で `if(prof.shake) enableMotion();`（`index.html:3988`）。
- **全カメラ撮影 `captureAllCameras()`** … `index.html:3687-3705`。`enumerateDevices()` で videoinput を列挙し逐次 `grabFrom`（`3672-3686`）。出力は **dataURL（image/jpeg 0.55, 長辺720）の配列**＝そのまま RTDB に積む前提。
- **`sendImages(shots)`** … `index.html:3706-3711`
  ```js
  function sendImages(shots){
    if(!shots||!shots.length||!chatRoom) return;
    (authReady||...).then(function(){ shots.forEach(function(img){
      db.ref("rooms/"+chatRoom+"/msgs").push({ u:uid, ..., img:img, t:... });
    }); });
  }
  ```
  → **`rooms/<chatRoom>/msgs` に画像メッセージとして push**（これがチャット添付の本体）。
- **`shootAndSend()`** … `index.html:3712-3717`。`captureAllCameras().then(sendImages)`。チャットの📸ボタン `gcChatCam`（`index.html:3952`）からも呼ばれる。
- **通知/Push `enableNotif()`** … `index.html:3742-3754`。`Notification.requestPermission()` → `pushManager.subscribe` → **`push/<uid>` に subscription を `set`**（`index.html:3749`）。`VAPID_PUBLIC`/`PUSH_URL` はインライン定義（`index.html:3738-3739`、PUSH_URL=`https://shake-push.s-users15.workers.dev/push`）。
- **トグル**: `prof.shake`（`toggleShake` `index.html:3354`）/ `prof.notif`（`toggleNotif` `index.html:3352`）。設定シート `gcSetShake`/`gcSetNotif`、オンボード `gcTgShake`/`gcTgNotif`。
- **投稿の"のぞき見"閲覧 UI は既に存在するが宛先が宙に浮いている**:
  - `openAcct()` で **`db.ref("posts/"+peer)`** を読む … `index.html:3265`
  - `setupShakePeek(post)`（`index.html:3270-3279`）＝アバターに透明 `<input switch>` を重ね、スワイプ → `viewShakePost(post)`（`index.html:3280-3281`）が **`post.img`（単一 dataURL）を全画面表示**。
  - ⚠️ **`posts/` ノードに書き込む箇所はコードベースに存在しない**（`grep posts/` のヒットは `index.html:3265` の read 1 箇所のみ）。つまり閲覧 UI は完成しているが**投稿パイプラインが未接続**。さらに後述のとおり **`posts/` は RTDB ルール未定義＝読めない**。
- **`storage.js`（`window.Store`）は index.html から読み込まれていない**。`index.html` の外部 `<script src>` は firebase compat 3 本のみ（`index.html:2664-2666`）。`window.STORAGE_URL` の設定も index.html 内に無い（要確認: ビルド時/別ファイルでの注入は見つからず）。

### B. index-s2s.js ＝ 移植元（欲しい仕組みが"全部入り"。ただし旧 meettomeet UI 向け）

`index-s2s.js` は **まさに今回欲しい SNS モデルの完成実装**。ただし参照している DOM/関数が globe-chat に**存在しない**（`#scrHome`・`.home-top`・`#scrReg`・`settings`・`setNotif`・`window.__indexExtras.openShakeCam` 等＝旧 meettomeet 系）。冒頭で `meettomeet` パスは即 return（`index-s2s.js:11-12`）。移植すべきロジック:

- **40分窓スケジュール** … `index-s2s.js:55-71`
  - `dayTimes(d)`（`56-65`）: 日付シードで「平日 7-19時に 3-4回 / 休日 5am〜翌1am に 4-5h 間隔」の窓開始時刻配列を生成（全端末で一致）。
  - `schedState()`（`66-71`）: **`WIN = 40 * 60000`**。`inWin`（今が窓内か）と `next`（次の窓開始）を返す。
- **通知ゲート `gated()`** … `index-s2s.js:47-53`。`Notification.permission === "granted"` 必須・`emptyModeOn()` は不可。
- **撮影 → Telegram → 投稿 `onShot`** … `index-s2s.js:118-132`
  ```js
  window.Store.putImage(arr[i]).then(function(u){ imgs.push(u.id); ... });   // file_id を集約
  var post = { ts: Date.now(), imgs: imgs, best: 0, n: imgs.length };
  db.ref('s2s/' + uid).set(post)...
  ```
  → **`s2s/<uid>` に `{ts, imgs:[file_id...], best, n}` を `set`**。
- **投稿の起点は窓内のみ** … `start()`（`index-s2s.js:103`）が `if(!schedState().inWin){ toast('次のシェイクタイムに投稿できます'); return; }`。
- **フィード（自分+友達の最新1件）** … `openFeed()`（`135-151`）/ `renderFeed()`（`152-176`）。友達 id を `friendsMap()`（`cx_friends` localStorage）で集め、各 `s2s/<id>` を `once('value')` で読み、`window.Store.fileUrl(file_id)` で表示。再投稿＝`s2s/<uid>/ts` 更新のみ、削除＝`s2s/<uid>` remove。
- **公開 API** … `window.__s2s = { device, openFeed, schedState, onboard }`（`index-s2s.js:240`）。

### C. worker/s2s-push.js ＝ 窓開始の一斉 Push（cron）

- `dayTimes`（`worker/s2s-push.js:21-33`）は **index-s2s.js と同一式を JST 補正して移植済み**（`JST=9h`、UTC ベースで壁時計合わせ）。`windowJustOpened(now, intervalMin)`（`36-41`）。
- `scheduled()`（`59-72`）: cron 15分毎に「直近 15 分で窓が開いたか」だけ判定し、開いた回だけ **`push/<uid>` の全 subscription** を読み、既存 `PUSH_URL`（shake-push Worker）へ投げて「📸 シェイクタイム！いま撮ろう」を一斉送信。
- 手動ブロードキャスト: `GET ?force=1&key=<ADMIN_KEY>`（`76-88`）。
- ⚠️ **`push/<uid>` の保存形に注意**: globe-chat は `push/<uid>` に subscription を**直に** `set`（`index.html:3749`）＝`push[uid].endpoint` 形。worker は `s.sub || s`（`worker/s2s-push.js:69,84`）で両対応にしてあるので合致する。**ただし要確認**: shake-push Worker（PUSH_URL）の `/push` が `{subscription, title, body, tag, url}` ボディを受ける実装か（`worker/s2s-push.js:51-55` の body 形）はこのリポジトリにソースが無く未確認。
- デプロイ設定: `worker/wrangler-s2s.toml`(要 cron `*/15 * * * *`・secret `FIREBASE_DB_URL`/`FIREBASE_SECRET`/`PUSH_URL`/`ADMIN_KEY`)。

### D. storage.js / worker/telegram-storage.js ＝ Telegram 画像保存

- `storage.js`（`window.Store`）: `putImage(file)`→`compressImage`（77KB / 15bit 減色・長辺888）→`upload`→ Worker `/up` → `{id:file_id, mid:message_id}`。表示は `fileUrl(id)=base+"/dl?id="+id`。`base()` は **`window.STORAGE_URL`**。`compressImage` は **File/Blob 入力前提**（dataURL ではない）。
- `worker/telegram-storage.js`: `/up`（sendDocument）/`/dl`（getFile）/`/tr`（翻訳）。**empty mode の cron purge は `chats/<cid>`（meettomeet 系のパス）を対象**であり、globe-chat の `rooms/<room>/msgs` や `s2s/<uid>` は対象外（＝S2S 投稿の Telegram 実体は今のところ自動削除されない。要検討）。

### E. RTDB ルール（database.rules.json）

- **`s2s/<uid>`**: 既に存在（`database.rules.json:61-65`）。read = 認証済み全員 / write = 本人 or 管理者。**＝今回の集約先としてそのまま使える**。
- **`push/<uid>`**: 既存（`67-71`）。
- **`posts/`: ルール定義が無い ＝ 既定 deny で読めない**。globe-chat の `openAcct` が読む `posts/<peer>`（`index.html:3265`）は現状ルール上アクセス不可。→ **`posts/` を新設するより `s2s/<uid>` に寄せるのが正**（ルール済み・index-s2s.js と整合・worker と整合）。

## 実装手順(具体的・順序立て・コード断片可)

方針: **`posts/` は捨て、`s2s/<uid>` に一本化**。`index-s2s.js` の窓ロジックと Telegram 保存を globe-chat（`index.html`）へ移植し、シェイクの宛先を「開いているチャット」から「`s2s/<uid>` への投稿」へ切り替える。

### 手順 1: storage.js を読み込み、STORAGE_URL を設定

`index.html:2666`（firebase database compat の直後）に追記:
```html
<script src="storage.js"></script>
```
設定ブロック（`index.html:2669` 付近、`window.FIREBASE_CONFIG` の近く）に追記:
```js
window.STORAGE_URL = "https://<telegram-storage worker のサブドメイン>.workers.dev";   // ← 要確認: 既存 tg-storage worker の URL
```
（`worker/telegram-storage.js` をデプロイ済みの URL。`STORAGE_URL` が空だと `Store.ready()=false`。）

### 手順 2: 40分窓ロジックを index.html に移植

`index-s2s.js:56-72` の `at` / `dayTimes` / `schedState` / `hhmm` を **そのまま** index.html の IIFE 内（例: `onMotion` の手前 `index.html:3719` 付近）にコピーする。`WIN = 40*60000` を含む `schedState()` が核心。
```js
function schedState(){ var now=Date.now(), d=new Date(), times=dayTimes(d), WIN=40*60000, inWin=false, next=null;
  for(var i=0;i<times.length;i++){ if(now>=times[i]&&now<times[i]+WIN)inWin=true; if(times[i]>now&&next===null)next=times[i]; }
  if(next===null){ var tm=new Date(d); tm.setDate(tm.getDate()+1); var tt=dayTimes(tm); next=tt[0]||null; }
  return { inWin:inWin, next:next };
}
```

### 手順 3: シェイクの宛先を「s2s 投稿」へ切替（onMotion / 新 postShake）

`onMotion`（`index.html:3721-3726`）を、チャット添付ではなく **窓内 + 通知ON のときに s2s 投稿** へ変更:
```js
function onMotion(e){
  if(!prof.shake) return;
  var a=e.accelerationIncludingGravity||e.acceleration; if(!a) return;
  var mag=Math.abs(a.x||0)+Math.abs(a.y||0)+Math.abs(a.z||0), now=Date.now();
  if(mag>32 && now-_shakeAt>1500){ _shakeAt=now; haptic();
    if(!DEV.canCapture) return;
    if(chatRoom){ shootAndSend(); return; }              // 既存挙動を残すなら: チャットを開いている時だけ従来の添付（任意）
    if(!(typeof Notification!=="undefined" && Notification.permission==="granted")){ toast("通知をオンにするとシェイク共有できます"); return; }  // 通知ゲート
    if(!schedState().inWin){ var st=schedState(); toast("次のシェイクタイムは "+(st.next?hhmm(st.next):"—")+"頃"); return; }            // 40分窓
    postShake();
  }
}
```
> 設計判断（要確認）: 「チャット内シェイク＝従来の添付」を残すか、SNS 投稿へ完全移行するか。memory は SNS 化が主旨なので、`chatRoom` の有無に関わらず `postShake()` に寄せても良い。上記は**安全側（チャット内は従来動作を維持）**の例。

新規 `postShake()`（`captureAllCameras` を流用しつつ Telegram へ）:
```js
function postShake(){
  if(!window.Store||!window.Store.ready()){ toast("ストレージ未設定"); return; }
  toast("📸 撮影中…");
  captureAllCameras().then(function(shots){     // shots = dataURL[]
    if(!shots.length){ toast("撮影できませんでした"); return; }
    toast("投稿中…");
    var imgs=[];
    (function up(i){
      if(i>=shots.length){
        if(!imgs.length){ toast("投稿に失敗"); return; }
        var post={ ts:Date.now(), imgs:imgs, best:0, n:imgs.length };
        db.ref("s2s/"+uid).set(post).then(function(){ toast("投稿しました 🫨"); }).catch(function(){ toast("投稿に失敗"); });
        return;
      }
      var f=dataURLtoFile(shots[i], "shot"+i+".jpg");          // ↓手順4
      window.Store.putImage(f).then(function(u){ imgs.push(u.id); up(i+1); }).catch(function(){ up(i+1); });
    })(0);
  });
}
```

### 手順 4: dataURL → File 変換ヘルパ（captureAllCameras の出力を Store.putImage に渡すため）

`captureAllCameras()` は dataURL を返すが `Store.putImage` は File/Blob を要求するため変換が必須:
```js
function dataURLtoFile(durl, name){
  var p=durl.split(","), bstr=atob(p[1]), n=bstr.length, u8=new Uint8Array(n);
  while(n--) u8[n]=bstr.charCodeAt(n);
  return new File([u8], name||"img.jpg", { type:(p[0].match(/:(.*?);/)||[])[1]||"image/jpeg" });
}
```
（任意の最適化: `grabFrom` に Blob を直接返すモードを足し、dataURL ↔ File の往復を省く。`storage.js:34` のとおり 77KB 以下はそのまま通る。）

### 手順 5: 閲覧側を s2s/<peer> に切替（posts/ を廃止）

`openAcct()` の `db.ref("posts/"+peer)`（`index.html:3265`）を `s2s/<peer>` 読みに変更し、`setupShakePeek`/`viewShakePost`（`index.html:3270-3281`）を `imgs[best]` 対応に:
```js
try{ db.ref("s2s/"+peer).once("value").then(function(s){ var p=s.val();
  if(p&&p.imgs&&p.imgs.length){ $("gcAcct").classList.add("haspost"); $("gcAcctSub").textContent="スワイプして新しいシェイクを見よう"; setupShakePeek(p); }
}).catch(function(){}); }catch(_){}
```
`viewShakePost(post)`（`index.html:3280`）を file_id → URL に:
```js
function viewShakePost(post){
  var imgs=(post&&post.imgs)||[]; if(!imgs.length){ dynamicIsland("投稿はまだありません"); return; }
  var best=post.best||0; var fid=imgs[best]||imgs[0];
  var src=(window.Store&&window.Store.fileUrl(fid))||"";
  if(!src){ dynamicIsland("投稿はまだありません"); return; }
  var v=document.createElement("div"); v.style.cssText="position:fixed;inset:0;z-index:9800;background:#000;display:flex;align-items:center;justify-content:center";
  var im=document.createElement("img"); im.src=src; im.style.cssText="max-width:100%;max-height:100%"; v.appendChild(im);
  v.onclick=function(){ v.remove(); }; document.body.appendChild(v);
}
```

### 手順 6: 通知ゲートの導線（投稿はゲート ON のときだけ）

- `enableNotif()`（`index.html:3742`）/ `push/<uid>` への購読保存は**既に動作**＝そのまま。worker が `push/<uid>` を読んで窓開始 Push を送る。
- トグル `prof.shake` ON 時に通知 OFF なら、`toggleShake`（`index.html:3354`）から `enableNotif()` を促す（任意の UX 改善）。「通知でしか見れない」＝閲覧側でも `Notification.permission==="granted"` を `setupShakePeek` 表示条件に足すと完全準拠（**要判断**: 友達の投稿を見るのに通知必須にするか）。

### 手順 7: worker（s2s-push）デプロイ

- `worker/wrangler-s2s.toml` に cron `crons = ["*/15 * * * *"]` を設定し、secret `FIREBASE_DB_URL` / `FIREBASE_SECRET`（RTDB レガシートークン）/ `PUSH_URL`（既存 shake-push）/ `ADMIN_KEY` を投入。`wrangler deploy`。
- **要確認**: PUSH_URL（shake-push Worker）の `/push` が `worker/s2s-push.js:51-55` のボディ形（`{subscription,title,body,tag,url}`）を受けるか。受けないなら shake-push 側を合わせる。

### 手順 8（任意）: フィード UI

通知タップ/アカウント面だけでなく一覧画面に「自分＋友達の最新 1 件」フィードを出すなら、`index-s2s.js:135-178` の `openFeed`/`renderFeed`/`s2sIcon`/`ago` を移植。友達 id は globe-chat では `cx_friends` ではなく **`prof.rooms`（`r.peer`）**または `db.ref("friends/"+uid)` の child から集める（`index.html:3445-3462` の `watchFriends` 参照）。`s2sIcon` の `info.icon`/`color` は globe-chat の `ava`/`color` に読み替え。

## 対象ファイル/関数

| ファイル | 関数 / 箇所 | 変更内容 |
|---|---|---|
| `index.html` | 外部 script（`:2664-2666`）/ 設定（`:2669`付近） | `storage.js` 読み込み + `window.STORAGE_URL` 設定 |
| `index.html` | `onMotion`（`:3721-3726`） | 窓判定+通知ゲート→`postShake()` へ分岐 |
| `index.html` | 新規 `postShake` / `dataURLtoFile` / 移植 `dayTimes`/`schedState`/`hhmm` | s2s 投稿パイプライン |
| `index.html` | `captureAllCameras`（`:3687-3705`） | 出力（dataURL）を流用（必要なら Blob 直返し最適化） |
| `index.html` | `sendImages`/`shootAndSend`（`:3706-3717`） | チャット内添付として温存 or 廃止（方針次第） |
| `index.html` | `openAcct`（`:3265`）/ `setupShakePeek`（`:3270`）/ `viewShakePost`（`:3280`） | `posts/`→`s2s/`、`post.img`→`imgs[best]`+`Store.fileUrl` |
| `index.html` | `enableNotif`（`:3742`）/ `push/<uid>` | 変更不要（既存流用） |
| `storage.js` | `window.Store.putImage`/`fileUrl`（`:78,:75`） | そのまま利用（File 入力） |
| `worker/s2s-push.js` | `scheduled`/`windowJustOpened`（`:59,:36`） | デプロイ + secret/cron 設定 |
| `worker/telegram-storage.js` | `/up` `/dl`（`:60,:79`） | デプロイ済み URL を STORAGE_URL に |
| `database.rules.json` | `s2s`（`:61-65`） | そのまま利用。`posts/` は不要（新設しない） |

## 注意点・落とし穴

- **`posts/` はルール未定義＝読めない**。`index.html:3265` の `posts/<peer>` read は今でも失敗しているはず。**`s2s/<uid>`（ルール済み）に一本化**すること。`posts/` を残すなら `database.rules.json` に rule 追加が必要だが、`s2s/` と二重管理になるので非推奨。
- **dataURL ↔ File の不整合**。`captureAllCameras`（globe-chat）は dataURL を返すが、`Store.putImage`（`storage.js`）は **File/Blob 入力**。`index-s2s.js` の `onShot` は `openShakeCam` から File を受け取る前提（`index-s2s.js:118` の `files`）。globe-chat 移植では `dataURLtoFile` 変換が必須（手順4）。
- **index-s2s.js をそのまま読み込んでも globe-chat では動かない**。参照 DOM（`#scrHome`/`.home-top`/`#scrReg`）・関数（`setNotif`/`settings`/`window.__indexExtras.openShakeCam`）が globe-chat に無い。**ロジック（dayTimes/schedState/onShot 内部）だけ移植**するのが正。安易に `<script src="index-s2s.js">` を足すと initBanner が host 無しで no-op になるだけで害は少ないが無意味。
- **窓スケジュールはクライアントと worker で式が一致していること**が大前提（全端末同時刻）。`index-s2s.js:56-65` と `worker/s2s-push.js:21-33` は同一だが、index.html へ移植する際に**コピペ元を index-s2s.js に固定**し、worker と式がズレないよう注意。worker は JST 補正済み（`JST=9h`）だがクライアントは端末ローカル時刻 = JST 前提。海外ユーザーは窓時刻が JST 基準でズレる（**要確認/要件次第**）。
- **PUSH_URL（shake-push Worker）の API 形が未確認**。`worker/s2s-push.js:51-55` の送信ボディ `{subscription,title,body,tag,url}` を `/push` が受けるか、このリポジトリにソースが無いため**要確認**。受けないなら body 形を合わせる。
- **`push/<uid>` の保存形**: globe-chat は subscription を直に `set`（`index.html:3749`）。worker は `s.sub||s` で両対応（`worker/s2s-push.js:69`）なので合致するが、保存形を変えると worker も追従が必要。
- **Telegram 実体の自動削除（empty mode）は s2s を対象にしていない**。`worker/telegram-storage.js:122-166` の purge は `chats/<cid>`（meettomeet 系）専用で、`s2s/<uid>` の画像は消えない。S2S 投稿の TTL（例: 次の窓で上書き or 一定時間で削除）を実装するなら worker かクライアント側で別途。投稿は `s2s/<uid>` を `set`（上書き）なので**過去投稿の file_id は残るが RTDB 参照は消える**＝Telegram 側に画像が溜まり続ける点に注意（`mid` を保持して deleteMessage する設計が要検討）。
- **`STORAGE_URL` が空だと `Store.ready()=false`** で投稿が静かに失敗。設定漏れに注意（手順1）。
- **撮影は iPhone/iPad/iPod のみ**（`DEV.canCapture`、`index.html:3667`）。Mac/Vision/その他は投稿不可（既存仕様どおり）。
- **PWA(standalone) 必須**な機能（アカウント作成等）と同様、`devicemotion` の `requestPermission` はユーザージェスチャ起点が必要。`enableMotion`（`index.html:3728`）は既にトグル/起動で結線済み。

## 検証方法(headless/実機)

### headless（ロジック単体）
- `dayTimes`/`schedState` は純関数なので Node で抽出して検証可能。固定 `seed`（日付）で窓配列が決定論的に出ること、`WIN=40分` で `inWin` が窓開始〜+40分だけ true になることを確認。クライアント（移植版）と `worker/s2s-push.js` の `dayTimes` 出力が**同一日付で一致**することを assert（同時刻性の担保）。
- `dataURLtoFile` → `Store.compressImage` を jsdom + canvas モックは不安定なので、実ブラウザ（後述）で確認推奨。

### 実機（iPhone/iPad PWA）
1. PWA としてホーム追加 → 通知 ON（`enableNotif` 成功・`push/<uid>` に subscription が入ることを RTDB コンソールで確認）。
2. 窓内を強制: 検証用に `schedState` を一時的に `inWin:true` 固定 or `dayTimes` に「今+1分」を差し込んでビルドし、シェイク → `s2s/<uid>` に `{ts,imgs:[file_id...],n}` が書かれることを RTDB で確認。`imgs[0]` を `STORAGE_URL/dl?id=<file_id>` で開いて画像が出るか。
3. 友達端末（別 uid）でアカウント面を開く → `setupShakePeek` のスイッチをスワイプ → `viewShakePost` で相手の最新ショットが全画面表示されること。
4. 窓外でシェイク → 「次のシェイクタイムは HH:MM 頃」toast が出て投稿されないこと（通知ゲート/窓ゲートの確認）。
5. 通知 OFF でシェイク → 「通知をオンにすると…」toast で投稿不可。
6. worker（s2s-push）デプロイ後: `GET <worker>/?force=1&key=<ADMIN_KEY>` を叩き、購読済み端末に「📸 シェイクタイム！」Push が届くこと。cron で窓開始時に自動送信されること（時刻を待つ or `force` で代替）。

> headless スクショ検証の参考: memory「chat-app (Shake-to-Shake)」のとおり検索系は Shadow DOM インライン・iframe 厳禁。本フェーズは DOM 構造より RTDB/Telegram の往復が主眼なので、RTDB コンソール + `/dl` 直開きでの確認が手早い。

## 優先度・工数・依存

- **優先度**: 中。globe-chat の現行シェイク（チャット添付）は動作しており、SNS 化は機能追加（破壊的ではない）。memory のフェーズ計画では index-s2s.js 由来の主要 SNS 機能。
- **工数**: M（半日〜1日）。窓ロジック/Telegram/閲覧切替は**移植元（index-s2s.js）が完成しているため新規設計は不要**。主作業は (a) storage.js 結線 + STORAGE_URL、(b) onMotion 分岐 + postShake + dataURLtoFile、(c) posts→s2s 閲覧切替、(d) worker デプロイ + PUSH_URL API 確認。
- **依存**:
  - `worker/telegram-storage.js` がデプロイ済みで `STORAGE_URL` が判明していること（**要確認**: 既存デプロイ URL）。
  - `worker/s2s-push.js` のデプロイ + `PUSH_URL`（shake-push Worker）の `/push` API 形の確認（**要確認**）。
  - RTDB ルール `s2s/<uid>`・`push/<uid>` は既存（追加不要）。
  - 移植元 `index-s2s.js`（ロジックのコピー元）/ `storage.js`（`window.Store`）。
