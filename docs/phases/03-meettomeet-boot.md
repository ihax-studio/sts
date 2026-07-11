# meettomeet.html を稼働させる(iframe/初期化/細かいデバッグ)

## 目的
`meettomeet.html`(342行のシェル)を単体で正しく起動させ、`splash → scrReg(登録) → scrHome(ホーム)` の画面遷移と Firebase 匿名認証までを確実に通す。「真っ白で止まる」「splash が消えない」「登録画面が出ない」を潰し、ローカル/Netlify どちらでも開ける状態にする。

## 現状(コード調査の結果・該当ファイル:行)

### 全体構造
- `meettomeet.html` は **CSSを外出しした“ソースシェル”**。`<link rel="stylesheet" href="shaketoshake.css">`(meettomeet.html:16)で全スタイルを読み込み、ページ内にアプリ本体の `<style>` ブロックは無い。インライン `<style>` は `<style id="userCss"></style>`(meettomeet.html:17)の1つだけ(ユーザーCSS注入用の空タグ)。
- 画面DOMは `splash / scrReg / scrHome / scrChat / scrAdd / scrHandoff / scrPass` などの `section.screen`(meettomeet.html:23,26,45,56,96,117,131)。`scrReg` だけ初期で `class="screen active"`(meettomeet.html:26)。
- スクリプト読込順(meettomeet.html:329-340):
  1. `lib/firebase-app-compat.js` / `firebase-auth-compat.js` / `firebase-database-compat.js` / `firebase-app-check-compat.js`(全て `lib/` にローカル同梱・確認済)
  2. `firebase-config.js`(`window.FIREBASE_CONFIG` 等を定義)
  3. `storage.js`
  4. `app.js`(本体)
  5. `index-extras.js` / `index-s2s.js`
  6. `spotlight-tpl.js` + 直後のインライン `<script>` で `#spotTpl` に `window.__SPOTTPL` を流し込む(meettomeet.html:338-340)

### 起動シーケンス(app.js)
- エントリは `boot()`(app.js:2291)が末尾で即時実行(app.js:2319)。`DOMContentLoaded` を待たず、スクリプトが `</body>` 直前のため DOM は揃っている。
- `boot()` の流れ:
  1. iOS<17 判定で `showUnsupported()`(app.js:2283-2287/2294)→「非対応のOSです」。`isIOS()`(app.js:47)/`iosMajor()`(app.js:48)。**デスクトップ等 `iosMajor()===0` のときは弾かれない**(条件 `iosMajor()>0 && <17`)ので PC ブラウザでも起動する。
  2. `antiTamper(); blockGestures(); hapticInit(); wireUI(); buildEmoji(); initDelete();`(app.js:2295)で UI 配線。`antiTamper`(app.js:2263)はイベント抑止のみで boot を止めない。
  3. `#userCss` に保存済みユーザーCSSを復元(app.js:2297, キー `cx_usercss`)。
  4. Service Worker 登録 `navigator.serviceWorker.register('sw.js')`(app.js:2302、相対パス)。`controllerchange` で1回だけ自動 `location.reload()`(app.js:2300-2301)。
  5. `me`(=`load(K.me,null)`, app.js:22)があれば `applyMe(); enterHome()`(→`show('scrHome')`)、無ければ `buildReg(); show('scrReg')`(app.js:2309)。**初回は必ず登録画面**。
  6. `fbConfigured()`(app.js:119)が false なら `showSetup()`(app.js:2015)で「あと一歩：通信規格設定」オーバーレイを出して return。`fbConfigured` は `window.firebase && config.apiKey && !/PASTE/.test(apiKey)` を見る。
  7. `ensureAuth()`(app.js:120-129)で `firebase.initializeApp`(app.js:123) → App Check `activate`(try/catch, app.js:124) → `auth.signInAnonymously()`(app.js:127)。
  8. `finally` で `loaderHide()` し、splash に `.hide` を付けて 600ms 後に `remove()`(app.js:2317)。**全体が try/catch/finally なので、途中で例外が出ても splash は必ず消え、登録/ホームのどちらかは表示される**(catch 内でも `show()` を試みる, app.js:2315-2316)。
- `show(id)`(app.js:113)は各 `section.screen` の `.active/.behind` をトグルし、`#app` に `on-home` を付与。`splash` は `screens` 配列(app.js:112)に含まれないので `show()` の対象外 → splash の消去は `boot()` の finally が担当。

