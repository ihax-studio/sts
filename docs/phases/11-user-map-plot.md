# 全ユーザーの地域マッププロット(iOSマップ風)

## 目的

現状の globe（地球儀）上には「自分の現在地（青ピン）」と「友達（やり取りした相手）のピン」しか立たない。
このフェーズでは、それに加えて **全ユーザー（または地域単位で集計した分布）** を globe 上にプロットし、
「世界中の誰がどこにいるか／どの地域に何人いるか」を Apple Maps 風のピン・ヒートで可視化する。

ただし全ユーザーの位置を生の `lat/lon` で誰にでも見せるのは **プライバシー上もルール上も不可**（後述）。
そのため本フェーズは次の 2 モードを想定して設計する。

- **モードA（管理者専用・個別ピン）**: 管理者(と)だけが、`users` 全件を読んで全員のピンを globe に立てる。`openAdminList` と同じ読み取り権限を流用。
- **モードB（全員向け・地域集計ヒート）**: 国コード(cc) ／ グリッド単位に丸めた **件数だけ** を集計した公開ノード（例 `regionStats`）を作り、個人を特定できない粒度で全員に見せる。

推奨は **B を本命、A をおまけ（管理画面の付加機能）** とする。理由は「全員に他人の正確な位置を見せない」を満たせるのが B だけだから。

## 現状(コード調査の結果・該当ファイル:行)

すべて `index.html` 内（メインページ。`<script>` インライン）。

### 座標 → 画面投影

- `index.html:2855-2864` `function project(lat,lon)` … `window.__globe`（Three.js の earth/camera/R）を使い、緯度経度を球面座標→ワールド→スクリーン座標 `{x,y,facing}` に変換。`facing` は地球の裏側に隠れているピンを消すための可視判定。**新規ピンもこの関数を共用すればよい**。

### 地域推定（cc/タイムゾーン → lat/lon）

- `index.html:2866-2871` `var CC_LATLON={...}` … 国コード(ISO 2文字)→国の代表 `[lat,lon]`。約 50 か国分。
- `index.html:2872-2874` `var TZ_LATLON={...}` … IANA タイムゾーン→`[lat,lon]`。`CC_LATLON` に当たらなかった時のフォールバック。
- `index.html:2875-2878` `function myRegion()` … `navigator.language` の地域サブタグ → `CC_LATLON`、無ければ `Intl...timeZone` → `TZ_LATLON`。返り値 `{cc, lat, lon}` または `null`。**「精密 GPS を取らずに地域だけ推定する」既存ロジック。集計用の cc 算出にそのまま使える**。

### 自分／友達のピン構築

- `index.html:2879-2899` `function buildFriendPins()` … ピンの DOM を生成。
  - `2882` 自分: `prof.loc.lat!=null` なら `{name:"現在地", me:true}` を push（青ピン）。
  - `2883` 友達: `(prof.rooms||[])` の各 `r` について `r.loc.lat` があれば push（`r.pending` は除外）。
  - `2884` 同一地点（`lat.toFixed(1)+","+lon.toFixed(1)`）でグルーピングし、`2893` で円状に fan out。
  - `2888-2895` `div.gc-fpin > (.gc-fpin-dot + .gc-fpin-lbl)` を生成。`_fpEls` に `{el,lat,lon,ox,oy}` を積む。
  - `2892` 友達ピンは `onclick` で `openAcct(rm)`（相手カードをポップ）。
- `index.html:2900-2902` `function friendPinTick()` … `requestAnimationFrame` ループ。`cur!=="gcFriends"` なら停止。各 `_fpEls` を `project()` で再投影し `left/top/opacity` を毎フレーム更新（globe 回転に追従）。
- `index.html:1955-1966`（CSS）`#gcFriendPins` / `.gc-fpin` / `.gc-fpin-dot(.me)` / `.gc-fpin-lbl` … ピンの見た目。`#gcFriendPins{ position:fixed; inset:0; pointer-events:none; }`、`.show` で表示。`.gc-fpin-dot` は赤、`.me` で青（`#0a84ff`）。
- `index.html:2535`（DOM）`<div id="gcFriendPins"></div>` … ピンを入れるオーバーレイ層。
- 表示トリガ: `index.html:2912`（現在地取得後）、`3840`（`gcFriends` 画面を開いた時）。`3841` で他画面に行くと `.show` を外す。

