# 下部までコンテンツ表示＋下部シャドウ削除＋アクティビティ終了ボタン

> 対象アプリ: **meettomeet.html**（旧クラシック版チャット = Meet to Meet）。
> このフェーズは `index.html`（globe-chat メインページ）とは**別系統**。`index.html` は globe.css を使う別アプリなので触らない。
> ビルド: `meettomeet.html`（ソース）の `<style>` を `build-index.mjs` が `shaketoshake.css` に外出しし、`classic.html` を生成する。
> したがって **CSS の本体は `shaketoshake.css`**（git 追跡される実成果物）。ソース編集後は `node build-index.mjs` を再実行してコミットする運用（build-index.mjs ヘッダ参照）。
> 注: 現状 `meettomeet.html`（342行）はインライン `<style>` を持たず `shaketoshake.css` を `<link>` 参照する形になっている（meettomeet.html:16）。`<style id="userCss">`（meettomeet.html:17）はユーザCSS注入用の**空タグ**で、レイアウトには関与しない。

## 目的

1. **下部までコンテンツを表示**: ホーム画面（`#scrHome`）の会話カード一覧が、画面の真下（safe-area 端）まで自然に伸びるようにする。現状は下端付近に大きな余白が残り、最後の行が浮いて見える。
2. **下部シャドウ/グラデーションの削除**: 画面下部に出ている「影/グラデーション」を消す。候補は2つ（下記「現状」で切り分け）。ユーザが「下部シャドウ」と呼ぶ対象を特定してから消す。
3. **アクティビティの「終了」ボタン**: 稼働中アプリを終了する `act-quit`（"終了"）と、グループから抜ける `chLeave`（"抜ける"）の2系統がある。どちらを指すか確定し、挙動を調整する。

## 現状（コード調査の結果・該当ファイル:行）

### A. 下部までコンテンツが出ない原因

- ホーム一覧は `.list#convList`（meettomeet.html:47）。CSS は **shaketoshake.css:110**:
  ```css
  .list{ display:grid; grid-template-columns:repeat(2,1fr); gap:14px; align-content:start;
         padding:12px 14px calc(110px + var(--safe-b)); min-height:calc(100% + 1px); }
  ```
  - **下パディング `110px`** が常に確保されている。これは下端に浮く3ボタン（`.home-search` / `.me-pill` / `.fab`）の真上にカードが潜り込まないための余白。**これが「下部までコンテンツが出ない」直接原因**。
  - `var(--safe-b)` は **`:root` で `--safe-b:0px`**（shaketoshake.css:6）。安全領域は `#app` の `padding-bottom:env(safe-area-inset-bottom)` で**一元管理**されており、個別要素の `var(--safe-b)` は二重適用回避のため 0。よって `.list` 下端の実効インセットは「110px ＋ #app の safe-area」になる。
- `#scrHome` は自然スクロール（shaketoshake.css:106）:
  ```css
  #scrHome{ display:block; overflow-y:scroll; overflow-x:hidden; -webkit-overflow-scrolling:touch;
            overscroll-behavior-y:contain; scrollbar-width:none; }
  ```
  - `min-height:calc(100% + 1px)`（list 側, :110）は「空でも+1pxでオーバーフロー→iOSゴムバウンス」を出すための意図的なもの。**消すとバウンスが死ぬ**ので残す。
- `#app` 自体（shaketoshake.css:26）が `position:fixed; top/right/bottom/left:0; min-height:100dvh; overflow:hidden` で安全領域 padding を全方位に持つ。`html,body{ height:100% }`（:17）。ビューポート高さの扱いはここで完結している。
- 結論: **コンテンツが下端まで届かないのは `.list` の `110px` 下パディングが原因**。ただしこれは「3ボタンに隠れない」ための仕様であり、安易に 0 にすると最後のカードがボタンに被る。→ 実装手順で「ボタン高さ分だけ縮める／スクロール末尾でのみ詰める」案を提示。

