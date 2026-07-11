# 背景切り替えを確実に動作＋ボタンの枠を消す

対象アプリ: Shake to Shake / Meet to Meet（`/Users/s_users/Downloads/chat-app/index.html`）
チャットルームの背景（globe の上に重ねる `#gcChatBg`）を、0.2秒長押しで開くピッカーから Off / Blur / Color に切り替える機能。

## 目的

1. 0.2s 長押し → ピッカー（Off / Blur / Color）→ `#gcChatBg` に確実に反映される経路を保証する。
2. ピッカーのボタン（`.gc-bgpick-opt`）と色入力（`#gcBgColor`）に出る「枠（border / focus ring / タップハイライト）」を完全に消す。

## 現状（コード調査の結果・該当ファイル:行）

すべて `index.html` 内。

### CSS（スタイル）
- `#gcChatBg`（背景レイヤー本体）: `index.html:2275`
  `position:absolute; inset:0; z-index:0; pointer-events:none; transition:background .3s ..., backdrop-filter .3s ...`
- `#gcChatBg.blur`: `index.html:2276`
  `backdrop-filter:blur(22px) saturate(150%); background:rgba(0,0,0,.18)`
- `#gcBgPick`（ピッカー全画面オーバーレイ）: `index.html:2278-2279`、表示は `#gcBgPick.show{ display:flex; opacity:1; }`（`index.html:2280`）
- `.gc-bgpick-card`（カード）: `index.html:2281`
  → ここに `border:1px solid rgba(255,255,255,.12)` と `box-shadow:0 24px 60px ...` あり（カード自体の枠）。
- `.gc-bgpick-opt`（Off/Blur/Color ボタン）: `index.html:2284`
  → **すでに `border:none`**。`:active{ transform:scale(.93) }`（`index.html:2285`）。
  → ただし `outline` リセットも `-webkit-tap-highlight-color` リセットも個別指定なし。
- `#gcBgColor`（色入力）: `index.html:2286`
  → **すでに `border:0; padding:0; opacity:0`**、1px サイズで画面外見えず（OSパネルを開くためのトリガ用の隠し input）。

補足: グローバルな `-webkit-tap-highlight-color:transparent; touch-action:none;` は `index.html:46` にあるが、これは `html/body`（ルートコンテナ）側のブロックで、`*`（全要素）への適用ではない。`button{outline:none}` のようなグローバル button リセットは存在しない（`grep` で確認済み。`outline:none` は `.gc-input` 等の入力欄個別にのみ存在）。

### HTML（マークアップ）
- 背景レイヤー: `<div id="gcChatBg"></div>` … `index.html:2469`（`#gcChat` セクション内、`.gc-card` の前）
- ピッカー本体: `index.html:2480-2490`
  ```html
  <div id="gcBgPick">
    <div class="gc-bgpick-card">
      <div class="gc-bgpick-title">背景</div>
      <div class="gc-bgpick-opts">
        <button class="gc-bgpick-opt" data-bg="off">Off</button>
        <button class="gc-bgpick-opt" data-bg="blur">Blur</button>
        <button class="gc-bgpick-opt" data-bg="color">Color</button>
      </div>
    </div>
    <input type="color" id="gcBgColor" value="#1c1c2e">
  </div>
  ```

### JS（ロジック）
- `applyChatBg()`: `index.html:3549-3552`
  ```js
  function applyChatBg(){ var bg=$("gcChatBg"); if(!bg) return; var c=prof.chatBg||{type:"off"};
    bg.classList.remove("blur"); bg.style.background="";
    if(c.type==="blur"){ bg.classList.add("blur"); }
    else if(c.type==="color"){ bg.style.background=c.color||"#1c1c2e"; } }
  ```
- `setupChatBgLongPress()`: `index.html:3554-3559`
  - `#gcChat` 内 `.gc-card` に `pointerdown` で 200ms タイマー設定。`.gc-msg,.gc-chat-input,.gc-chat-head,button,input,...` 上では発火しない（`closest` で除外）。
  - `pointermove` で移動量 10px 超なら `_bgMoved=true` でキャンセル。`pointerup`/`pointercancel` でタイマークリア。
  - 200ms 経過かつ未移動なら `haptic(); openBgPick();`
- `openBgPick()` / `closeBgPick()`: `index.html:3560-3561`（`#gcBgPick` の `show` クラス着脱）
- ボタン配線: `index.html:3898-3904`（初期化 `setup()` 内）
  ```js
  [].forEach.call(document.querySelectorAll(".gc-bgpick-opt"),function(b){ b.onclick=function(ev){ ev.stopPropagation(); var t=b.getAttribute("data-bg");
    if(t==="color"){ try{ $("gcBgColor").click(); }catch(_){} return; }   // OS標準カラーパネルを開く
    prof.chatBg={type:t}; save(); applyChatBg(); haptic(); closeBgPick(); }; });
  if($("gcBgColor")) $("gcBgColor").onchange=function(){ prof.chatBg={type:"color", color:$("gcBgColor").value}; save(); applyChatBg(); haptic(); closeBgPick(); };
  $("gcBgPick").addEventListener("click",function(e){ if(e.target===this) closeBgPick(); });
  ```