### 位置データの保存・同期（データモデル）

- `index.html:2907-2908` `getMyLocation()` … GPS 取得時 `prof.loc={lat,lon,precise:true}` を保存し `db.ref("users/"+uid+"/loc").set(prof.loc)`。
- `index.html:3998`（boot 内）`prof.loc` が無ければ `myRegion()` で **精密でない地域 loc** をセットし `users/$uid/loc` に書く。→ つまり **全ユーザーの `users/$uid/loc` には少なくとも地域 lat/lon が入る**。
- `index.html:3087` `saveProfileDB()` … `users/$uid` に `{name,ava,color,born,loc,t}` を update。
- `index.html:3249` / `3376` … 友達成立時 `friends/$peer/$uid` に `{name,ava,color,loc,...}` を書く（相手が自分のピンを出せるように loc を共有）。
- `index.html:3447-3458` `watchFriends()` … `friends/$uid` を購読し、各 peer の `info.loc` を `upsertRoom({... loc:info.loc ...})` で `prof.rooms[].loc` に反映。**これが友達ピンの loc 供給源**。

### 管理者の全ユーザー一覧（全件読みの前例）

- `index.html:3139-3148` `function openAdminList()` … `gcAdminOv` を開き、`claimAdmin()`（`index.html:3822`）で現デバイスを `admin/uid` に再設定して読み取り権限を確保 → `db.ref("users").once("value")` で **全ユーザーを 1 回読む** → `keys.forEach` で `adminRow(k, v[k], i)` を append。失敗時は「読み取り権限がありません」。
- `index.html:3149-3167` `function adminRow(k,u,i)` … 1 ユーザー行。`u.name / u.ava / u.color / u.approved / u.suspended` を使用。**`u.loc` も同じ `u` オブジェクトから取れる**（追加読み込み不要）。
- `index.html:3169-3175` `adminSetUser` / `adminDeleteUser` … 管理操作。

### Firebase ルール（`database.rules.json`）

- `database.rules.json:9-15` `users`:
  - `:10` **全件読み（`users` 直下 `.read`）は `admin/uid === auth.uid` のみ**。→ モードA（全員のピン）は管理者しか実現できない。
  - `:12` 個別 `users/$uid` の `.read` は `auth != null`（ログインしていれば誰でも 1 件は読める）。ただし **uid を列挙する手段が無い**ので、これだけでは全員プロットできない。
  - `:13` 書き込みは本人 or 管理者のみ。
- これ以外に「公開の地域集計ノード」は **現状存在しない**（`regionStats` 等は未定義 → 要追加）。

## 実装手順(具体的・順序立て・コード断片可)

### 共通: 汎用ピン描画を関数化（friendPins と重複させない）

`buildFriendPins`/`friendPinTick` をコピペ増殖させず、`_fpEls` と同型の配列を投影する小さなレンダラを用意する。

```js
// index.html, buildFriendPins の近く(2879付近)に追加
var _mapEls=[], _mapRAF=0;
function plotPins(box, specs){            // specs = [{lat,lon,ava,name,count?,me?,onTap?}]
  box.innerHTML=""; _mapEls=[];
  var groups={}; specs.forEach(function(sp){ var k=sp.lat.toFixed(1)+","+sp.lon.toFixed(1); (groups[k]=groups[k]||[]).push(sp); });
  var idx=0;
  Object.keys(groups).forEach(function(k){ var grp=groups[k];
    grp.forEach(function(sp,gi){
      var pin=document.createElement("div"); pin.className="gc-fpin";
      var dot=document.createElement("div"); dot.className="gc-fpin-dot"+(sp.me?" me":"");
      if(sp.count){ dot.textContent=sp.count; dot.classList.add("heat"); }   // 集計ピンは件数表示
      else if(avaIsImg(sp.ava)){ applyAva(dot, sp.ava); } else { dot.textContent=sp.ava||"📍"; }
      var lbl=document.createElement("div"); lbl.className="gc-fpin-lbl"; lbl.textContent=sp.name;
      pin.appendChild(dot); pin.appendChild(lbl); pin.style.animationDelay=(idx*0.06)+"s"; box.appendChild(pin);
      if(sp.onTap){ pin.style.pointerEvents="auto"; pin.style.cursor="pointer"; pin.onclick=function(ev){ ev.stopPropagation(); haptic(); sp.onTap(); }; }
      var ang=(gi/Math.max(1,grp.length))*Math.PI*2, rad=(grp.length>1)?(22+grp.length*2):0;
      _mapEls.push({el:pin, lat:sp.lat, lon:sp.lon, ox:Math.cos(ang)*rad, oy:Math.sin(ang)*rad});
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ pin.classList.add("pop"); }); });
      idx++;
    });
  });
  if(_mapEls.length && !_mapRAF) mapPinTick();
}
function mapPinTick(){
  _mapEls.forEach(function(p){ var pos=project(p.lat,p.lon);
    if(pos&&pos.facing){ p.el.style.left=(pos.x+(p.ox||0))+"px"; p.el.style.top=(pos.y+(p.oy||0))+"px"; p.el.style.opacity="1"; }
    else p.el.style.opacity="0"; });
  _mapRAF=requestAnimationFrame(mapPinTick);
}
```

