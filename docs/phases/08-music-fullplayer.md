# フルスクリーン音楽プレイヤー(アルバムカルーセル/EQ)

> 対象リポジトリ: `/Users/s_users/Downloads/chat-app`
> 参照UI: `/Users/s_users/Documents/iindex.html`(soundbite系フルプレイヤー実装)

## 目的

現状の `index.html` には iTunes 検索 + 30秒プレビューの**ミニ now-playing(`#gcNp`)**しか無い。
これを、参照ファイル `iindex.html` が持つ**フルスクリーン音楽プレイヤー**に拡張する:

- スワイプ式アルバムカルーセル(prev · current · next)
- Web Audio による実5バンドEQ + バンド毎レベルメーター
- スクラブバー(ドラッグ / 長押し早送り・巻き戻し)
- ぼかし背景・odometer風タイム表示・シャッフル/リピート
- ミニ now-playing をタップ → フルプレイヤーが下からせり上がる

つまり「ミニプレイヤー(現状) → フルスクリーンプレイヤー(参照UI)」へのスケールアップ。

---

## 現状(コード調査の結果・該当ファイル:行)

### index.html(現行・拡張対象)

すべて同一IIFE内。`var $=function(id){return document.getElementById(id);};` は **index.html:2686** で定義済(以降のコードはこの `$` を使う)。

| 要素 | 場所 | 内容 |
|---|---|---|
| `musicSearch(term)` | index.html:2955 | iTunes Search(fetch→JSONP→同一オリジンproxy `/itunes-api/search`)。`_mapTracks` で結果を整形 |
| `_mapTracks(arr)` | index.html:2953-2954 | **重要**: `{title, artist, art, preview}` の4フィールドだけに**間引く**(`art` は 100x100→300x300置換) |
| `playTrack(tr)` | index.html:2967-2973 | `audio.src=tr.preview` で再生。同じ曲再タップで pause。`#gcNp` を `show`+`pop`。`np-img/np-title/np-artist` を更新 |
| `setupAudio()` | index.html:2974-2981 | `#gcAudio` の play/pause/ended を購読。`#gcAvaFab` に `playing` 付与、`npRing` と `npIcon` を駆動。再生中 200ms毎に `npRing` 更新 |
| `npRing(p)` | index.html:2963-2964 | 進捗リング。ミニ側 `#ring-fg`(r=23, 定数 `NP_C=2π·23` @2962)とFAB側 `#gcPlayRingFg`(r=27)の両方の `strokeDashoffset` を更新 |
| `npIcon(playing)` | index.html:2965-2966 | `#np-play` の play/pause SVG差し替え |
| `npToggle` | index.html:3938-3940 | `#np-play` と `#np-inner` の onclick。audio を toggle するだけ(**フルプレイヤーを開く処理は無い**) |
| `setupAudio()` 呼び出し | index.html:3941 | 起動時に1回 |

ミニ now-playing マークアップ: **index.html:2496-2500**(`#gcSearch` セクション内)
```
<div class="gc-np" id="gcNp"><div class="np-inner" id="np-inner">
  <div class="ring-wrap"><svg class="np-ring" ...><circle ... id="ring-fg"></circle></svg><div class="np-thumb"><img id="np-img"></div></div>
  <div class="np-meta"><div class="np-title" id="np-title">—</div><div class="np-artist" id="np-artist"></div></div>
  <button class="np-play is-play" id="np-play">…play svg…</button>
</div></div>
```
audio要素: `<audio id="gcAudio" preload="none" playsinline></audio>` (**index.html:2657**)

検索結果での再生トリガ: **index.html:3504-3505**
```
musicSearch(q).then(function(tracks){ ...
  tracks.slice(0,25).forEach(function(tr){ row({art:tr.art}, tr.title, "♪ "+tr.artist+" · プレビュー", function(){ playTrack(tr); }); }); });
```
`row(...)` ヘルパは **index.html:3475-3481**(検索行を生成)。

**index.html にはフルプレイヤー(`#player`)・Web Audio グラフ(`AudioContext`/`createMediaElementSource`/`createBiquadFilter`)・カルーセル・EQ は一切存在しない**(grep で 0 件)。CSS変数は `--gc-ease`/`--gc-spring`(index.html:1822-1823)を使用。参照UIの `--ease-out`/`--ease-spring`/`--accent-rgb` は **index.html には未定義**(要追加 or 置換)。

### iindex.html(参照・移植元)