### Firebase 設定(firebase-config.js・実値が入っている=確認済)
- `apiKey: "AIzaSy…"`, `authDomain: "ichat-pwa.firebaseapp.com"`, `databaseURL: …asia-southeast1…firebasedatabase.app`(firebase-config.js:3-9)。PASTE プレースホルダではない → `fbConfigured()` は **true** を返す想定。
- App Check reCAPTCHA v3 サイトキー `window.RECAPTCHA_SITE_KEY`(firebase-config.js)。`firebase.appCheck().activate(key, true)`(app.js:124)は try/catch 済みで失敗しても起動は止まらない。

### iframe について
- **メインの起動フローに iframe は無い**。`<iframe>` は (a) スポットライト検索(旧iframe廃止 → Shadow DOM インライン化, meettomeet.html:308-311 / `loadSpotInline()` app.js:1571 / `warmSearch()` app.js:1396)、(b) 動画エディタ連携の `postMessage`(app.js:960)に限られ、いずれも boot を阻害しない。`#searchOv > #searchHost`(meettomeet.html:309-311)に Shadow DOM を生やす設計(iframe厳禁=メモリ参照)。

### ビルド/デプロイ関係(重要な前提)
- `build-index.mjs` は `meettomeet.html` を入力に **`classic.html`** を出力する(build-index.mjs:`fs.writeFileSync('classic.html', h)`)。コメント通り **index.html はすでに globe-chat(別のメインページ)に差し替え済**で、旧appのビルド出力先は `classic.html`。`shaketoshake.css` / `spotlight-tpl.js` も同スクリプトが生成。
- **要注意**: `build-index.mjs` 冒頭(L18付近)は「属性なしの最初の `<style>` ブロック」を必須とし、無ければ `FATAL: main <style> block not found` で異常終了する。現在の `meettomeet.html` は `<style id="userCss">`(属性あり)しか持たないため、**今の meettomeet.html をそのまま `node build-index.mjs` に通すと FATAL になる**(=ビルド経由ではなく直接配信が前提の状態)。→ 「実装手順」で対処。

### 落ちうる箇所(調査で確定したもの)
- root絶対パス `src="/..."`: app.js:352,539,612,951,1056,1458 が `'/arrow.up.trash.png'`/`'/movie.png'`/`'/icon-x.png'`/`'/icon.png'` を参照。**`file://` 直開きでは解決できず画像欠け**(起動は止まらないが見た目が壊れる)。`build-index.mjs` はこれを相対化するが、meettomeet.html を直接配信する場合は **サーバのルートで配信**する必要がある。
- 効果音: `Snd.files` は `sounds/…`(app.js:78)を参照するが **リポジトリ直下に `sounds/` ディレクトリは存在しない**(調査で確認)。`Snd.loadAll()`(app.js:80)は1ファイルずつ try/catch なので **音が鳴らないだけで boot は通る**。
- `index-s2s.js` は冒頭コメントで **「meettomeet非対応」**(index-s2s.js:1)と明記。meettomeet.html はこれを読み込んでいる(meettomeet.html:337)が、`window` 経由の任意公開関数(app.js:2322付近)を参照するだけで boot ガードは無い。読み込み自体は無害だが、s2s 機能は index 専用。

## 実装手順(具体的・順序立て・コード断片可)

### 手順0: ローカルで HTTP 配信して開く(file:// は使わない)
root絶対パス画像と SW・Firebase の都合上、必ず HTTP で配信する。
```bash
cd /Users/s_users/Downloads/chat-app
python3 -m http.server 8080
# ブラウザで http://localhost:8080/meettomeet.html を開く
```
DevTools Console と Network を開いた状態で、`boot()` の流れに沿って 404(画像/スクリプト)と例外を確認する。

### 手順1: 必須アセットの存在を確認
- `shaketoshake.css`(直下・確認済) … 無いと全レイアウト崩壊。`splash`/`screen.active` 等のスタイルはここ(shaketoshake.css:650-654, 27-33)。
- `lib/firebase-*-compat.js` 4本(確認済)。
- `firebase-config.js` / `storage.js` / `app.js` / `index-extras.js` / `index-s2s.js` / `spotlight-tpl.js`(全て直下・確認済)。
- `icon-x.png`(splash画像, meettomeet.html:23)・`send.png`/`movie.png`/`haptic.png` 等の UI 画像(直下にあるか `ls` で確認)。