> 既存の `buildFriendPins`/`friendPinTick` はそのまま残す（壊さない）。本フェーズは別オーバーレイ `#gcUserPins` に描く。

新オーバーレイ DOM を `index.html:2535` の `#gcFriendPins` の隣に追加し、CSS（`1955-1966`）を `#gcUserPins` にも適用：

```html
<div id="gcUserPins"></div>
```
```css
#gcUserPins{ position:fixed; inset:0; z-index:59; pointer-events:none; display:none; }
#gcUserPins.show{ display:block; }
.gc-fpin-dot.heat{ background:#ff9f0a; font-weight:800; font-size:14px; }   /* 集計ピンはオレンジ＋件数 */
.gc-fpin-dot.heat::after{ border-top-color:#ff9f0a; }
```

### モードB（本命・全員向けの地域集計）

**B-1. 集計ノードの設計**: 個人を特定できない粒度＝国コード(cc) で件数を持つ。

```
regionStats/
  JP: { n: 128, lat: 36.2, lon: 138.3 }
  US: { n:  54, lat: 39.8, lon: -98.6 }
  ...
```

`lat/lon` は `CC_LATLON[cc]` の代表点をそのまま使う（個人座標は一切入れない）。

**B-2. 集計の更新（誰が書くか）**: 2 案。

- **案B-2a（クライアント・トランザクション）**: 各端末が「自分の cc が決まった時」に `regionStats/<cc>/n` を `+1`、cc が変わった時に旧 cc を `-1`。`myRegion().cc` を使う。
  - 既存の `prof.loc` に cc を必ず持たせる（`getMyLocation` の精密 loc には cc が無いので、`myRegion()` の cc を併記しておくと集計が安定）。要 `index.html:2907` 付近の修正。
  - ルール（後述）で `regionStats/$cc/n` をトランザクション加算だけ許可。**ただしクライアント加算は二重カウント／離脱時の減算漏れに弱い**（端末を消しただけだと `-1` されない）。
- **案B-2b（推奨・Worker 集計）**: `worker/` の既存 Cloudflare Worker（このリポジトリに `worker/` あり、cron で empty 整理等を実行）に **定期ジョブ**を足し、管理者権限相当のサーバ鍵で `users` 全件 → cc 別件数を数え `regionStats` を上書き。クライアントは読むだけ。離脱・二重カウントに強く、ルールも「読み取りは全員 / 書き込みは Worker(admin) のみ」で単純。**集計の正となるのはこの案にするのが安全**。
  - 要確認: `worker/` の cron 設定と admin secret/サービスアカウントの持ち方（既存の empty 整理ジョブの実装を流用できるか）。

**B-3. 読み取り＆描画**:

```js
function buildUserHeat(){
  var box=$("gcUserPins"); if(!box) return;
  db.ref("regionStats").once("value").then(function(s){
    var v=s.val()||{}; var specs=[];
    Object.keys(v).forEach(function(cc){ var r=v[cc]||{};
      var ll=(r.lat!=null)?[r.lat,r.lon]:CC_LATLON[cc]; if(!ll) return;
      specs.push({lat:ll[0], lon:ll[1], name:cc+" · "+(r.n||0)+"人", count:r.n||0,
                  onTap:function(){ dynamicIsland(cc+" に "+(r.n||0)+"人"); }});
    });
    plotPins(box, specs); box.classList.add("show");
  }).catch(function(){});
}
```