| 要素 | 場所 | 内容 |
|---|---|---|
| フルプレイヤー markup `#player` | iindex.html:290-329 | `.pl-bg`(ぼかし背景)`.pl-cards`(`#card-prev/#card-cur/#card-next`)`.pl-meta`(`#pl-t/#pl-a/#pl-mode`)`.pl-scrubrow`(`#pl-prev/#scrub/#pl-next`)`.pl-eqwrap`(`#pl-eq` + `#pl-scrubtime`) |
| フルプレイヤー CSS | iindex.html:139-222 | `#player`(下からせり上がり transform)、`.pl-card.cur/.prev/.next`、`.eqband/.eqtrack/.eqfill/.eqknob/.eqmeter`、`#player.scrubbing`/`#player.paused` 状態 |
| `ICN`(再生コントロール画像) | iindex.html:337 | shuffle/repeat/prev/next の base64 PNG |
| Web Audio エンジン `ensureGraph()` | iindex.html:442-478 | `MediaElementSource`→`pre`(−6dB)→5×`BiquadFilter`(EQ)→spatial(splitter/delay/merger)→`StereoPanner`→`fade`→`DynamicsCompressor`(limiter)→`AnalyserNode`→destination |
| `EQBANDS`/`METER_EDGES` | iindex.html:443-444 | EQ: 60/230/910/3600/14000Hz。メーター帯域: 5区間 |
| `applyEQ()` | iindex.html:479 | スライダ値(0..1)→ −12..+12dB を `setTargetAtTime` |
| fade/`toggle()` | iindex.html:484-493 | 停止時0.5sフェード。`toggle()` がフルプレイヤーの再生/停止 |
| メーター `meterTick/startMeters/stopMeters` | iindex.html:504-513 | `AnalyserNode` から5帯域RMS→`.eqmeter` の height |
| 曲ロード `loadPlayer(t)` | iindex.html:554-561 | cur/prev/next の画像・タイトル・背景を更新 |
| `openPlayer/closePlayer` | iindex.html:562-563 | `#player` に `.show`、`body overflow:hidden` |
| カルーセル swipe | iindex.html:635-650 | `#pl-cards` の pointerdown/move/up。←→で曲送り、↓で閉じる、中央タップで toggle |
| スクラブ `bindSlider`/`makeSeek` | iindex.html:593-633 | ドラッグscrub・長押し早送り(Force Touch対応) |
| EQ UI `buildEQ()` | iindex.html:656-670 | `#pl-eq` に5本の縦スライダ生成。`localStorage "soundbite.eq"` 永続化 |
| キュー: `queue/qi/current/playHistory` | iindex.html:351-352 ほか | `recommendFor`(iindex.html:431) `nextTrack`(438) `prevTrack`(439) `pool`(428) |
| 整形ヘルパ | iindex.html:355-358 | `hi()`(100x100→600x600) `fmt()`(秒→m:ss) `uid()`(trackId基準) `fullLen()`(trackTimeMillis) |
| 配線 | iindex.html:544-545 | `#np-play`→`toggle()`、`#np-inner`→`openPlayer(current)` |

---

## 実装手順(具体的・順序立て)

> 方針: index.html の既存ミニプレイヤー/`#gcAudio` を温存しつつ、フルプレイヤー層を**追加**する。最大の落とし穴は **データshapeの不一致**(下記 注意点参照)なので、まずそこを潰す。

### Step 0. データshapeを揃える(最重要・前提)

参照UIのほぼ全関数が iTunes **生フィールド**(`trackName/artistName/collectionName/artworkUrl100/previewUrl/trackId/collectionId/trackTimeMillis`)を前提にしている。一方 index.html の `_mapTracks`(index.html:2953-2954)は `{title,artist,art,preview}` に間引いている。

**選択肢A(推奨): `_mapTracks` を生フィールド保持に拡張**
```js
function _mapTracks(arr){ return (arr||[]).filter(function(x){return x.previewUrl;}).map(function(x){
  return {
    title:x.trackName, artist:x.artistName, art:(x.artworkUrl100||"").replace("100x100","300x300"), preview:x.previewUrl,
    // ↓ フルプレイヤー用に raw を温存
    trackName:x.trackName, artistName:x.artistName, collectionName:x.collectionName,
    artworkUrl100:x.artworkUrl100, previewUrl:x.previewUrl,
    trackId:x.trackId, collectionId:x.collectionId, trackTimeMillis:x.trackTimeMillis
  }; }); }
```
これで既存 `playTrack`(`tr.preview/tr.title/...` 参照)も、移植する参照ロジック(`t.previewUrl/t.artworkUrl100/...`)も同じオブジェクトで動く。