### B. 下部の「シャドウ/グラデーション」候補（どちらを消すか要確定）

- **候補1（グラデーション）: アプリ背景 `--app-bg`**（shaketoshake.css:10–13、適用は body :22 と `#app` :26）:
  ```css
  --app-bg:
    radial-gradient(1000px 700px at 12% -10%, #5ac8fa22, transparent 60%),
    radial-gradient(900px 700px at 105% 110%, #af52de22, transparent 60%),  /* ← 右下に紫グロー */
    linear-gradient(180deg,#fff,var(--bg-2));                               /* ← 上白→下グレーの縦グラデ */
  ```
  - **画面下部の淡いグラデ感はこの2つ**（右下の紫 radial と、下方向の `#fff→#f4f5f9` linear）。ユーザの言う「下部グラデーション(shadow)」がこれなら、ここを単色（`var(--bg)`=`#ffffff`）化する。
- **候補2（シャドウ）: 下端の浮きボタンの box-shadow**:
  - `.me-pill`（shaketoshake.css:183）`box-shadow:0 14px 34px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.6)`
  - `.fab`（shaketoshake.css:194）`box-shadow:0 18px 40px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.6)`
  - `.gb-make`（shaketoshake.css:143）`box-shadow:0 14px 34px -10px rgba(10,132,255,.5)`（グループ作成バーの青ボタン）
  - これらが下端に**ドロップシャドウ**を落としている。ユーザの言う「下部シャドウ」がこれならボタン側の `box-shadow` を弱める/消す。
- **`#scrHome` 自体には専用の下部 scrim / フェード / `::after` グラデは存在しない**（grep 済み: home/scrHome/list/conv に紐づく `::after`+gradient なし）。よって「謎の黒い帯」のような要素は無く、上記いずれかが正体。**まずユーザに実機スクショで対象を確定**（要確認）。

### C. アクティビティ「終了」系ボタン（2系統）

1. **グループから抜ける（`chLeave` "抜ける"）**
   - DOM: `<button class="ch-leave" id="chLeave" title="グループから抜ける">抜ける</button>`（meettomeet.html:64、チャットヘッダ内）。
   - CSS: shaketoshake.css:145–146（`.ch-leave{ display:none; ... }` / `.ch-leave.show{ display:block; }`）。
   - 表示制御: app.js:574（グループを開いた時 `lv.classList.add('show'); lv.onclick = () => leaveGroup(p);`）、app.js:575（非グループ時 `remove('show')`）。
   - ハンドラ: **`leaveGroup(g)`**（app.js:414–422）。`confirm('このグループから抜けますか？')`→Firebase の `groups/<g>/m/<uid>` と `userGroups/<uid>/<g>` を null 更新→ローカル `groups` 削除→`scrHome` へ戻る→`haptic.error(); toast('グループから抜けました')`。

2. **アクティビティ（稼働中アプリ）の終了（`act-quit` "終了"）**
   - 生成元: **`window.__openActivity`**（app.js:1536–1560）。オーバーレイ `#actOv`（`.act-ov`）を動的生成し、`#actList` に行を並べる。
   - 行: 固定で `会話` / `検索` の2行＋`window.__openedApps`（app.js:1469 で起動時に push 記録）の各アプリ。
   - 終了ボタン: **app.js:1554**。`it.app` の行にだけ `.act-quit`（"終了"）を追加。`onclick`:
     ```js
     if (!confirm('作業中の内容は失われます')) return;
     window.__openedApps = (window.__openedApps||[]).filter(a => a.url !== it.url);
     if (window.__appState && window.__appState.url === it.url) { /* appOv._closeApp() */ }
     _actRender();
     ```
   - 注意: **`会話` と `検索` の固定行には終了ボタンが出ない**（`it.app` が無いため、app.js:1554 の if が false）。「会話/検索も終了できるようにしたい」場合はここを拡張する。
   - CSS: `.act-ov`/`.act-card`/`.act-quit`/`.act-close` = shaketoshake.css:366–375。背景タップで閉じる挙動は index-extras.js:336。
   - **要確認**: `window.__openActivity()` を呼ぶ UI トリガ（ボタン/長押し）が app.js / index-extras.js / index-s2s.js / meettomeet.html 内に見当たらない（外出し spotlight テンプレ文字列内のヒットは誤検出）。アプリシェル（appOv 周り）か別ジェスチャから呼ばれている可能性が高い。**起動経路は実機 or appOv 実装で要確認**。

