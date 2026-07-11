# 変更ダイヤログを0.3s scaleupで出/消

## 目的
プロフィール変更ダイヤログ（`gcProfEdit`）や各種ダイヤログ（`gcBgPick`、`gcConnect` 等）が
表示/非表示になるとき、カードを `transform: scale(.9 → 1)` + `opacity: 0 → 1` で
0.3秒 ease アニメーションさせ、出るときも消えるときも気持ちよくスケールさせる。

iOS のシート/アラートのような「ぽっと出てぽっと消える」体験に統一するのが狙い。
`display:none` ↔ `display:flex` の単純切り替えだと CSS transition が走らないため、
このコードベースで既に使われている **vis + RAF（requestAnimationFrame）パターン**で実装する。

## 現状（コード調査の結果・該当ファイル:行）
対象は基本的に単一ファイル **`/Users/s_users/Downloads/chat-app/index.html`**（428KB）。

CSS 変数（共通イージング）:
- `index.html:1818` `--gc-ease: cubic-bezier(.22,.61,.36,1);`（標準 ease-out）
- `index.html:1819` `--gc-spring: cubic-bezier(.34,1.56,.64,1);`（オーバーシュート付きバネ）

ダイヤログごとの現状:

### 1. `gcProfEdit`（アカウント変更ピル）= 本フェーズの主対象
- HTML: `index.html:2571` `<div id="gcProfEdit">`、中のカードは `.gc-pe-card`
- CSS: `index.html:2096-2098` で `display:none` / `.show{display:flex}`
- **CSS: `index.html:2181-2184` で既に scaleup 実装済み**
  - `2181`: `#gcPwaGate, #gcProfEdit, #gcHandoff{ display:flex !important; ... opacity:0; visibility:hidden; pointer-events:none; transition:opacity .3s var(--gc-ease), visibility 0s linear .3s; }`
  - `2182`: `.show` で `opacity:1; visibility:visible; pointer-events:auto;`（消える側の visibility 遅延あり）
  - `2183`: `... > .gc-pe-card{ transform:scale(.84); transition:transform .3s var(--gc-spring); }`
  - `2184`: `.show > .gc-pe-card{ transform:scale(1); }`
- JS: 開く `index.html:3090` `$("gcProfEdit").classList.add("show");`（`openProfEdit`、関数定義 `3085`）
- JS: 閉じる `index.html:3098`/`3099`（`$("gcProfEdit").classList.remove("show")`、背景タップでも閉じる `3099`）
- **結論: `gcProfEdit` は出/消とも 0.3s scale + opacity 済み**（scale 値は `.84→1`、card は `--gc-spring`）。
  本フェーズの仕様（`.9→1`・`0.3s ease`）に厳密合わせするか、現状の `.84`/spring を正とするかは「要確認」。

### 2. `gcBgPick`（背景ピッカー）= 未対応（scale なし）
- HTML: `index.html:2480-2490`、カードは `.gc-bgpick-card`（`2481`）
- CSS: `index.html:2278-2280` `display:none` → `.show{display:flex}` + `opacity 0→1`（`transition:opacity .25s`）
  - **カードに transform scale が無い**（フェードのみ・0.25s）
- JS: 開く `index.html:3560` `openBgPick(){ $("gcBgPick").classList.add("show"); }`
- JS: 閉じる `index.html:3561` `closeBgPick(){ $("gcBgPick").classList.remove("show"); }`
- 背景タップで閉じる: `index.html:3903`

### 3. `gcConnect`（連携プロンプト）= 未対応（scale なし）
- HTML: `index.html:2596` `<div id="gcConnect">`。明確な単一カードは無く、`.gc-conn-top`（アバター＋名前）と
  `.gc-conn-go`（ボタン）が縦並び（CSS `2206-2214`）
- CSS: `index.html:2203-2205` `display:none` → `.show{display:flex; opacity:1}`（`transition:opacity .45s`、フェードのみ）
- JS: 開く `index.html:3386` `$("gcConnect").classList.add("show");`
- JS: 閉じる `index.html:3389`（`connect`）/ `3390`（`reject`）で `classList.remove("show")`

### 参考: 既に「vis+RAF + scale」で正しく動いている実装（コピー元の手本）
- `gcAcct`（アカウント詳細カード）
  - CSS: `index.html:2218-2226`
    - `2221`: `#gcAcct.vis{ display:flex; }`（表示用クラス）
    - `2222`: `#gcAcct.show{ opacity:1; }`（アニメ用クラス）
    - `2225`: `.gc-acct-card{ ... transform:scale(.9); transition:transform .5s var(--gc-ease); }`
    - `2226`: `#gcAcct.show .gc-acct-card{ transform:scale(1); }`
  - JS: `index.html:3257` `acctShow(){ var a=$("gcAcct"); a.classList.add("vis"); requestAnimationFrame(function(){ a.classList.add("show"); }); }`
  - JS: `index.html:3258` `acctHideEl(){ var a=$("gcAcct"); a.classList.remove("show"); setTimeout(function(){ a.classList.remove("vis","haspost"); },500); }`
  - **これがこのコードベースの推奨パターン**（`.9→1`・vis で display、show で opacity/transform、閉じは setTimeout で display を遅延除去）。

