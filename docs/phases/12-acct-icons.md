# アカウント詳細の🫨📎🗺️を機能化

## 目的

アカウント詳細カード（`#gcAcct`）の下部に並ぶ 3 つのアイコンボタン 🫨 / 📎 / 🗺️ は、現状 `disabled` の飾りで何も起きない。これを実際に動かす:

- **🫨 シェイク** … その友達に向けた「シェイク（撮影投稿）」を送る/見る導線。最小実装は **「その友達とのチャットを開いてシェイク撮影を促す」**（既存の `shootAndSend()` / シェイク機構を再利用）。
- **📎 添付** … その友達とのチャットに **画像を添付送信**する（端末の写真ライブラリ or カメラから `<input type="file">` で選んで RTDB の `rooms/<room>/msgs` に画像メッセージとして push）。
- **🗺️ 地図** … その友達の現在地（`loc`）を **globe 上にフォーカス**（既存 `flyTo(lat,lon)` でその座標へカメラを飛ばし、`buildFriendPins()` のピンを見せる）。

いずれも既存関数の再利用で完結する“配線フェーズ”であり、新規バックエンドは原則不要。ただし 🫨 を「相手に向けた投稿（`posts/<uid>`）」として本格実装する場合のみ DB ルール追加が必要（後述）。

## 現状(コード調査の結果・該当ファイル:行)

### アイコン本体（DOM）

`index.html:2633`（カード内、`.gc-acct-talk` と `.gc-acct-unfriend` の間）:

```html
<div class="gc-acct-icos">
  <button class="gc-acct-ico" disabled>🫨</button>
  <button class="gc-acct-ico" disabled>📎</button>
  <button class="gc-acct-ico" disabled>🗺️</button>
</div>
```

- **3 ボタンとも `disabled` で ID 無し** → JS から掴めない。まず ID 付与 + `disabled` 除去が必要。
- カード全体は `index.html:2625-2636`。アバター `#gcAcctAva`(2628)、名前 `#gcAcctName`(2630)、サブ `#gcAcctSub`(2631)、話すボタン `#gcAcctTalk`(2632)。

### CSS

`index.html:2242-2243`:

```css
.gc-acct-icos{ display:flex; gap:20px; margin-top:2px; }
.gc-acct-ico{ background:none; border:none; font-size:23px; cursor:default; opacity:.65; padding:0; }
```

→ `cursor:default; opacity:.65` は「無効に見える」前提。有効化時に `cursor:pointer; opacity:1` と `:active` の押下感を足す。

### 状態・ヘルパー（すべて `index.html` 内、同一スコープのIIFE）

- `var _acct=null` … 開いているカードの **room オブジェクト**を保持（`index.html:3261`）。`{room, name, ava, peer?, loc?, ...}`。
- `peerOf(r)` … room から相手 uid を解決（`index.html:3262`）。`r.peer` 優先、無ければ `dm_<a>_<b>` から自分以外を返す。
- `openAcct(r)` … カードを開く本体（`index.html:3265-3274`）。`users/<peer>` と `posts/<peer>` を読み込む。
- `openChat(room,title)` … チャット画面を開く（`index.html:3568`、呼び出し例 `3933`）。`chatRoom` をセットする。
- `acctHideEl()` … カードを閉じる（`index.html:3264`）。
- `shootAndSend()` … 全カメラ撮影 → 現在の `chatRoom` に画像 push（`index.html:3718-3723`）。`DEV.canCapture`（iPhone/iPad/iPod のみ true）でガード。
- `onMotion`/`enableMotion`/`_shakeAt` … 端末シェイク検知（`index.html:3726-3739`）。`prof.shake` が条件。
- `sendImages(shots)` … dataURL 配列を `rooms/<chatRoom>/msgs` に画像 push（`index.html:3712-3717`）。📎 の参考実装。
- `getMyLocation()` … 自分の現在地を取得し `users/<uid>/loc` に保存、globe にピン表示（`index.html:2904-2913`）。
- `flyTo(lat,lon,dist)` … globe カメラを (lat,lon) に向ける（`index.html:1245-1266`、グローバル関数）。`dist` 省略時 8.0。
- `buildFriendPins()` … `prof.loc` と各 `r.loc` から globe ピンを生成（`index.html:2880-2899`）。友達の `loc` は `r.loc.lat/lon`（`2883`）。
- `project(lat,lon)` … 緯度経度→画面座標（`index.html:2855`、ピンの追従に使用）。
- `haptic()` / `dynamicIsland(msg)` / `toast(msg)` … 触覚・通知バナー・トースト（`index.html:2788` / `3642` / `3638`）。
- ハンドラ結線ブロック … `index.html:3933-3936`（`gcAcctTalk`/`gcAcctX`/`gcAcctClose`）。ここに 3 アイコンの `onclick` を追記する。