### 手順2: 初回起動=登録画面の確認
1. localStorage を空にした状態(`cx_me` 無し)で開く → `boot()`(app.js:2309)が `buildReg(); show('scrReg')` を実行し **「はじめまして」登録カード**(meettomeet.html:28-36)が出ることを確認。
2. 名前入力 + アバター/カラー選択で `#regGo`(meettomeet.html:35)が活性化し、押すと `me` が保存され `enterHome()` → `scrHome` に遷移することを確認。
3. リロード後は `me` があるので直接 `scrHome` に入る(app.js:2309)。

### 手順3: Firebase 接続の確認
- Console で次を確認:
  - `firebase.apps.length` が 1(`initializeApp` 済, app.js:122-123)。
  - `firebase.auth().currentUser` が匿名ユーザ(uid あり, app.js:127-128)。
- 失敗時の切り分け:
  - **`showSetup()` の「あと一歩」オーバーレイが出る** → `fbConfigured()` が false。`firebase-config.js` が読めていない/`window.firebase` 未定義(=`lib/firebase-app-compat.js` の 404)を疑う。
  - **匿名サインインが reject** → Firebase Console で「Authentication → Sign-in method → 匿名」が有効か、`auth/operation-not-allowed` を確認。`ensureAuth()` の catch(app.js:127)で false が返り、ホーム自体は出るが同期しない。
  - **App Check で 403/`appCheck/recaptcha-error`** → reCAPTCHA サイトキー(firebase-config.js)とドメイン登録を確認。`activate` は try/catch(app.js:124)なので boot は止まらないが、RTDB 読み書きが弾かれる場合は Console の App Check「未強制(Unenforced)」を確認。

### 手順4: CSP / ドメインの確認(Netlify 配信時)
- `netlify.toml` の `Content-Security-Policy`(netlify.toml の `for="/*"`)に Firebase 系が**既に許可済**:
  - `connect-src` に `https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.googleapis.com https://content-firebaseappcheck.googleapis.com`。
  - `script-src` に `'unsafe-inline' 'unsafe-eval'`(meettomeet.html:340 のインライン script と Firebase compat 用)。
  - `frame-ancestors 'none'`(本体は外部埋め込み禁止)。**meettomeet.html を別ページの iframe に入れて検証しようとすると、この `frame-ancestors 'none'` でブロックされる**点に注意(=単体ページとして開くこと)。
- ローカル `http.server` には CSP が付かないので、CSP 起因の不具合は **Netlify(または `netlify dev`)でのみ再現**する。CSP 違反は Console の `Refused to … because it violates the … Content Security Policy` で検出。

### 手順5: Service Worker の取り回し
- `sw.js`(相対, app.js:2302)。初回は `controllerchange` で1回 `location.reload()`(app.js:2301)が走る=リロードが1回挟まるのは正常。
- デバッグ中に SW が古い `app.js` を掴んで変更が反映されない時は、DevTools → Application → Service Workers で Unregister + 「Update on reload」。`netlify.toml` は `sw.js`/`app.js` を `no-cache` 指定済。

### 手順6(任意): ビルド経路を直す
`meettomeet.html` を `build-index.mjs` 経由で `classic.html` 等に出力したい場合のみ:
- 現状は属性なし `<style>` が無く `FATAL` する。**直接配信が目的なら build は不要**(meettomeet.html はそのまま完成品として動く)。
- ビルドも通したいなら、`build-index.mjs` の「最初の `<style>` 抽出」を `<style id="userCss">` を許容するか CSS外出し済みをスキップする分岐に直す(=「要確認: ビルド経路を使うかどうかは運用判断」)。

## 対象ファイル/関数
- `meettomeet.html`: シェル本体。`#splash`(L23) `#scrReg`(L26) `#scrHome`(L45) `#userCss`(L17)、スクリプト読込(L329-340)。
- `app.js`:
  - `boot()`(L2291-2319, 即時実行 L2319) … 起動オーケストレーション。
  - `show(id)`(L113) / `enterHome()`(L328) … 画面遷移。
  - `ensureAuth()`(L120) / `fbConfigured()`(L119) … Firebase初期化・匿名認証。
  - `showSetup()`(L2015) / `showUnsupported()`(L2283) … 起動失敗系オーバーレイ。
  - `wireUI()`(L2029) `buildReg()`(L252) `applyMe()`(L312) `buildEmoji()`(L1110) `initDelete()`(L1638) `antiTamper()`(L2263) `hapticInit()`(L90) … boot から呼ぶ初期化群。
  - `load/save`(L20-21), `K`(L19), `me`(L22), `settings`(L31), `$`(L12), `el`(L13)。