## 実装手順（具体的・順序立て・コード断片可）

> 編集対象は **`meettomeet.html`（ソース）と `shaketoshake.css`**。CSS を直接 `shaketoshake.css` に書いてもよいが、`build-index.mjs` の運用上、CSS の正本は「meettomeet.html のインライン `<style>`」を想定している。現状 meettomeet.html はインライン style を持たないため、**当面は `shaketoshake.css` を直接編集**し、後で build の正本化を整理する（要確認: 現行の build 入力が meettomeet.html の `<style>` 前提なので、CSS を meettomeet 側に戻すかは別途判断）。

### 手順1: 対象（B のどのシャドウ/グラデか）を確定
- 実機スクショで「下部シャドウ」が **背景グラデ（候補1）** か **ボタンのドロップシャドウ（候補2）** か確定する。以降は両対応で記す。

### 手順2: 下部までコンテンツを表示（A）
`shaketoshake.css:110` の `.list` 下パディングを、ボタンに被らない最小値へ調整する。完全に 0 にすると最後のカードが `.fab`/`.me-pill`（高さ約56–60px＋下端22px）に隠れるので、**「ボタン帯の実高さ + 余白」だけ確保**するのが安全:
```css
/* before */
.list{ ... padding:12px 14px calc(110px + var(--safe-b)); ... }
/* after: ボタン帯ぶんだけに圧縮（最後のカードがボタンに被らない最小値）。
   ボタン下端は bottom:max(safe,22px)、高さ最大60px → 22+60+余白 ≒ 90px 目安 */
.list{ ... padding:12px 14px calc(90px + env(safe-area-inset-bottom)); ... }
```
- `var(--safe-b)`（=0）ではなく `env(safe-area-inset-bottom)` を直接使うと、ノッチ機で最後の行がさらに下まで届く。`#app` が既に safe-area padding を持つため**二重に入る**点に注意（重ねたくないなら `var(--safe-b)` のまま=0 を維持）。→ どちらが正かは実機で確認（要確認）。
- 「カードを本当に下端ギリギリまで」なら、ボタン側を**カードの上にオーバーレイ**したまま、`.list` 下パディングを `env(safe-area-inset-bottom)+12px` 程度まで詰め、ボタンが被る最下段だけ視覚許容する案もある（UX判断）。

### 手順3-a: 背景グラデを消す場合（候補1）
`shaketoshake.css:10–13` の `--app-bg` を単色化、または下方向 linear/右下 radial を除去:
```css
/* 完全フラット（白）にする例 */
--app-bg: var(--bg);   /* #ffffff。radial/linear を全廃 */
/* もしくは上のグローだけ残し、下のグラデ/紫グローを消す */
--app-bg:
  radial-gradient(1000px 700px at 12% -10%, #5ac8fa22, transparent 60%);
```
- `--app-bg` は body(:22) と `#app`(:26) の両方で使われるので一箇所変更で両方反映。

### 手順3-b: ボタンのドロップシャドウを消す場合（候補2）
該当ボタンの `box-shadow` から「下方向ドロップ影」だけ削る（`inset` のハイライトは残すと質感維持）:
```css
/* shaketoshake.css:183 .me-pill */
.me-pill{ ...; box-shadow:inset 0 1px 0 rgba(255,255,255,.6); }      /* 0 14px 34px の影を除去 */
/* shaketoshake.css:194 .fab */
.fab{ ...; box-shadow:inset 0 1px 0 rgba(255,255,255,.6); }          /* 0 18px 40px の影を除去 */
/* shaketoshake.css:143 .gb-make（グループ作成バー） */
.gb-make{ ...; box-shadow:none; }
```