### 🫨 投稿（posts）の現状ギャップ ＝ 要注意

- `posts/<peer>` は **読むコードしか無い**（`index.html:3271` の `openAcct` 内で `db.ref("posts/"+peer).once(...)`）。`grep posts/` で `index.html`/`app.js`/`index-extras.js`/`index-s2s.js` を当たった結果、**書き込み（set/push/update）は皆無 = 投稿の publish 側が未実装**。
- さらに `database.rules.json` に **`posts` ノードのルールが存在しない**（`users`/`friends`/`rooms`/`chats` 等はあるが `posts` は無し）。デフォルト拒否のため、ルール追加なしに `posts/<uid>` へ書くと **PERMISSION_DENIED**。
- → 「🫨 で相手に向けた投稿を作る」フル機能は別フェーズ（フェーズ07「シェイク共有のSNS化」と重複）。本フェーズの 🫨 最小実装は **投稿を作らず**、`shootAndSend()` 系のチャット内シェイク撮影に橋渡しするに留める。

## 実装手順(具体的・順序立て・コード断片可)

### 手順0. ボタンに ID を付け、有効化（DOM）

`index.html:2633` を置換:

```html
<div class="gc-acct-icos">
  <button class="gc-acct-ico" id="gcAcctShakeBtn" title="シェイクを送る">🫨</button>
  <button class="gc-acct-ico" id="gcAcctClipBtn"  title="写真を添付">📎</button>
  <button class="gc-acct-ico" id="gcAcctMapBtn"   title="地図で見る">🗺️</button>
</div>
```

（`disabled` を全て除去、ID を付与。絵文字はそのまま。）

### 手順1. CSS を有効化見た目に

`index.html:2243` を更新:

```css
.gc-acct-ico{ background:none; border:none; font-size:23px; cursor:pointer; opacity:1; padding:0;
  transition:transform .14s var(--gc-spring); }
.gc-acct-ico:active{ transform:scale(.86); }
.gc-acct-ico:disabled{ cursor:default; opacity:.4; }   /* 個別に無効化したい時用 */
```

### 手順2. 📎 添付用の隠し file input を用意

カード or body に 1 つ追加（DOM、`#gcAcct` の近く `index.html:2636` 直後あたり）:

```html
<input type="file" id="gcAcctFile" accept="image/*" style="display:none">
```

### 手順3. ハンドラ本体を追加（JS）

`index.html:3936`（`gcAcctClose` 結線の直後、同じ IIFE 内）に以下を追記。**`_acct`/`peerOf`/`openChat`/`flyTo`/`buildFriendPins`/`shootAndSend` は同スコープで参照可**。