- `firebase-config.js`: `window.FIREBASE_CONFIG` / `RECAPTCHA_SITE_KEY` / `STORAGE_URL` / `VAPID_PUBLIC` / `PUSH_URL` / `CHAT_PEPPER`。
- `lib/firebase-*-compat.js`(4本)。
- `netlify.toml`: CSP / SW・app.js キャッシュヘッダ。
- `build-index.mjs`: meettomeet.html → classic.html 生成(直接配信なら不使用)。

## 注意点・落とし穴
- **file:// 直開きは不可**: root絶対パス画像(app.js:352,539,612,951,1056,1458)・SW登録・Firebase の都合で必ず HTTP 配信。`http://localhost/meettomeet.html` のように **ルート直下**で配信する(`/movie.png` 等が解決できる位置)。
- **`splash` が消えない場合**: `boot()` の finally は必ず走る設計(app.js:2317)。それでも残るなら、`app.js` 自体が **構文エラーでロードできていない**(=`boot` 未定義)か、`window.onerror`(app.js:2289)が握り潰している可能性。Console の最初の赤エラーを確認。
- **真っ白の場合**: `shaketoshake.css` 404(全 `screen` が `position:absolute; transform:translateX(110%)` 等で画面外のまま)を最優先で疑う(shaketoshake.css:27-33)。
- **`showSetup` オーバーレイ**: `fbConfigured()` false=`window.firebase` 未定義。原因はほぼ `lib/firebase-app-compat.js` の読込失敗(パス/404)。
- **`index-s2s.js` は meettomeet 非対応**(index-s2s.js:1): meettomeet で s2s(撮影/フィード)機能が動かないのは仕様。読み込み自体は無害。
- **CSP `frame-ancestors 'none'`**: meettomeet.html を別ページの `<iframe>` で検証しようとすると Netlify では拒否される。検証は単体タブで行う。
- **App Check 強制をオンにしている場合**: ローカル/未登録ドメインでは RTDB が弾かれる。Console で Unenforced を確認(本番のみ強制)。
- **音は鳴らなくて正常**: `sounds/` ディレクトリが直下に無いため(調査で確認)効果音は全 404 だが `Snd.loadAll`(app.js:80)が握り潰すので boot は通る。「要確認: 効果音を出すなら `sounds/` を配置」。

## 検証方法(headless/実機)
- **headless / ローカル**(MEMORYの方針=iframe厳禁・Shadow DOMで検索):
  ```bash
  cd /Users/s_users/Downloads/chat-app && python3 -m http.server 8080
  ```
  - `http://localhost:8080/meettomeet.html` を開き、Console を監視。期待ログ:
    - 404 が出ない(特に `shaketoshake.css` / `lib/firebase-*` / 画像)。
    - splash → 登録カード「はじめまして」表示 → 名前入力で `#regGo` 活性化 → ホーム遷移。
  - Console で `firebase.apps.length===1` と `firebase.auth().currentUser.uid` を確認。
  - 既存ユーザ再現は `localStorage.setItem('cx_me', JSON.stringify({name:'t',icon:'🙂',color:'#...'}))` してリロード → 直接 `scrHome`。リセットは `localStorage.clear()`。
- **Netlify(CSP含む実環境)**: `netlify dev` か本番URLで開き、Console の CSP 違反/Firebase 403 を確認。`frame-ancestors`/`connect-src` の効きはローカル http.server では出ないのでここで確認。
- **実機(iOS Safari/PWA)**: iOS17+ で開く(iOS<17 は `showUnsupported`)。Safari → 共有 → ホーム画面に追加で standalone 起動。`apple-mobile-web-app-status-bar-style=black-translucent`(meettomeet.html:8)・safe-area の見え方、触覚(`<input switch>` 経由 hapticInit, app.js:90)を確認。SW の初回1回リロード(app.js:2301)が挟まるのは正常。

## 優先度・工数・依存
- **優先度: 高**(他フェーズの動作確認土台。シェルが起動しないと UI 修正の検証ができない)。
- **工数: S〜M**。現状コードは boot が try/catch/finally で堅牢に書かれ、Firebase 設定も実値が入っているため、多くは「HTTP配信で開く・404を潰す・Console確認」のデバッグ作業。`build-index.mjs` の `<style>` FATAL を直すなら +S。
- **依存**: `shaketoshake.css` / `lib/firebase-*-compat.js` / `firebase-config.js` / `app.js` の同梱(全て確認済)。Firebase Console 側で「匿名認証 有効」「App Check 設定」。Netlify 検証時は `netlify.toml` の CSP(Firebase 許可は既に入っている)。
