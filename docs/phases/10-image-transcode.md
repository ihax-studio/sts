# 画像トランスコード（512色 / 最大800px）

対象アプリ: Shake to Shake / Meet to Meet（`/Users/s_users/Downloads/chat-app/index.html`）
全カメラ撮影（`captureAllCameras`）で得た写真を、Firebase RTDB（`rooms/<room>/msgs`）へ base64 dataURL として送る前に、**最大 800px・減色（512色相当）・品質圧縮**でリサイズ／トランスコードしてデータ量を削減するフェーズ。

## 目的

1. シェイク撮影で前面・背面・超広角…と複数枚（`shots[]`）を一度に送るため、1枚あたりのバイト数を下げて RTDB 書き込みと回線負荷を抑える。
2. 写真は dataURL 文字列としてそのまま `img:img` で `push` され、受信側は `im.src=m.img` で表示する（暗号化なし）。そのため送信元での圧縮がそのまま全員のダウンロード量・RTDB 保存量になる。送信前トランスコードが唯一の削減ポイント。
3. 既存の JPEG 圧縮（720px / q0.55）を、要件「最大800px・512色減色・品質圧縮」に置き換え／強化する。

## 現状（コード調査の結果・該当ファイル:行）

すべて `index.html` 内（Globe Chat ＝ `rooms/<room>/msgs` 経路）。DM 経路（`chats/$cid/msgs`）とは別。

### 撮影 → canvas 化（ここが唯一のリサイズ/圧縮点）
- `grabFrom(constraints)`: `index.html:3676-3690`
  - getUserMedia → `<video>` に流し、`onloadeddata` で `setTimeout(finish,350)`、保険で `setTimeout(finish,1600)`。
  - `finish()` 内（`index.html:3681-3683`）で **既にリサイズ＋JPEG化している**:
    ```js
    var w=v.videoWidth||640,h=v.videoHeight||480,sc=Math.min(1,720/Math.max(w,h));
    var c=document.createElement("canvas"); c.width=Math.round(w*sc); c.height=Math.round(h*sc);
    c.getContext("2d").drawImage(v,0,0,c.width,c.height);
    img=c.toDataURL("image/jpeg",0.55);
    ```
  - つまり現状は **長辺720px / JPEG品質0.55**。**色数の削減（減色 / 512色）は一切していない。** 戻り値は dataURL 文字列（失敗時 `null`）。
- `captureAllCameras()`: `index.html:3691-3709`
  - 権限取得後 `enumerateDevices()` → `videoinput` 全 deviceId を逐次 `grabFrom({video:{deviceId:{exact:id}}})`、ラベル非開示時は `facingMode:"user"`→`environment` の2枚。
  - 各 `grabFrom` の戻り（dataURL）を `shots.push(img)` で配列化して返す。**ここではトランスコードしていない**（grabFrom 任せ）。

### 送信（RTDB へ raw 投入）
- `sendImages(shots)`: `index.html:3710-3715`
  - `shots.forEach` で `db.ref("rooms/"+chatRoom+"/msgs").push({ u, name, ava, color, img:img, t:ServerValue.TIMESTAMP })`。
  - **`img` は加工なしでそのまま push**。圧縮の最後のチャンスはここ（または grabFrom）。
- 呼び出し元 `shootAndSend()`: `index.html:3716-3721` → `captureAllCameras().then(shots => sendImages(shots))`。
- シェイク発火: `onMotion`（`index.html:3725-`）で `mag>32` かつ 1.5s クールダウンで `shootAndSend()`。

### 受信・表示
- `renderMsg(m, room)` の画像分岐: `index.html:3606`
  ```js
  if(m.img){ d.classList.add("img"); var im=document.createElement("img");
    im.className="gc-msg-img"; im.loading="lazy"; im.src=m.img; d.appendChild(im); }
  ```
  - dataURL をそのまま `src` に入れるだけ。**復号や再変換はしない**（テキストだけ `decWith` で復号 / 画像は平文）。
- 表示サイズ CSS `.gc-msg-img`: `index.html:2344` → `width:220px; max-width:64vw; border-radius:14px;`（表示は小さい＝高解像度を送る必然性は低い）。