**B-4. 表示トグル**: friends 画面 or globe ホームに「世界の分布」ボタンを足し、ON で `buildUserHeat()`＋`#gcUserPins.show`、OFF で `_mapRAF` を止め `.show` を外す（`3841` のパターンを踏襲）。`cur` が globe 系でない時は `mapPinTick` を停止する条件を入れる。

### モードA（管理者専用・個別ピン）

`openAdminList`（`3139`）が既に `users` 全件を読んでいるので、その `v`（`s.val()`）を再利用してピン化する。新規読み込み不要。

```js
// openAdminList の users.once("value") コールバック末尾(3145付近)に追記
var specs=[];
keys.forEach(function(k){ var u=v[k]||{}; if(!u.loc||u.loc.lat==null) return;
  specs.push({lat:u.loc.lat, lon:u.loc.lon, ava:u.ava, name:u.name||"(無名)",
    onTap:function(){ dynamicIsland((u.name||"無名")+" / "+(u.loc.cc||"")); }});
});
if(prof.admin){ var ub=$("gcUserPins"); if(ub){ plotPins(ub, specs); ub.classList.add("show"); } }
```

- 表示は管理者だけ（`prof.admin` ガード）。管理一覧を閉じる `gcAdminClose`（`index.html:3900`）で `#gcUserPins.show` を外し `_mapRAF` を止める。
- これはルール上 admin しか `users` 全件を読めない（`database.rules.json:10`）ので **権限的にもA＝管理者専用が必然**。

### ルール追加（モードB 用）

`database.rules.json` に追加（`users` ブロックと同階層）：

```json
"regionStats": {
  ".read": "auth != null",
  "$cc": {
    ".write": "auth != null && root.child('admin/uid').val() === auth.uid",
    "n": { ".validate": "newData.isNumber() && newData.val() >= 0" }
  }
}
```

- 案B-2b（Worker/admin が書く）ならこのままでよい（書き込みは admin のみ）。
- 案B-2a（各端末がトランザクション加算）にする場合は `.write` を `auth != null` に緩め、`n` の validate で `newData.val() === (data.val()||0) + 1 || newData.val() === (data.val()||0) - 1` のような **±1 制約**を付けて改ざんを抑える（厳密にはなお弱い。本命は B-2b）。
- 反映には `firebase deploy --only database`（要 Firebase CLI ログイン）。

## 対象ファイル/関数

- `index.html`
  - 流用: `project()`(2855)、`CC_LATLON`(2866)、`TZ_LATLON`(2872)、`myRegion()`(2875)、`buildFriendPins()`(2880)、`friendPinTick()`(2900)、`openAdminList()`(3139)、`adminRow()`(3149)、`claimAdmin()`(3822)、`getMyLocation()`(2904)、`boot` の loc 初期化(3998)、`watchFriends()`(3447)。
  - 追加: `#gcUserPins` DOM（`2535` の隣）、`plotPins()`/`mapPinTick()`、`buildUserHeat()`、表示トグル。CSS は `1955-1966` の `.gc-fpin*` を流用 ＋ `.gc-fpin-dot.heat`。
- `database.rules.json` … `regionStats` ノード追加（`9-15` の `users` の下あたり）。
- `worker/`（案B-2b 採用時）… cron 集計ジョブ追加。**要確認: 既存 Worker の構成・cron・admin 鍵の持ち方**。

## 注意点・落とし穴