```js
// Phase12: アカウント詳細 🫨/📎/🗺️
// 🫨 シェイク: その友達のチャットを開いて撮影を促す（DEV.canCapture が無い端末はトーストのみ）
if($("gcAcctShakeBtn")) $("gcAcctShakeBtn").onclick=function(e){ e.stopPropagation();
  if(!_acct)return; var r=_acct; haptic(); acctHideEl(); _acct=null;
  openChat(r.room, r.name);
  if(DEV.canCapture){ dynamicIsland("端末を振ってシェイクを送ろう"); }   // onMotion が chatRoom 内で発火
  else { toast("この端末ではシェイク撮影は使えません"); }
};

// 📎 添付: file input を開き、選んだ画像を相手のチャットへ送る
if($("gcAcctClipBtn")) $("gcAcctClipBtn").onclick=function(e){ e.stopPropagation();
  if(!_acct)return; haptic();
  var f=$("gcAcctFile"); f.dataset.room=_acct.room; f.value=""; f.click();
};
if($("gcAcctFile")) $("gcAcctFile").onchange=function(){
  var file=this.files&&this.files[0]; var room=this.dataset.room; if(!file||!room)return;
  var rd=new FileReader();
  rd.onload=function(){
    var img=rd.result;   // dataURL（必要なら縮小: 後述の落とし穴参照）
    (authReady||Promise.resolve()).then(function(){
      try{ db.ref("rooms/"+room+"/msgs").push({ u:uid, name:prof.name||"匿名",
        ava:prof.ava||"🙂", color:prof.color||"#62d8ff", img:img,
        t:firebase.database.ServerValue.TIMESTAMP }); }catch(_){}
    });
    haptic(); dynamicIsland("写真を送りました");
  };
  rd.readAsDataURL(file);
};

// 🗺️ 地図: その友達の現在地へ globe を飛ばす
if($("gcAcctMapBtn")) $("gcAcctMapBtn").onclick=function(e){ e.stopPropagation();
  if(!_acct)return; var r=_acct; var loc=r.loc; haptic();
  // room に loc が無ければ users/<peer>/loc を一度読む
  function go(l){ if(!l||l.lat==null){ toast("この友達の現在地はまだありません"); return; }
    acctHideEl(); _acct=null; hideAll(); show("gcFriends"); buildFriends();
    $("gcFriendPins").classList.add("show"); buildFriendPins();
    if(typeof flyTo==="function") flyTo(l.lat, l.lon, 3.0);   // dist小さめで寄る
    dynamicIsland((r.name||"友達")+"の現在地"); }
  if(loc&&loc.lat!=null){ go(loc); }
  else { var peer=peerOf(r); if(peer&&db){ db.ref("users/"+peer+"/loc").once("value")
      .then(function(s){ go(s.val()); }).catch(function(){ go(null); }); } else go(null); }
};
```

### 手順4.（任意・🫨 を本格投稿化する場合のみ）DB ルール追加

本フェーズの最小実装では不要。もし 🫨 を「`posts/<uid>` に投稿を書く」へ拡張するなら `database.rules.json` の `"rules"` 直下に追加し `firebase deploy --only database` が必要:

```json
"posts": {
  "$uid": {
    ".read": "auth != null",
    ".write": "auth != null && (auth.uid === $uid || root.child('admin/uid').val() === auth.uid)"
  }
}
```

（→ この拡張はフェーズ07と重複するため、まずは手順0〜3の「チャット橋渡し」だけ入れるのを推奨。）

## 対象ファイル/関数

| 対象 | 場所 | 役割 |
|---|---|---|
| アイコン DOM | `index.html:2633` | ID 付与・`disabled` 除去 |
| `.gc-acct-ico` CSS | `index.html:2243` | 有効化見た目・`:active` |
| 隠し file input | `index.html:2636` 付近に新規 | 📎 用 `#gcAcctFile` |
| ハンドラ結線 | `index.html:3936` 直後に追記 | 3 ボタンの `onclick` |
| `_acct` / `peerOf` | `index.html:3261-3262` | 対象 room/peer 解決（再利用） |
| `openChat` | `index.html:3568` | 🫨 のチャット遷移（再利用） |
| `shootAndSend`/`onMotion`/`DEV` | `index.html:3718/3727/3663` | 🫨 のシェイク撮影（再利用） |
| `flyTo` | `index.html:1245` | 🗺️ のカメラ移動（再利用） |
| `buildFriendPins`/`buildFriends`/`project` | `index.html:2880/3226/2855` | 🗺️ のピン表示（再利用） |
| `database.rules.json` | `posts` 追加 | 任意・本格投稿化時のみ |

## 注意点・落とし穴