### 容量に関する既存の配慮（裏取り）
- AI/会話エクスポートでは画像を除外: `index.html:3424` → `if(m.img) return; // 画像は容量のため除外`。
- 引用プレビューは本文ではなく `"📷 写真"` 固定: `index.html:2996`（`quoteTextOf`）。
- RTDB ルール `rooms/$room`: `database.rules.json:55-60` → `.read/.write` が `auth != null` のみで **サイズ/`.validate` 制約なし**。＝大きい dataURL でもそのまま入る（RTDB の 1書き込み上限の範囲では通る）。だからこそクライアント側削減が効く。

## 実装手順（具体的・順序立て）

方針: **トランスコード専用ヘルパ `transcodeDataURL(dataURL)` を新設**し、`sendImages` の push 直前で全 `shots` に適用する。`grabFrom` 側は撮影専用に保ち（責務分離）、必要なら `grabFrom` の上限だけ 720→800 に合わせる。減色は「中間 canvas に縮小描画 → ピクセルを量子化（ビット深度を落として 512色相当に丸める）」で実装する。

### 1) `grabFrom` の上限を 800px に合わせる（任意・最小変更）
`index.html:3681` の `720` を `800` に。
```js
var w=v.videoWidth||640,h=v.videoHeight||480,sc=Math.min(1,800/Math.max(w,h));
```
※ ここを 800 にしても最終トランスコード（手順2）でも 800 で頭打ちにするので二重に安全。撮影段の品質は `0.55` のままで良い（最終で再圧縮するため）。

### 2) トランスコード・ヘルパを追加
`grabFrom` の直前あたり（`index.html:3675` 付近）に追加。dataURL（または `<canvas>`/`<img>`）を受け取り、**最大800px + 減色 + JPEG再圧縮**した dataURL を Promise で返す。

```js
/* ── 画像トランスコード: 最大800px + 512色相当に減色 + 再圧縮 ── */
// 512色相当 = R:3bit(8) × G:3bit(8) × B:3bit(8) = 512 階調の固定パレット丸め。
// 真の「最頻512色パレット(median cut)」ではなく、量子化で 512 色“上限”に抑える軽量版。
function quantize512(imgData){
  var d=imgData.data;
  // 各チャンネルを 3bit (=8段階) に丸める → 8*8*8 = 512 色
  for(var i=0;i<d.length;i+=4){
    d[i]   = (d[i]   & 0xE0) | (d[i]   >> 3);   // R 上位3bit保持 + ディザ無しの単純丸め
    d[i+1] = (d[i+1] & 0xE0) | (d[i+1] >> 3);   // G
    d[i+2] = (d[i+2] & 0xE0) | (d[i+2] >> 3);   // B
    // alpha(d[i+3]) はカメラ画像で常に255なので触らない
  }
  return imgData;
}
function transcodeDataURL(src, opts){
  opts=opts||{};
  var maxPx=opts.maxPx||800, quality=opts.quality||0.6, doQuantize=opts.quantize!==false;
  return new Promise(function(res){
    var im=new Image();
    im.onload=function(){
      try{
        var w=im.naturalWidth||im.width, h=im.naturalHeight||im.height;
        var sc=Math.min(1, maxPx/Math.max(w,h));
        var cw=Math.max(1,Math.round(w*sc)), ch=Math.max(1,Math.round(h*sc));
        var c=document.createElement("canvas"); c.width=cw; c.height=ch;
        var ctx=c.getContext("2d");
        ctx.imageSmoothingQuality="high";
        ctx.drawImage(im,0,0,cw,ch);
        if(doQuantize){
          try{ var id=ctx.getImageData(0,0,cw,ch); ctx.putImageData(quantize512(id),0,0); }catch(_){}
        }
        res(c.toDataURL("image/jpeg", quality));   // 減色後はJPEGでもブロックが揃って小さくなりやすい
      }catch(_){ res(src); }   // 失敗時は元dataURLをフォールバック
    };
    im.onerror=function(){ res(src); };
    im.src=src;
  });
}
```