**選択肢B**: 参照ロジック側を index 形式(`title/artist/art/preview`)に書き換える。`uid()` は `trackId` 無しになるので `art+title` 等で代替。recommend(同アーティスト寄せ)は `artist` で可能だが `collectionName` 表示は失われる。→ **Aを推奨**(改変が局所)。

### Step 1. HTMLを追加

`iindex.html:290-329` の `#player` ブロックを丸ごと index.html にコピー。挿入位置は `<audio id="gcAudio">`(index.html:2657)付近 or `#gcSearch` セクション直後。`#np` ではなく既存 `#gcNp` を使うので、参照の mini-np markup(iindex.html:261-271)は**コピーしない**。

### Step 2. CSSを追加

`iindex.html:139-222` の `#player` / `.pl-*` / `.eqband` 系 CSS をコピー。**CSS変数を index 系へ寄せる**:
- `--ease-out` → `--gc-ease`、`--ease-spring` → `--gc-spring`(index.html:1822-1823 で定義済)に置換、
  もしくは index の `:root` に `--ease-out`/`--ease-spring`/`--accent-rgb`(例 `124,92,255`)を追加。どちらでも可。要確認: 既存テーマ色との整合。

### Step 3. ICN(コントロール画像)を追加

`iindex.html:337` の `const ICN={shuffle,repeat,prev,next}`(base64 PNG)をコピー。`#pl-prev-img/#pl-next-img/#pl-mode-img` の `src` 設定(iindex.html:550)も移植。

### Step 4. Web Audio エンジンを追加

`iindex.html:442-513` を IIFE 内(index.html:2686 の `$` が見える範囲、`setupAudio` 付近)へコピー:
- `EQBANDS`,`METER_EDGES`,`dbToGain`,`eqDb`,`SPATIAL_WIDTH`,`A`,`eqMeters`
- `ensureGraph()`(`audio` 変数 = `$("gcAudio")` を使うよう確認。参照は `audio` というローカルを使用。index.html 側も `audio` ローカルがある=index.html:2962 `var audio=null` 〜 `setupAudio` で `$("gcAudio")` 代入。**同名なので流用可**)
- `applyEQ`,`applySpatial`,`clearFade/setFadeGain/fadePause`,`toggle`
- `meterTick/startMeters/stopMeters`

> 注意: `createMediaElementSource(audio)` は **同じ audio 要素に対して1回しか呼べない**。`ensureGraph` の `if(A)return A;` ガードがそれを保証しているので、必ずこのガード経由で生成すること。

### Step 5. キュー/recommend/整形ヘルパを追加

`iindex.html:355-358`(`hi/fmt/uid/fullLen`)と、`current/queue/qi/playHistory/recCache`、`pool()`(iindex.html:428)`recommendFor`(431)`nextTrack`(438)`prevTrack`(439)を移植。
- `pool()` は参照では `results`/`favorites` 配列を返す。index.html は検索結果を**配列で保持していない**(行ごとにクロージャ `tr` を渡すだけ)。→ **`runSearch` 内で `var lastTracks=[]` を用意し、`musicSearch().then` で `lastTracks=tracks` を保存**(index.html:3504 付近)。`pool()` は `lastTracks` を返すよう変更。これでカルーセルの prev/next 推薦が機能する。

### Step 6. フルプレイヤー制御を追加

`iindex.html:547-670` から移植:
- `loadPlayer/openPlayer/closePlayer`(554-563)
- せり上がり/スワイプ閉じ(566-569)、mode(572-582)、odometer(585-590)
- `bindSlider/makeSeek/prevTap`(593-633)、カルーセル swipe(635-650)
- `buildEQ`(656-670)→ **起動時に1回 `buildEQ()` 呼ぶ**
- `playNew/selectTrack/goNext/goPrev`(515-526)。`playNew` は `loadNp`(参照528)を呼ぶが、index では `#gcNp` を使うので **`loadNp` を index の `playTrack` 相当(`np-img/np-title/np-artist` + `#gcNp` show/pop, index.html:2971-2972)に差し替え**。

### Step 7. 配線(ミニ→フル)

- index.html:3938-3940 の `npToggle` 配線を、参照(iindex.html:544-545)に合わせて変更:
  - `#np-play` onclick → `toggle()`(フェード付き再生/停止)
  - **`#np-inner` onclick → `openPlayer(current)`**(これがミニ→フル展開の入口)