### 手順4: アクティビティ終了ボタンの調整（C）
- 「会話 / 検索 も終了/再読込できるようにする」場合、app.js:1552–1556 の `items.forEach` を拡張し、固定行にも用途別ボタンを付ける。例（会話=チャットリセット、検索=検索オーバーレイ閉じ など、対応関数は別途定義が必要なので**要確認**）:
  ```js
  // app.js:1554 付近。it.app だけでなく固定行にもボタンを付ける場合の骨子
  if (it.app) { /* 既存の "終了" */ }
  else { /* 会話/検索 用ボタン。例: 再読込ボタンを足す等。挙動は要設計 */ }
  ```
- 「抜ける」ボタンの文言/挙動変更は app.js:414（`leaveGroup`）と app.js:574（表示・onclick 配線）を編集。`confirm()` 文言は app.js:416。
- 終了確認ダイアログ文言（`'作業中の内容は失われます'`）変更は app.js:1554。

### 手順5: 再ビルド（CSS をソースへ戻した場合のみ）
`shaketoshake.css` を直接編集したなら再ビルド不要（成果物を直接いじったため）。もし将来 CSS を meettomeet.html の `<style>` に正本化したら:
```bash
node build-index.mjs   # shaketoshake.css / classic.html を再生成
git diff --exit-code -- index.html shaketoshake.css spotlight-tpl.js  # フレッシュネス確認
```
（build-index.mjs:出力は classic.html。index.html は globe-chat で上書きされないよう別扱い）

## 対象ファイル/関数

| 対象 | ファイル:行 | 役割 |
|---|---|---|
| `.list` 下パディング | shaketoshake.css:110 | 下端までコンテンツが出ない元凶（110px） |
| `#scrHome` スクロール | shaketoshake.css:106 | 自然スクロール（バウンス維持） |
| `--app-bg` 背景グラデ | shaketoshake.css:10–13 (適用 :22, :26) | 下部グラデーション候補1 |
| `.me-pill` / `.fab` / `.gb-make` | shaketoshake.css:183 / 194 / 143 | 下部ドロップシャドウ候補2 |
| `--safe-b` / `--safe-t` | shaketoshake.css:6 | 個別要素では 0（safe-area は #app 一元管理 :26） |
| `#homeBar` 浮きボタン群 | meettomeet.html:314–324 | 下端 fixed ボタン（影の発生源） |
| `chLeave` "抜ける" | meettomeet.html:64 / shaketoshake.css:145–146 | グループ離脱ボタン |
| `leaveGroup(g)` | app.js:414–422 | グループ離脱ロジック |
| `chLeave` 表示配線 | app.js:574–575 | グループ時のみ表示・onclick |
| `__openActivity` | app.js:1536–1560 | アクティビティ・オーバーレイ生成 |
| `.act-quit` "終了" | app.js:1554 / shaketoshake.css:374 | 稼働アプリ終了ボタン |
| `__openedApps` 記録 | app.js:1469 | アプリ起動時に一覧へ push |
| アクティビティ背景タップ閉じ | index-extras.js:336 | act-ov クリックで閉じる |

## 注意点・落とし穴