## 実装手順（具体的・順序立て・コード断片可）
方針: `gcAcct`（vis+RAF）パターンに揃え、未対応の `gcBgPick` / `gcConnect` に scale を足す。
`gcProfEdit` は既に scale 済みのため、仕様統一（`.84`→`.9`、card を ease に）だけ任意で実施。

### A. CSS を vis+show 2クラス化する（`gcBgPick` の例）
現状 `index.html:2278-2280`:
```css
#gcBgPick{ position:fixed; inset:0; z-index:9500; display:none; align-items:center; justify-content:center;
  background:rgba(0,0,0,.4); ... opacity:0; transition:opacity .25s var(--gc-ease); }
#gcBgPick.show{ display:flex; opacity:1; }
```
これを次のように書き換える（`display` は `.vis`、見た目は `.show`、card に scale を追加）:
```css
#gcBgPick{ position:fixed; inset:0; z-index:9500; display:none; align-items:center; justify-content:center;
  background:rgba(0,0,0,.4); -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px);
  opacity:0; transition:opacity .3s var(--gc-ease); }
#gcBgPick.vis{ display:flex; }                 /* RAF で1フレ後に .show を足す前提 */
#gcBgPick.show{ opacity:1; }
.gc-bgpick-card{ /* 既存定義はそのまま + 下記を追記 */
  transform:scale(.9); transition:transform .3s var(--gc-ease); }
#gcBgPick.show .gc-bgpick-card{ transform:scale(1); }
```

### B. JS の開閉を vis+RAF に直す（`gcBgPick` 既存 `index.html:3560-3561`）
```js
function openBgPick(){
  var a=$("gcBgPick"); if(!a) return;
  a.classList.add("vis");
  requestAnimationFrame(function(){ a.classList.add("show"); }); // 1フレ後にtransition発火
}
function closeBgPick(){
  var a=$("gcBgPick"); if(!a) return;
  a.classList.remove("show");
  setTimeout(function(){ a.classList.remove("vis"); }, 300);     // 0.3s後にdisplay除去
}
```
ポイント: `add("vis")` で `display:flex` にした「直後の同フレーム」では transition が走らないので、
必ず `requestAnimationFrame` を1回はさんで次フレームで `show` を足す。
（コードベース内 `index.html:3057`/`3067`/`3257`/`3650` 等で同じ RAF パターンを使用。`3650` は二重RAF。）

### C. `gcConnect` も同じ要領
- CSS `index.html:2203-2205` の `.show{display:flex; opacity:1}` を
  `.vis{display:flex}` + `.show{opacity:1}` に分離し、`.gc-conn-top` 等にカード scale を付ける
  （単一カードが無いので、ラッパ `<div class="gc-conn-card">` を1枚かませて、それに scale を当てるのが綺麗）。
- JS: 開く `3386`、閉じる `3389`/`3390` を上記 `open/close` 同様に `vis`→RAF→`show` / `remove show`→`setTimeout remove vis` に置換。

### D. `gcProfEdit`（任意・仕様厳密化）
既に `index.html:2181-2184` で scale 済みなので、本フェーズ仕様（`.9→1`・`0.3s ease`）に厳密合わせするなら:
- `2183` の `.gc-pe-card{ transform:scale(.84); transition:transform .3s var(--gc-spring); }` を
  `scale(.9)` / `var(--gc-ease)` に変更（spring のオーバーシュートを止めたい場合のみ）。
- JS（`3090`/`3098`/`3099`）は `.show` トグルのままで OK（CSS が visibility 遅延で display 相当を担うため RAF 不要）。

## 対象ファイル/関数
すべて `/Users/s_users/Downloads/chat-app/index.html`:
- CSS: `2096-2098`（gcProfEdit base）、`2181-2184`（gcProfEdit/Gate/Handoff の scale 済みブロック）、
  `2203-2205`（gcConnect）、`2218-2226`（gcAcct=手本）、`2278-2281`（gcBgPick）
- JS 関数:
  - `openProfEdit`（`3085`）/ `setupProfEdit`（`3092`、閉じ処理 `3098-3099`）
  - `openBgPick`（`3560`）/ `closeBgPick`（`3561`）/ 背景タップ閉じ（`3903`）
  - `gcConnect` 開閉インライン（`3386` / `3389` connect / `3390` reject）
  - 手本: `acctShow`（`3257`）/ `acctHideEl`（`3258`）