補足:
- **「512色相当」の解釈**: GIF/PNGのようなパレット減色（最大256色）ではなく、**RGB各3bit丸めで 8×8×8 = 512 色の格子に量子化**する軽量手法。要件「512色」を実装可能な形に翻訳したもの。真パレット減色（median-cut で見た目優先の512色）は重い・依存増のため不採用（必要なら手順5の代替を参照）。**要確認: 「512色」がパレット枚数か量子化階調かは依頼者意図を要確認。**
- 量子化で平坦化された後は JPEG でも更に縮みやすい。`image/webp` が使えれば（iOS16+ Safari は encode 対応）さらに小さい。手順3で出力フォーマットを選べるようにする。

### 3) （任意）WebP 出力にフォールバック対応
JPEGより小さくなるが、古い端末で `toDataURL("image/webp")` が JPEG にフォールバックする場合がある。出力後に MIME を見て判定する。
```js
function bestEncode(canvas, quality){
  var webp=canvas.toDataURL("image/webp", quality);
  if(webp.indexOf("data:image/webp")===0) return webp;     // WebP対応
  return canvas.toDataURL("image/jpeg", quality);          // 非対応はJPEG
}
```
`transcodeDataURL` の `res(c.toDataURL(...))` を `res(bestEncode(c, quality))` に差し替え。受信側 `renderMsg` は `<img src=dataURL>` なので WebP/JPEG どちらでもそのまま表示可（**要確認: 想定最古端末で WebP デコード可否**）。

### 4) `sendImages` で push 直前に全枚トランスコード
`index.html:3710-3715` を、各 `img` を `transcodeDataURL` してから push するよう変更。
```js
function sendImages(shots){
  if(!shots||!shots.length||!chatRoom) return;
  (authReady||Promise.resolve()).then(function(){
    Promise.all(shots.map(function(img){
      return transcodeDataURL(img, {maxPx:800, quality:0.6, quantize:true});
    })).then(function(outs){
      outs.forEach(function(out){
        if(!out) return;
        try{ db.ref("rooms/"+chatRoom+"/msgs").push({
          u:uid, name:prof.name||"匿名", ava:prof.ava||"🙂",
          color:prof.color||"#62d8ff", img:out,
          t:firebase.database.ServerValue.TIMESTAMP }); }catch(_){}
      });
    });
  });
}
```
ポイント:
- `shootAndSend()`（`index.html:3716-3721`）はそのままで良い（`sendImages(shots)` の中で完結）。
- トースト「N枚 送信しました」のタイミングは現状 `captureAllCameras().then` 内（`index.html:3720`）。トランスコードは非同期になるので、**送信完了トーストを `Promise.all` の後に出したい場合**は `sendImages` を `return` する Promise 化に変えて `shootAndSend` 側で待つ（任意・UX調整）。

### 5) （任意・上位互換）真パレット減色が必要なら
依頼者が「見た目重視の本物の減色」を求める場合のみ。median-cut で代表色 N(≤512) を選び index 化する処理は重く、PNG/インデックスカラー出力には自前エンコーダ（例: UPNG.js 等）が要る。RTDB は dataURL 文字列を入れるだけなので出力 MIME は自由だが、依存追加・処理時間増のトレードオフ。**まずは手順2の量子化（512格子）で容量効果を測ってから判断する。**

## 対象ファイル / 関数

| 役割 | 場所 | 変更 |
|---|---|---|
| 撮影→canvas（既存の縮小/圧縮） | `index.html:3676-3690` `grabFrom` | 上限 720→800（手順1・任意） |
| トランスコード本体（新規） | `index.html:3675` 付近 `transcodeDataURL` / `quantize512` | 追加 |
| 送信（push直前で適用） | `index.html:3710-3715` `sendImages` | Promise.all で全枚変換 |
| 撮影オーケストレーション | `index.html:3691-3709` `captureAllCameras` | 原則変更なし |
| 受信表示 | `index.html:3606` `renderMsg`（`m.img`） | 変更不要（WebP採用時のみ確認） |
| 表示サイズCSS | `index.html:2344` `.gc-msg-img` | 変更不要（220px表示） |
| RTDBルール | `database.rules.json:55-60` `rooms/$room` | 変更不要（サイズ制約なし） |

## 注意点・落とし穴