- 検索行の再生(index.html:3505)は `playTrack(tr)` → **`selectTrack(tr)`** に変更(キュー登録 + recommend更新 + フルが開いていれば `loadPlayer`)。
- `setupAudio`(index.html:2974) の play/pause/ended に、参照側の `startMeters/stopMeters`・`goNext`(ended時, loopでなければ)・スクラブ更新(iindex.html:535-542)を統合。`npRing`(既存)は維持し、フル側 `#ring-fg` 更新と二重にならないよう確認(参照は `RC=2π·23` で `#ring-fg` を別途駆動 → index は `npRing` が既に `#ring-fg` を更新しているので**どちらか一方に寄せる**)。

### Step 8. 触覚(任意・既存資産活用)

index.html には `haptic()`(index.html:2786 / 1573)がある。カルーセル送り・mode切替・scrub確定に `haptic()` を足すと iOS で締まる(MEMORY: `<input switch>` 実タップ手法は別物。ここは `navigator.vibrate`/既存 `haptic` で十分)。

---

## 対象ファイル/関数

**編集する file**: `/Users/s_users/Downloads/chat-app/index.html`(単一ファイル。app.js等への分割は不要)

| 追加/変更 | 関数・ID | 行(現状) |
|---|---|---|
| 変更 | `_mapTracks`(raw温存) | index.html:2953 |
| 追加 | `#player` markup | iindex.html:290-329 を移植 |
| 追加 | `.pl-*`/`.eqband` CSS | iindex.html:139-222 を移植 |
| 追加 | `ICN` | iindex.html:337 |
| 追加 | Web Audio: `ensureGraph/applyEQ/applySpatial/toggle/fade*/meter*` | iindex.html:442-513 |
| 追加 | `hi/fmt/uid/fullLen/recommendFor/nextTrack/prevTrack/pool` | iindex.html:355-439 |
| 追加 | `loadPlayer/openPlayer/closePlayer/bindSlider/makeSeek/buildEQ/カルーセル` | iindex.html:547-670 |
| 追加 | `playNew/selectTrack/goNext/goPrev`(+`loadNp`を`#gcNp`へ差替) | iindex.html:515-530 |
| 変更 | `runSearch` 内: `lastTracks` 保存 + 行クリックを `selectTrack` | index.html:3504-3505 |
| 変更 | `npToggle`→`toggle`、`#np-inner`→`openPlayer` | index.html:3938-3940 |
| 変更 | `setupAudio` に meter/ended-next/scrub 統合 | index.html:2974-2981 |

---

## 注意点・落とし穴

1. **データshape不一致(最大の罠)**: index の `_mapTracks` は `{title,artist,art,preview}` に間引く。参照は raw iTunes フィールド前提。Step 0 で raw を温存しないと、カルーセル画像(`hi(t.artworkUrl100)`)・`uid(t)`(`trackId`)・recommend(`artistName`)・`fullLen`(`trackTimeMillis`)が**全て undefined になり無音/真っ黒**になる。
2. **`createMediaElementSource` は audio 要素ごとに1回限り**。2回呼ぶと例外。`ensureGraph` の `if(A)return A;` ガード必須。既存 `playTrack`/`npToggle` が直接 `audio.play()` するのは問題ないが、**EQ を効かせたいなら再生前に必ず `ensureGraph()`**(参照 `toggle/playNew` はそうしている)。
3. **AudioContext は user gesture で resume が必要**(iOS/Safari)。`ensureGraph` 内 `ctx.resume()` はタップ起点(`toggle`/行クリック)から呼ぶこと。自動再生コンテキストでは suspended のまま。
4. **CSS変数差**: 参照は `--ease-out/--ease-spring/--accent-rgb`、index は `--gc-ease/--gc-spring`。未定義だとトランジションが効かない/色崩れ。Step 2 で置換 or `:root` 追加。
5. **`#ring-fg` の二重駆動**: 既存 `npRing`(index.html:2963)と参照 `timeupdate`(iindex.html:536)が両方 `#ring-fg.strokeDashoffset` を書く。どちらかに統一しないと値が競合してリングがちらつく。
6. **`pool()` の供給源**: index は検索結果を配列保持していない。`runSearch` で `lastTracks` を保存しないと prev/next 推薦が常に null。
7. **`loadNp` の差し替え忘れ**: 参照 `playNew` は `#np`(参照側ID)を更新するが index のミニは `#gcNp`。ID が違う(`#np` vs `#gcNp`)。差し替えないとミニが更新されない。
8. **`#gcAvaFab.playing`(進捗リング)**: 既存 setupAudio が FAB のリングを駆動。フル側ロジック追加時に play/pause リスナを**上書きせず追記**(`addEventListener` は重複登録になり得るので、setupAudio を1関数に統合するのが安全)。
9. **`spotlight` 検索が Shadow DOM インライン前提**(MEMORY: iframe厳禁)。フルプレイヤーは通常DOM(`#player` を body 直下)で良いが、検索オーバーレイ内に入れない。z-index は参照で `200`。既存の Dynamic Island / FAB と被らないか要確認。
10. **オフライン/プレビューURL失効**: iTunes preview は時々 403。`audio` の `error` で `#gcNp` を隠す等のフォールバックは現状未実装(要追加検討)。