- 永続化: `prof.chatBg` を `save()`（`index.html:2685`、`localStorage.setItem(LS, JSON.stringify(prof))`）で保存。`var prof=load();`（`index.html:2682`）。
- `applyChatBg()` 呼び出し箇所: `openChat()` 内の `show("gcChat"); applyChatBg();`（`index.html:3568`）と上記ボタン/色 onchange のみ（`grep` で全件確認、計4箇所）。

### 経路の判定（確実に効くか）
- 0.2s 長押し → 開く → Off/Blur/Color → `#gcChatBg` 反映 の経路は**コード上は成立している**。
  - Off: `prof.chatBg={type:"off"}` → `applyChatBg` が `blur` クラス除去＋`background=""` でリセット。
  - Blur: `type:"blur"` → `.blur` クラス付与（CSS で backdrop-filter）。
  - Color: ボタン押下では即適用せず `$("gcBgColor").click()` で OS カラーパネルを開き、`onchange` で `type:"color", color` を保存して `applyChatBg`（`bg.style.background=color`）。
- 注意点（実機要確認）として残るのは:
  1. `<input type="color">` の `.click()` が **iOS Safari / PWA でカラーパネルを開くか**は OS 依存。iOS では `type=color` のサポートが限定的で、`.click()` で必ず標準パネルが開く保証はない（**要確認**）。
  2. Color を選んでも `closeBgPick()` がボタンの分岐内で呼ばれず（`return` で抜ける）、ピッカーは開いたまま OS パネルが上に出る設計。`onchange` 確定時に閉じる。キャンセル時はピッカーが開いたままになる（背景タップで閉じる）。
  3. `#gcChatBg` は `z-index:0`、`.gc-card` は `z-index:1`（`index.html:2274`）。背景は `pointer-events:none` で、`.gc-card`（透明）が長押しを受ける構造。globe 自体は別レイヤー（`#globeWrap`）なので、背景色/Blur は globe とチャット文字の「間」に入る。これは意図どおり。

## 実装手順（具体的・順序立て・コード断片可）

> 結論: 背景切り替えの経路自体はほぼ動く。タスクの主眼は (A) ボタンの「枠」除去の確実化、(B) Color の iOS 動作担保 と Off/Blur の確実反映の補強。

### 手順1: ピッカーボタンの「枠」を確実に消す（CSS）
`.gc-bgpick-opt`（`index.html:2284`）は `border:none` 済みだが、フォーカスリング（`outline`）とタップハイライトが「枠」に見えるケースを潰す。下記を追記/置換する。

```css
.gc-bgpick-opt{
  background:rgba(255,255,255,.12); border:none; outline:none;
  -webkit-tap-highlight-color:transparent; -webkit-appearance:none; appearance:none;
  color:#fff; font-size:16px; font-weight:600; padding:14px 22px; border-radius:16px;
  cursor:pointer; transition:transform .14s var(--gc-spring);
}
.gc-bgpick-opt:focus, .gc-bgpick-opt:focus-visible{ outline:none; box-shadow:none; }
.gc-bgpick-opt:active{ transform:scale(.93); }
```

ポイント:
- `outline:none` と `:focus-visible{ outline:none }` … クリック後のフォーカスリング（青/白の縁）を除去。
- `-webkit-tap-highlight-color:transparent` … iOS のタップ時グレー矩形を除去。
- `-webkit-appearance:none; appearance:none` … ネイティブ button の縁取りを除去。

### 手順2:（任意）色入力ボタンの枠も明示
`#gcBgColor`（`index.html:2286`）は `border:0` 済みだが、`type=color` のスウォッチ枠が見える場合に備える。

```css
#gcBgColor{ position:fixed; left:50%; bottom:34%; width:1px; height:1px; opacity:0; border:0; padding:0;
  -webkit-appearance:none; appearance:none; outline:none; }
#gcBgColor::-webkit-color-swatch-wrapper{ padding:0; }
#gcBgColor::-webkit-color-swatch{ border:none; }
```
※ ただし opacity:0 + 1px なので実害は小さい。優先度低。

### 手順3:（任意）カード自体の枠を消すか判断
「ボタンの枠」が指すのが個別ボタンではなく `.gc-bgpick-card` の `border:1px solid rgba(255,255,255,.12)`（`index.html:2281`）の場合は、そこを `border:none` にする。**どちらを指すかはユーザに要確認**。本タスクの指示文（`.gc-bgpick-opt` と `#gcBgColor` のボタン）どおりなら手順1・2で足りる。