- **責務分離**: 圧縮を「`grabFrom` 内のみ」「`sendImages` 内のみ」の二重がけにしない。最終削減は `sendImages` のトランスコードに一本化し、`grabFrom` は撮影品質（800px / q0.55）の確保に留める。二重 JPEG は劣化が乗るだけ。
- **量子化は drawImage 後・getImageData で**: `getImageData` は同一オリジン canvas なら可（カメラ映像を canvas に描いた時点でクリーン）。ただしごく稀に `SecurityError`/性能で失敗するので **必ず try/catch し、失敗時は減色スキップ（縮小+JPEGのみ）**で続行。
- **alpha**: カメラ JPEG に透過はない。`quantize512` は alpha を触らずに済ませる（触ると JPEG 化で破綻はしないが無駄）。
- **WebP の偽装フォールバック**: 非対応端末では `toDataURL("image/webp")` が黙って PNG/JPEG を返すことがある。手順3の MIME 判定必須。さもないと「WebPのつもりが巨大PNG」で逆に増える。
- **非同期化による順序**: `Promise.all` で並列変換すると `shots` の順序は `map` で保たれるが、`forEach` push は順不同に届く可能性（RTDB の `t:ServerValue.TIMESTAMP` でソートされるなら問題なし）。表示順を厳密にしたいなら逐次 chain に。
- **送信完了トーストのタイミング**: 現状トーストは変換前に出る設計（`index.html:3720`）。非同期トランスコードを足すと「送信しました」表示後に実際の書き込みが起きる。厳密にするなら `sendImages` を Promise 化して待つ。
- **暗号化していない**: テキストは `encWith/decWith` で暗号化されるが画像は平文 dataURL（`index.html:3608` は text のみ復号、3606 は img を直 src）。本フェーズはあくまで容量削減で、機密性は対象外。**画像も暗号化する場合は別フェーズ。**
- **iOS の getUserMedia 同時1台制約**: `captureAllCameras` は逐次で対応済み。トランスコードを足しても撮影フローは変えないこと。

## 検証方法（headless / 実機）

### A) ヘルパ単体（headless / Node なしでブラウザ devtools）
- 任意の大きい dataURL（例: 既存写真を `toDataURL` 化）を `transcodeDataURL(src, {maxPx:800, quality:0.6})` に通し、
  - 出力 dataURL の **長さ（≒バイト数）が元より十分小さい**ことを確認（`out.length / src.length`）。
  - 出力 `<img>` の `naturalWidth/Height` が **長辺 ≤ 800** であること。
  - 量子化後の **ユニーク色数 ≤ 512**: 出力を再 `getImageData` し `Set` に `(r<<16)|(g<<8)|b` を入れて `size<=512` を確認（量子化版の検証）。
- headless（Playwright 等）でも `Image`/`canvas`/`getImageData` は動く。仮想時間で時計が止まる系の罠は無関係（`onload` 駆動）。

### B) フロー結合（実機 iPhone PWA）
1. ルームを開いてシェイク → `shootAndSend` 発火。
2. RTDB（Firebase コンソール `rooms/<room>/msgs`）で push された `img` 文字列長を、トランスコード前後で比較（before: 720px/q0.55 のみ、after: 800px/q0.6/量子化）。**after の方が小さい**ことを確認。
3. 受信側端末で `renderMsg` 表示が崩れない（`.gc-msg-img` 220px 表示で見た目劣化が許容範囲）。
4. 複数カメラ（前面/背面/超広角）の N 枚すべてが送られる（枚数欠落がない）こと。

### C) 容量メトリクスのログ（任意）
`transcodeDataURL` 内で `console.log("transcode", src.length, "->", out.length)` を一時的に仕込み、削減率を実測してから `quality`/`quantize` を調整。

## 優先度・工数・依存

- **優先度**: medium（容量・回線最適化。機能追加ではなく既存送信経路の差し替え。RTDB 課金/帯域に効く一方、未実装でも送受信自体は動く）。
- **工数**: S〜M。ヘルパ追加（〜40行）＋ `sendImages` の Promise.all 化。WebP/トースト整合まで入れて M。
- **依存**:
  - 前提コードはすべて実在（`grabFrom` / `captureAllCameras` / `sendImages` / `renderMsg`）。新規依存ライブラリ不要（手順5の真パレット減色を選んだ場合のみ追加）。
  - 他フェーズへの依存なし。**「512色」の正確な定義（量子化512格子 vs 本物パレット）と、想定最古端末の WebP 可否は要確認。**