- **`--safe-b` は 0**（shaketoshake.css:6）。CSS 内の `calc(... + var(--safe-b))` は実質「+0」。安全領域は `#app` の padding（:26）でしか入らない。安全領域ぶん下げたい時は `env(safe-area-inset-bottom)` を直接書くか #app 依存を理解した上で調整する（**二重適用に注意**）。
- **`.list { min-height:calc(100% + 1px) }` は消さない**（:110）。+1px はゼロ件でもゴムバウンスを出す意図。`overscroll-behavior-y:contain`（:106）も「none にするとバウンス自体が死ぬ」と明記。
- 下パディングを 0 にすると **最後のカードが `.fab`/`.me-pill`/`.home-search` の裏に潜る**（これらは `#app` 直下の `position:fixed`＝スクロールに乗らない）。完全 0 は不可、ボタン帯の高さぶんは残す。
- **`index.html` を触らない**。これは globe-chat の別アプリ（globe.css 系）。本フェーズの対象は meettomeet.html / shaketoshake.css / app.js のみ。
- `shaketoshake.css` は **build-index.mjs の出力でもあり git 追跡もされる**。CSS の正本を meettomeet.html `<style>` に戻すなら再ビルド必須。現状は直接編集が安全。
- アクティビティの **`会話`/`検索` 固定行には終了ボタンが付かない**（app.js:1554 の `if (it.app)`）。仕様変更時は対応関数の有無を要確認。
- **`__openActivity()` の起動トリガが本調査の4ファイルから見つからない**（要確認）。`appOv`（アプリシェル）または別ジェスチャ経由の可能性。終了ボタンの動作確認には、まずアプリを1つ起動して `__openedApps` に登録させる必要がある（app.js:1469）。

## 検証方法（headless / 実機）

- **headless（レイアウトのみ）**: ローカルで配信して DevTools のデバイス エミュレーション（iPhone, safe-area あり）で `#scrHome` を開き、会話カードを十分な件数追加して**最下段カードが画面下端まで来るか／ボタンに被らないか**を確認。`.list` の computed `padding-bottom` を Inspector で確認。
  ```bash
  # 例: 静的配信（Firebase/任意のサーバ）。ファイル直開きは firebase-config/lib 依存で動作不全になりうる
  python3 -m http.server 8080   # /Users/s_users/Downloads/chat-app で実行
  # → http://localhost:8080/meettomeet.html
  ```
- **背景グラデ確認**: DevTools で `body`/`#app` の `background` を見て `--app-bg` の radial/linear が期待通り消えているか。下部の紫グロー（`#af52de22 at 105% 110%`）が消えたか目視。
- **シャドウ確認**: `.me-pill`/`.fab`/`.gb-make` の computed `box-shadow` を確認。下端のドロップ影が消えているか目視。
- **アクティビティ終了（実機/エミュ）**:
  1. 何らかのアプリを開いて `window.__openedApps` に登録させる（Console で `window.__openedApps` を確認）。
  2. `window.__openActivity()` を Console から直接呼んでオーバーレイを表示（トリガ未特定のため当面これで検証）。
  3. アプリ行の「終了」を押し、confirm→該当アプリが `__openedApps` から消え、`appOv` が閉じる（`_closeApp`）ことを確認。
- **グループ離脱**: グループを作成→チャットを開き「抜ける」(`#chLeave`) が表示されることを確認→押下→confirm→`scrHome` へ戻り toast「グループから抜けました」。Firebase 接続時は `groups/<g>/m/<uid>` が削除されるか RTDB コンソールで確認。
- 実機（iPhone PWA）でのバウンス挙動とノッチ機 safe-area の効きは **実機必須**（headless では再現しきれない）。

## 優先度・工数・依存

- **優先度**: 中。レイアウトの体感品質に直結するが機能破壊ではない。
- **工数**: S–M。CSS 1–2行調整（下パディング＋シャドウ/グラデ）＝S。アクティビティの固定行へ終了/再読込を追加する拡張を含めると M。
- **依存**:
  - 「下部シャドウ」の対象確定（背景グラデ vs ボタン影）に**ユーザ確認が前提**（要確認）。
  - `__openActivity` の起動トリガ特定（appOv 周辺）— アクティビティ系を触る場合に必要（要確認）。
  - CSS 正本化（meettomeet.html `<style>` に戻すか）を決めるなら build-index.mjs 運用と整合させる。