- **`_acct` を握ったまま画面遷移しない**: `openChat`/`flyTo` の前に `acctHideEl(); _acct=null;` を必ず実行（既存 `gcAcctTalk` ハンドラ `index.html:3933` と同じ作法）。残すと次にカードを開いた時に古い相手が混ざる。
- **`e.stopPropagation()` 必須**: カード背景 `#gcAcct` のクリックで `closeAcct()` が走る（`index.html:3936`）。ボタン onclick で伝播を止めないと閉じてしまう。
- **🫨 はチャットを開かないとシェイクが送れない**: `onMotion` は `chatRoom` がある時だけ `shootAndSend()` する（`index.html:3731`）。よって 🫨 は「チャットを開く」が必須前提。`DEV.canCapture` が false（Android/PC 等）の端末は撮影不可なのでトーストで明示。
- **📎 の画像サイズ**: `FileReader` の dataURL は無圧縮なので大きい写真だと RTDB に巨大 base64 が載る。既存 `captureAllCameras`/`grabFrom`（`index.html:3672` 付近）は長辺720・jpeg0.55 に縮小している。**同じ縮小処理を canvas で噛ませるのが望ましい**（最小実装ではそのまま push でも動くが要注意 = 要確認: 既存に汎用「dataURL縮小」ユーティリティがあるか未確認、無ければ `grabFrom` 内の縮小ロジックを切り出す）。
- **`accept="image/*"`**: iOS Safari/PWA では写真ライブラリ + カメラ選択が出る。カメラ強制したい場合は `capture="environment"` を付けるが、ライブラリ選択を潰すので付けない方が無難。
- **🗺️ の `loc` 欠落**: 友達が現在地を共有していない（`getMyLocation` 未実行）と `r.loc` も `users/<peer>/loc` も無い → 必ず null ガードしてトースト。`buildFriendPins` は `loc.lat==null` をスキップする（`index.html:2883`）ので、飛ばす前に存在チェックする。
- **`flyTo` はグローバル関数**（Three.js globe 側、`index.html:1245`）。IIFE 内からは参照できるが、念のため `typeof flyTo==="function"` でガード。
- **`show("gcFriends")` への遷移**: 🗺️ はカードを閉じて friends 画面（globe が見える画面）へ戻す必要がある。`buildFriendPins()` は `cur==="gcFriends"` でしかピンを描き続けない（`friendPinTick` `index.html:2900`）ので、`show("gcFriends")` 後に呼ぶ。
- **`posts` 書き込み禁止**: 前述の通りルール未定義。🫨 で `posts/` に書く実装を入れると静かに失敗（catch で握り潰される）するので、本格化するなら手順4を必ずセットで。

## 検証方法(headless/実機)

- **headless（DOM/配線確認）**: ローカル配信（例 `python3 -m http.server`）で `index.html` を開き、devtools コンソールで `openAcct({room:'dm_x_y', name:'テスト', loc:{lat:35.68,lon:139.76}})` を直接呼ぶ → カードが出る。3 ボタンが `disabled` でなくクリックでき、🗺️ で globe が東京へ寄る／📎 で file ダイアログが出る／🫨 で `openChat` に遷移することを確認。Firebase 認証が無くても DOM 遷移・`flyTo` は動く（push は no-op/失敗で握り潰し）。
- **🗺️ 単体**: `flyTo(35.68,139.76,3.0)` をコンソールで直接叩き、カメラが動くか先に確認（globe 描画が前提）。
- **📎 単体**: file input の `onchange` を確認。実 push は `db`/`uid` が必要なので、ログイン済み 2 端末（or 2 タブ別アカウント）で同じ `room` を開き、片方の📎送信がもう片方のチャットに画像メッセージで届くか。
- **🫨 / 実機（iPhone PWA 必須）**: 友達カード→🫨→チャットへ遷移→端末を振る→全カメラ撮影され `rooms/<room>/msgs` に画像が積まれることを確認（`prof.shake` ON・`DEV.canCapture` true が条件）。シミュレータ/Mac では撮影不可なのでトースト表示までを確認。
- **デプロイ**: 反映は `git push origin main` → Netlify（メモリ「chat-app (Shake-to-Shake)」記載）。`posts` ルールを足した場合のみ `firebase deploy --only database` も。

## 優先度・工数・依存

- **優先度**: 低〜中（既存機能の導線追加。コア体験には必須でない“あれば良い”枠だが、disabled の飾りが放置されている UX 負債）。
- **工数**: S（小）。手順0〜3 のみなら DOM/CSS 微修正 + onclick 3 個で実装は半日未満。既存関数（`openChat`/`flyTo`/`shootAndSend`/`buildFriendPins`）の再利用が効く。
- **依存**:
  - 🫨/📎 は **チャット送信基盤**（`openChat`/`rooms/<room>/msgs` push、`DEV.canCapture`）に依存（実装済）。
  - 🗺️ は **globe + `flyTo` + friend pins**（実装済）と、相手が `loc` を共有していること（実行時依存）。
  - 🫨 を「相手向け投稿」に本格化する場合のみ **`database.rules.json` の `posts` 追加 + `firebase deploy`** に依存し、フェーズ07（シェイク共有のSNS化）と統合すべき。