---

## 検証方法(headless/実機)

> このリポは Netlify 配信の単一HTML PWA。ローカルは静的サーバで開く。

### ローカル起動
```
cd /Users/s_users/Downloads/chat-app && python3 -m http.server 8080
# → http://localhost:8080/index.html
```

### headless(DOM/関数存在の機械確認)
DevTools or Puppeteer 相当で:
```js
// 1. 必須DOMが揃ったか
['player','pl-cards','card-cur-img','pl-eq','scrub','gcNp','gcAudio'].every(id=>!!document.getElementById(id));
// 2. EQが5本生成されたか
document.querySelectorAll('#pl-eq .eqband').length === 5;
// 3. raw温存の確認(検索後)
//    → musicSearch('yoasobi').then(t=>console.log(t[0].trackId, t[0].previewUrl, t[0].artworkUrl100));
// 4. AudioContext が立つか(タップ後)
//    → ensureGraph(); console.log(window.A && A.ctx && A.ctx.state);
```
> 注意(MEMORY): headless は virtual-time で**時計が凍結**し得る。EQメーター(`AnalyserNode`)は実音声が要る → メーター動作はheadlessで検証不可、**実機/実ブラウザ**で確認。

### 実機(iPhone PWA)
1. `git push origin main` → Netlify 自動デプロイ(MEMORY: chat-app の deploy 手順)。
2. iPhone Safari で開く → 検索で曲タップ → ミニ `#gcNp` 出現 → **ミニをタップ → フルプレイヤーが下からせり上がる**。
3. カルーセル: 左右スワイプで曲送り、下スワイプで閉じる、中央タップで再生/停止。
4. EQ: 5本スライダを動かす → 音が変わる(低域/高域)。再生中、各バンドのメーターが波打つ。
5. scrub: バーをドラッグ → odometer 風に時間表示。prev/next 長押しで早送り・巻き戻し。
6. 触覚: カルーセル送り/mode切替でコツッと反応(iOS26系は `<input switch>` 実タップ手法が確実=MEMORY、ただし本機能は `haptic()` 流用で可)。
7. リロード/バックグラウンド復帰で AudioContext が suspended→resume するか(無音化しないか)。

---

## 優先度・工数・依存

- **優先度**: 中(C: 未実装機能。基幹のチャット/検索/翻訳は動作済。音楽はプレビュー止まりで体験拡張枠)
- **工数**: L(~1日)。markup/CSS/ICN コピーは機械的だが、(1)データshape統一、(2)Web Audio グラフの1回限り生成と user-gesture resume、(3)`#np`↔`#gcNp` の差し替え、(4)`#ring-fg` 二重駆動の解消、(5)`pool()` 供給源(`lastTracks`)——の5点で必ず手当てが要る。EQ/カルーセル/scrub のロジック自体は参照を**ほぼそのまま移植**できる。
- **依存**:
  - 前提: 既存 `musicSearch`/`#gcAudio`/`#gcNp`/`runSearch`(すべて実装済)。
  - 内部依存: Step 0(データshape)→ Step 4-6(全ロジック)。Step 0 を飛ばすと後続が動かない。
  - 外部依存: iTunes Search API(キー不要)、Web Audio API(全モダンブラウザ可)。追加ライブラリ不要・CDN不要・オフライン可(プレビュー音源を除く)。
  - **要確認**: ① index の `:root` に `--accent-rgb` が無い場合の色(置換 or 追加)。② `#player` z-index(200)と既存 Dynamic Island/FAB の重なり。③ recommend が `lastTracks` 25件で十分か(参照は全 `results`)。④ プレビューURL失効時のフォールバック(現状未実装)。