- **プライバシーが最大の論点**: `users/$uid/loc` は GPS 由来だと精密座標（`precise:true`、`getMyLocation` 2907）。これを **全員に見せてはいけない**。全員向け（モードB）は必ず cc 集計の件数のみ。個別ピン（モードA）は管理者限定。
- **ルールが既にA＝管理者前提**: `database.rules.json:10` で `users` 全件読みは admin のみ。「全員のピンを全員に」は今のデータモデルでは不可能（uid 列挙手段が無い＋ read 不許可）。モードB の集計ノードを作るのが唯一の道。
- **`loc` に cc が無いケース**: `getMyLocation`(2907) の精密 loc は `{lat,lon,precise:true}` で **cc を持たない**。cc 集計するなら `myRegion().cc` を併記する修正が要る。一方 boot の地域 loc(3998) は `{cc,lat,lon}` で cc を持つ。
- **クライアント集計の整合性**: B-2a は離脱時の減算漏れ・端末複数・再インストールで二重に膨らむ。**正値が欲しいなら Worker 集計(B-2b)**。
- **RAF の多重起動**: `friendPinTick` と `mapPinTick` を独立に回す。`cur` がマップ系画面でない時に止める条件を必ず入れる（friendPinTick の `cur!=="gcFriends"` 早期 return パターン `2900` を踏襲）。`_mapRAF` のガードを忘れると多重ループで電池を食う。
- **裏側ピンの非表示**: `project()` の `facing` 判定を必ず使う（`2901` と同様）。使わないと地球の裏のピンが表に透けて見える。
- **同一地点の重なり**: 多数のユーザーが同じ cc に集まると `toFixed(1)` グルーピング＋fan out（`2893`）でも潰れる。集計ピン（件数表示）なら 1 国 1 ピンなので問題なし。個別ピン（モードA）で人数が多い時は cc 単位で束ね「N人」表示にするのが無難。
- **`window.__globe` 未初期化**: `project()` は globe 未ロード時 `null` を返す。globe 画面に居ない時に呼ぶと全ピンが消えるだけ（クラッシュはしない）が、描画タイミングは globe ready 後に。
- **ピン数の上限**: 何百もの DOM ピンを毎フレーム再投影すると重い。モードB（国数 ≒ 数十）なら軽い。モードAの個別は管理用途なので件数限定が安全。

## 検証方法(headless/実機)

- **headless（描画ロジック）**: ローカルに静的サーバ（`python3 -m http.server` 等）を立て、ヘッドレス Chromium で `index.html` を開き、コンソールから `plotPins($("gcUserPins"), [{lat:36.2,lon:138.3,name:"JP·5",count:5},{lat:39.8,lon:-98.6,name:"US·3",count:3}])` を叩いて、`#gcUserPins .gc-fpin` が 2 個生成され `left/top` が数値になるか、`facing` で裏側が `opacity:0` になるかを確認。globe(`window.__globe`)が立ち上がっている状態でのみ座標が出る点に注意（メモリ「headless は virtual-time で時計が凍る」系の罠＝RAF 駆動の検証は実フレームを進める必要あり）。
- **集計ノード**: Firebase コンソール / `firebase database:get /regionStats` で `{cc:{n,lat,lon}}` が想定形か確認。ルールは Rules Playground で「非 admin が `regionStats` を read 可・write 不可」「admin が write 可」を確認。
- **実機（iPhone PWA）**: shake-to-shake.netlify.app（または `push origin main`→Netlify デプロイ後）で globe を表示 → 分布ボタン ON でオレンジ件数ピンが回転に追従して立つか／裏側で消えるか／タップで dynamicIsland が出るかを確認。モードAは管理者(と)でログインし管理一覧を開いた時のみピンが出ることを確認。
- **プライバシー検証**: 非管理アカウントで `regionStats` 以外（`users` 全件）が読めない＝個別ピンが出ないことを必ず確認（ルール `:10` が効いている証拠）。

## 優先度・工数・依存

- **優先度: 中**（コア体験ではなく「世界に広がってる感」の演出＋管理者向け分析。バグ修正系フェーズより後でよい）。
- **工数: L**（描画関数の共通化は S だが、プライバシー設計・集計ノード・ルール・Worker 集計まで含めると L。モードB の Worker 集計を真面目にやると XL 寄り）。
  - モードAだけ（管理者個別ピン、`openAdminList` の `v` 再利用）なら **S〜M** で先行実装可能。
- **依存**:
  - `project()` / `window.__globe`（Three.js globe）が前提。
  - モードB は `database.rules.json` への `regionStats` 追加＋ `firebase deploy --only database`。
  - 集計を正値でやるなら `worker/` の cron 集計（**要確認: 既存 Worker 構成・admin 鍵**）。
  - `prof.loc` に cc を持たせる小修正（`getMyLocation` 側）。
- **段階導入の推奨順**: ①`plotPins`/`mapPinTick` 共通化＋`#gcUserPins` → ②モードA（管理者個別ピン、`users` 全件流用）で見た目を固める → ③`regionStats` ＋ルール → ④Worker 集計でモードB を全員公開。