### 手順4: 背景反映の確実化（必要時のみ）
現状でも反映されるが、堅牢化したい場合:
- Off/Blur 即時反映は OK。Color の iOS 非対応に備え、`type=color` が使えない環境向けにプリセット色ボタン（例: 数色のスウォッチ）への切替も検討（**iOS 実機確認の結果次第**）。
- アプリ起動直後（`openChat` を通らず復元表示するパス）でも `applyChatBg()` を呼ぶ必要がある場合は要確認だが、現状チャット表示は必ず `openChat()` 経由（`index.html:3568` で `applyChatBg()` 実行）なので追加不要。

## 対象ファイル/関数

- ファイル: `/Users/s_users/Downloads/chat-app/index.html`（単一ファイル PWA。ビルドは `build-index.mjs` 経由で `classic.html` 等も出るが、編集元はこの `index.html`）
- CSS: `.gc-bgpick-opt`（`:2284-2285`）、`#gcBgColor`（`:2286`）、必要なら `.gc-bgpick-card`（`:2281`）
- HTML: `#gcBgPick` ブロック（`:2480-2490`）、`#gcChatBg`（`:2469`）
- JS: `applyChatBg()`（`:3549`）、`setupChatBgLongPress()`（`:3554`）、`openBgPick()`/`closeBgPick()`（`:3560-3561`）、ボタン配線（`:3898-3904`）
- 永続化: `save()`（`:2685`）、`prof`（`:2682`）

## 注意点・落とし穴

1. **「枠」の正体が複数あり得る**: ① `.gc-bgpick-opt` の border（→ 既に none）、② focus ring（outline・未リセット）、③ iOS タップハイライト（個別未リセット）、④ カード `.gc-bgpick-card` の border。ユーザの「枠」がどれを指すか要確認。本指示はボタン側なので ②③（と既存①）を潰す手順1が本命。
2. **グローバル tap-highlight は body 側のみ**（`index.html:46`）で全要素には及ばない。ボタンに個別指定が要る。
3. **`<input type="color">` の iOS 挙動は未保証**。`$("gcBgColor").click()` で OS パネルが開く前提だが、iOS Safari / ホーム追加 PWA では開かない可能性（**実機要確認**）。開かない場合は Color が無反応に見える＝「背景切り替えが効かない」と認識される最大の落とし穴。
4. Color ボタンは押下時に `closeBgPick()` を呼ばない（`return` で抜ける）設計。`onchange` 未発火（パネルをキャンセル）だとピッカーが残る。仕様として許容か要判断。
5. 長押しは `.gc-card` の空き領域でのみ発火（`.gc-msg/.gc-chat-input/.gc-chat-head/button/input` 等は `closest` 除外、`index.html:3555`）。メッセージが画面を埋めていると長押しできる空白が少ない＝発火しづらい点に注意。
6. 編集は元ファイル `index.html` に対して行い、その後ビルド（`build-index.mjs`）/デプロイ（push origin main → Netlify）が必要（メモリの運用に従う）。`classic.html` を直接いじらない。

## 検証方法（headless / 実機）

### headless（DOM・関数の存在/分岐）
- Off/Blur の反映は headless で確認可能。`#gcChatBg` の class / inline style を見る。
  ```js
  // ピッカー配線後、Blur を押した想定
  document.querySelector('.gc-bgpick-opt[data-bg="blur"]').click();
  // 期待: document.getElementById('gcChatBg').classList.contains('blur') === true
  document.querySelector('.gc-bgpick-opt[data-bg="off"]').click();
  // 期待: classList に 'blur' なし & style.background === ''
  ```
- 枠除去は computed style で確認:
  ```js
  var b=document.querySelector('.gc-bgpick-opt');
  getComputedStyle(b).borderStyle;   // 期待 'none'
  getComputedStyle(b).outlineStyle;  // 期待 'none'（focus 時も）
  ```
- macOS のスナップショット検証はメモリ既存手法（`/tmp` の Swift スナップショット系）を流用可。

### 実機（iPhone PWA / 必須）
- **Color の OS カラーパネルが開くか**（最重要・headless 不可）。開いた色を選び `#gcChatBg` の背景色が変わるか。
- 0.2s 長押しで `haptic()` が鳴りピッカーが開くか。移動 10px 超でキャンセルされるか。
- フォーカスリング/タップハイライトが Color/Off/Blur ボタンに出ないか（タップ直後の見た目）。
- 設定後にチャットを開き直して（`openChat` → `applyChatBg`）背景が復元されるか（localStorage 永続化の確認）。

## 優先度・工数・依存

- 優先度: 中（meettomeet 系の UI 仕上げ。バグというより仕上げ/UX）。
- 工数: S（枠除去は CSS 数行。背景経路は既存で動作見込み）。ただし Color の iOS 実機確認が入ると +α。
- 依存: なし（独立して着手可）。実機検証フェーズと、デプロイ（push origin main → Netlify、build-index.mjs）に依存。