- 共通: `--gc-ease`（`1818`）/ `--gc-spring`（`1819`）
- 注意: `index.html` は `build-index.mjs`（`/Users/s_users/Downloads/chat-app/build-index.mjs`）でビルドされる場合があるため、
  `index-extras.css` / `index-s2s.css` 等の分割ソースが本体かは「要確認」（grep ヒットは index.html 内なので直接編集で足りる想定だが、ビルド上書きに注意）。

## 注意点・落とし穴
- **display:none では transition が走らない**: `add("vis")`（display付与）と `add("show")`（opacity/transform）を
  同フレームで一緒に付けると、ブラウザが初期スタイルを「観測」できずアニメ無しでパッと出る。
  → 必ず `requestAnimationFrame` を1回（不安なら二重 RAF）はさむ。`index.html:3650` は二重 RAF の前例。
- **閉じる時に display を即 none にしない**: `remove("show")` の瞬間に display を消すと出口アニメが見えない。
  → `setTimeout(... , 300)` で transition 完了後に `remove("vis")`（手本 `acctHideEl` は 500ms）。
  ms はCSS transition の秒数と必ず一致させる（0.3s → 300）。
- **gcProfEdit は別方式（visibility 遅延）で既に動いている**: ここだけ vis+RAF ではなく
  `transition:... , visibility 0s linear .3s`（`index.html:2181`）で出口を遅延させている。
  二重に vis+RAF を足すと競合するので、`gcProfEdit` は既存方式のまま触らないのが安全。
- **scale 値とイージングの不統一**: 既存は `gcProfEdit/Gate/Handoff` が `.84`+`--gc-spring`、`gcAcct` が `.9`+`--gc-ease`。
  本フェーズ仕様は `.9`+ease。どれを正にするかを決めて統一する（混在すると見た目がバラつく）。「要確認」。
- **transform-origin**: 中央表示カードは既定（center）でよいが、`gcConnect` は左寄せレイアウト（`align-items:flex-start`）なので
  scale の原点が気になる場合は `transform-origin` を明示。
- **背景タップ閉じのイベント**: `gcProfEdit:3099` / `gcBgPick:3903` は `if(e.target===this)` で背景判定。
  close 関数経由に統一しておくと vis 除去の setTimeout を1箇所にまとめられる。
- **pointer-events**: フェード中にクリックを拾わせたくないので、`gcProfEdit` 同様 base で `pointer-events:none`、
  `.show` で `auto` にするのが安全（gcBgPick/gcConnect には現状無いので追加検討）。

## 検証方法（headless/実機）
このリポジトリは Netlify 配信の PWA（メモリ `chat-app-shake-to-shake.md` 参照）。検索系は Shadow DOM/iframe 厳禁の注意あり。

- ローカル起動: リポジトリ直下で簡易サーバ（例 `python3 -m http.server`）を立て、`index.html` を開く。
- headless（視覚確認）: Chrome/Playwright で対象ダイヤログを開閉し、開閉の各フレームで
  `getComputedStyle(card).transform`（`matrix(...)` の scale 成分）と `opacity` をサンプリングし、
  0→1 / .9→1 へ 0.3s かけて遷移しているかを確認。`prefers-reduced-motion` でも壊れないか確認。
- DevTools 手動: 要素に `.vis` だけ付けた状態でリフローを挟まず `.show` を付け、アニメが走ること、
  および `.show` だけ外して 300ms 後に `display:none` へ戻ることを確認。
- 実機（iOS PWA）: Safari「ホームに追加」後、プロフィール変更/背景ピッカー/連携を実際に開閉し、
  低リフレッシュ時もカクつかないか、閉じる瞬間に一瞬パッと消えないか（display 即 none のバグ）を目視。
- メモリのラボ手段: `iOS HTML Lab`（`~/work/ios-html-lab`）や `composer-verify-lab` のiframe枠検証が使える（同一オリジン前提）。

## 優先度・工数・依存
- 優先度: **medium**（既存の `gcProfEdit` は出/消とも動作済みのため緊急ではない。
  未対応の `gcBgPick`/`gcConnect` への scale 付与＝主に「統一」目的の磨き込み）。
- 工数: **S〜M**。`gcBgPick` は CSS数行 + JS 2関数で S。`gcConnect` はカードラッパ追加が要るため小 M。
  全体（仕様統一込み）でも 1ファイル内の局所編集。
- 依存:
  - 既存 vis+RAF パターン（`acctShow`/`acctHideEl`、`index.html:3257-3258`）に倣う＝先行実装あり。
  - CSS 変数 `--gc-ease`/`--gc-spring`（`1818-1819`）に依存。
  - `build-index.mjs` によるビルド有無は要確認（直接 index.html 編集で足りる想定だが、再ビルドで上書きされないか確認）。
  - 他フェーズへの依存なし（独立して実装可能）。
