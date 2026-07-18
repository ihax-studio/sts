/* gc-sw.js — globe-chat 用 Service Worker（Web Push 受信 + 通知タップ処理）
 * iOS Web Push はカスタム音不可（badge/vibration のみ）。アプリ内音は本体側で再生。 */
'use strict';

// 地球儀の重いアセット（Three.js本体＋地球/雲/月テクスチャ）だけを永続キャッシュ＝起動毎の再DLを防ぎギガ削減。
// これらは versioned CDN / 固定URL で実質不変なので cache-first で安全。HTML/JS/CSS は介入せず常にネット直行（即時更新維持）。
var GLOBE_CACHE = 'globe-assets-v1';
var GLOBE_RE = /(cdn\.jsdelivr\.net\/npm\/three@|threejs\.org\/examples\/textures\/|flagcdn\.com\/)/;
// ★Netlifyリクエスト最小化: 同一オリジンの静的メディア(画像/音/動画/フォント)は cache-first。
//   一度取れたらネットに行かない＝起動毎のstale-while-revalidate裏取得(=毎回のNetlifyリクエスト)を全廃。
//   メディアはファイル名固定(変更時は新名)なので安全。新SW有効化(activate)時にアイコン類だけ破棄して更新を担保。
//   HTML/JS/CSS は一切キャッシュせずネット直行のまま＝コードは常に最新（更新が止まらない）。
var MEDIA_CACHE = 'gc-media-v1';
var MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|mov|mp4|m4a|wav|caf|m4r|woff2?|ttf|otf)(\?|$)/i;
// ★iHax(WebLLM)がCache APIに保存するモデルの重み/wasm/tokenizer等は活性化時に消さない=毎デプロイでモデルが消えて
//   再DL→45秒スタール→「ワーカーがクラッシュ」する不具合の根治。WebLLMは "webllm/*" やURL名のキャッシュを使う。
var IHAX_KEEP_RE = /webllm|mlc-ai|mlc-chat|\.wasm|params_shard|ndarray-cache|tokenizer|\/model|^https?:\/\//i;
var SW_VER = '2026-07-18-batch-260';   // ★260(2026-07-18): 新PWAアイコン(stsx.png=白ピンク青ネオンを全サイズ) / welcomeローダのzh/pt地域解決修正(zh_CN等・enに落ちない=ようこそも国別) / iOSでWebアプリとして開くOFF時=小さく薄いスライドアップ案内(強制は仕様上不可) / エラー系=全て3回haptic / 待ってねドット=強cubic高速化。   // ★259(2026-07-18): リアルタイム文字刷新(Aa/あぁトグル=w100+TikTok残像・オフ=横線+両者停止3haptic・blob0.5sふわっ・stopwatch風縦スライド・終了/送信=拡大しながらぽわっ・上下余白+)・ペア招待=全画面「一緒にいまをとろう」scale1.1→1 0.8s+スライドしてとる(tog.html移植)+ドット手前からcubic・友達追加もスライドUI・初チャット提案(🫩who are You👀/hello/welcome=スライドアップ→初メッセージで0.5s縮小)・環境チューザー小型化(全ボタン画面内)・思い出=日付見出しでグループ分け・登録→=色/emoji変更や押下で右へ0.5s cubic→左から再登場・💜/パープル=#B024D8・投稿UI=時計デカくRounded w100(+3px)/最太=expanded/撮影1080px q0.92彩度+/カメラ1920/位置情報=逆引き失敗でも現在地で必ず設置/曲検索=白線blurスピナー0.5s scaleup⇄結果scaleup・検索中の＋=shadowなし0.1px枠・音声/曲/3D強化はbatch-258参照。   // ★258(2026-07-18): アイコン全刷新(≤256px=太StSX/≥257px=ネオンsts)・旧設定UI(🔔👀QR友達バー)完全廃止=利用者は常に自分の情報(管理者コンソールのみ温存)・検索=QR+your code(expanded light)+MBTI左ラベル(おすすめ廃止)+友達1行中央揃え+左端に＋カメラ|バー(カメラ/設定app廃止)・アクティビティ=グリッド非表示(検索/1行で出る)・classic機能全排除(旧ユーザーは色背景へ移行)+環境=火星金星冥王星を一気に表示(月/太陽廃止・スワイプで地球化しない)+国ピン後は会話タブへ・色ボタン=グラデborder枠のみ・挨拶=hello統一(韓国語のみko.json)+👋=hello扱い・チャット文字=SF Pro Rounded w100・3D=STL/G-codeを画像&動画から添付+チャット内AirPods風回転プレビュー・思い出=実画像保存(ドット化廃止)+タップでCoverflow+記念日タブ(設定+当日投稿で出現)+today=時刻タイムバー・アイコン選択=リング+📸自分でとる/思い出をアイコンに・登録/引き継ぎ=blurも0.5sフェード+枠なし+mov▶️ボタン根絶+復元表示バグ修正・初期設定delay全撤去・環境長押し=1:1四角撮り+シェア/交換ピル+ペア投稿「一緒にいまを撮ろう」(振って拒否+初回説明+地球儀2人分アイコン)・ボイメ効果音一式(開始/送信/30秒/不許可3haptic+transform固着根治)・HEIC=PNG化でブラックアウト根絶・送信ボタン付近の文字=0.5sで半透明。   // ★257(2026-07-18): 検索=app一覧は最初の画面で非表示+名前/別名(activity/apps等・ひらがな→カタカナ正規化)でヒット・下見切れ根治(visualViewport実測)・空のまま検索キー=3回haptic+バー左右シェイク・MBTI別の左に自分のQR(タップ=コピー)・カメラ=stCameraに完全一本化(カメラapp廃止・QR常時読取・radius40%スーパー楕円)・設定/dock自分=自分の情報(openMyProf)+設定再オープン競合根治・2FA/GitHub認証を完全廃止(パスキーのみ)・environment=低解像度の系外惑星5種を廃止+太陽2048px化+タブ/星ストリップ見切れ根治+星スワイプ閾値緩和・ボイメ=秒slideup0.8→1+blur/マイク権限オフはボタン非表示/指離し3回haptic+シェイク・国ピン中はバー非表示(操作=3回haptic+シェイク)・初期設定/使い方イントロ/PWAゲート背景=完全透明(灰青tint廃止)・記念日UI出入り両方0.5s ease。   // ★256(2026-07-17): 通知根治(設定🔔トグル復活=display:none撤去・granted時/起動時の購読自己修復・authReady待ちで購読が消えない)・中央下の名前+MBTI真の中央揃え(padding対称+2行センター)・左下FAB60px=右と対称・死コード一掃(pickVideoForChat/gcProfEdit一式/gcNpToggle/_npTick/openPurpleMusic/gcReopenPM + 孤立ファイル: app.js/Beta.html/example/test/music-test/install-flow-demo/index-extras/index-s2s/build-index.mjs/apps/purple-music.html)。   // ★255(2026-07-17): 通話=SkyWay P2P音声(📎→📞発信/着信全画面/ミュート/45s応答なし・cxcallシグナル)・environment=アストロノミー集約(太陽+月火金冥+系外惑星5種=手続き生成テクスチャ)+星スワイプ切替0.5s ease(setBodySmooth=カクつき根治)+星ストリップ/タブ左右スワイプ(gcSwのtouch-action根治)・動画=ppp経由の完全URLチャンク再生根治(fileUrl素通し)・投稿画像2重根治(dense時ql/dot排他+共有画面二重オープンガード)・apps検索×を少し上(bottom6→16px)。   // ★254(2026-07-15): 自分アイコン→MBTI設定が最前列で必ず出る(closeSettingsの遅延teardown根治) / 再生スライダ=リング外周28%で掴みやすく+タップでその位置へシーク(戻れる) / 地球儀=横向きでも1:1をResizeObserverで保証 / 📎=Todoを連絡先と画像の間・Musicをステッカー行へ・中央揃え / 音楽=再生開始で空間+ライブEQ(低音)常時ON+空間少し強め(2.7) / 画像=再送で残留スピナー根治(バブル個別追跡) / 再生速度表示=近似判定で1.28→"1.3"(声削減後も) / 起動=地球儀直後にdock/ボタン即描画(重い初期化より先)。   // ★253(2026-07-15): 音楽=OSの再生中(ロック画面/通知/コントロールセンター/AirPods)に曲名・アーティスト・ジャケットを表示し曲変更で更新=stsを閉じても曲に追従・OSのplay/pause/次/前/シークに対応・background再生維持(MediaSession API・iOS17+)。   // ★252(2026-07-15): 思い出=日付を下の横並びバー+左右スワイプで日付グループ移動 / 地球儀=横向き比率ズレ根治(#globeWrap実ボックス測定で常に真円) / 通知=枠(ピル/丸)撤去+件数はSF Pro weight1少し大きく+パネル中はdock非表示 / 友達一覧の−・dockの−=透明::beforeで当たり判定拡張(押しやすく) / sticker=PNGのみ化(透明保持・jpeg/heifは写真) / dock設定2個選択バグ根治。要 firebase deploy --only database (mbtiSongs)。   // ★251(2026-07-15): Phase7(検索閉じ1→1.3/タイピングリング刷新/通知を中央下identityカード[枠なし+MBTI記念日+枠色件数円]+送り主blur展開/ハート=選んだハート)+Phase8(複数画像/動画ブラックアウト根絶+実進捗リング/ステッカー長押し−削除)+Phase5(再生中pin→♡+最近💜+MBTI別2行曲/😈スワップ)+Phase9(Aeroモバイル作成/友達コース非破壊/イントロ/枠なしカード/→55px白)+自分アイコン→MBTI表示修正。要 firebase deploy --only database (mbtiSongs)。   // ★250(2026-07-15): Phase6=検索(apps)を開くと左右dockが0.3sフェードアウト(ドット含む/app移動中のみapps userで復活)+長押し移動のジグル(ブレ)撤去+設定で自分アイコン→自分の設定が必ず出る(閉じ中インスタンスを除去して開き直す)+プロフの＋を上へ+友達の×を若干下に。search-deck v11。   // ★249(2026-07-15): 死コード削除(付箋ノート作成UI/グループ作成UI=到達不能を撤去・既存グループ表示と1対1チャットは非変更)+日本ではGitHubログイン非表示(パスキーのみ・管理者は常に表示・TZ/言語で無料判定)。   // ★248(2026-07-15): LINEログイン完全削除(client+worker=GitHub+パスキーに一本化)/iPhone受信時キーボード落ち撲滅(記念日slider方式のrAFスクロール)/再生中UI磨き(ジャケ0.5s・リングを曲色に+細く(8→6)+グロー強化・EQ/円形スライダで閉じない・↑を上げ押下で左右余白・overflow隠す)/チャットのスクロールバー非表示/記念日0.7s ease/設定の+を上へ   // ★利用者もプロフのアイコンをカメラ/写真で設定可(256px→TG・ava=img:短い)＋絵文字/色は従来どおり利用者可。前バッチ(画像フル画質/120件以外TG退避+引き継ぎ復元/起動delay全撤去/FAB・dock 0.3s scaleup/起動背景即透明blur/lookDown.mov radius50px)も含む   // ★画像フル画質(減色廃止/q0.95/長辺2048/若干ハイコントラスト)・120件以外はTG無制限退避(gc_arch)+引き継ぎで全履歴復元・起動delay全撤去(hello0.72s/globe reveal0.7s/boot待機0)・左下右下FAB&dock0.3s scaleup・起動背景を即透明blur・lookDown.mov(パスキー作成/引き継ぎ)radius50px   // ★app移動中appsを若干中央(dock反対側)へ+若干小さく(0.3s)。dockは検索中たて並び確定   // ★dock: apps中は中央廃止→左右端に縦・0.5sで非表示・app移動(長押し)中だけ左右に出てappsを少し縮小(干渉しない)/−バッジ黒文字白丸枠/自分アイコン上の+を少し上   // ★iHaxモデルのCache APIを活性化時に消さない(再DL/45sスタール/ワーカークラッシュ根治)・自分の情報(openMyProf)は設定を閉じて最前列(MBTI含む)・引き継ぎLINE刷新(mov黒透過/アクティベート下/Safari「引き継ぎを始めます」画面)・😉😻黄緑・登録時に記念日スライダ/WelcomeQR透明枠白地+中身下げ   // ★設定を最前列(z9860)/入力中の回転リング拡大+灰色奥側除去+枠切れ解消/ステッカー(png・hello保存→白枠帯・scaleup・長押しスタンプ・shuffle/heart上へ)/Classic相手名の影除去/iHaxに尋ねるはON+install時のみ/ノート投稿(吹き出し⇄付箋)   // ★計算機(x/×/末尾=/%あまり/分数)・チャット時刻区切り+ダブルタップ時刻+受信で位置飛ばさない・声削減=waveform.png・動画/画像ブラックアウト根絶・Android=GitHub固定+LINEはSafari中間ページ(line-login.html)・長押しenv0.3s/上下スワイプ優先・MBTI他人可視/未設定です・同MBTIでenv中央+ドット縮小・検索dock余白動的   // ★画像(cximg)が/dl失敗時に黒くならない=数回リトライ+タップ再読込プレースホルダ(ブラックアウト根絶)   // ★iframe(aero-leap/ppp等)を少し横長(85→93%)・検索中は検索バーの下にdock用の余白(78px)を確保し検索バー/appと干渉しない   // ★「IDを貼る・コピー」ボタンを枠なし透明・白字・SF Pro weight1・少し大きく(16px)   // ★設定を開くとdockの設定(self)アイコンが選択状態(白リング)で残る(dockを畳まずz下げでカード操作可)・記念日の「上下スワイプで日付を変更」ヒント撤去   // ★検索中dockを検索バーの「下」に上下余白あけて配置(ユーザ指示)・メディアアップロードupload()を6回リトライ堅牢化(10339根治)   // ★iPhone音楽検索根治(worker=クリーンXFFでNetlify経由fetch=プライベートリレー/CGNATでも有名曲が出る・client=複数ソース同時レースで最速の非空採用)・Todo=丸いTodo.pngアイコン・引き継ぎ最初UI0.7s cubic・ログインSSO丸アイコン半透明・smile/lookDown mov 80%圧縮   // ★apps中dockは[apps一覧]と[検索バー]の間(バー真上)に配置・プロフィールUI(gcMyProf)背景=透明blurのみ+開くとdock畳んで最前列(サブUIとのz整合維持)・設定もdock畳み方式に統一(z元へ)   // ★iHax一旦非表示(検索でだけ出る)・送信取消=1→0.8 0.5s縮小・検索プレースホルダ"友達追加·音楽·翻訳·計算"+計算機能(1+2/12*4等)・設定がdockに被って効かない不具合根治(gcSettings z上げ+設定中dock畳む)・Todo名前変更/戻る時わく0.5s ease   // ★apps中dockはsearchの下・bio-card透明blurのみ・Classic=黒(jellyfish廃止)・hello枠bgなし・投稿UI Aa/撮影さらに下・Welcomeに🔔通知トグル(OS設定従う)・地球儀友達ピン=名前/曲をアイコン右に枠なし大きくw1・設定プロフの色をアバター周囲に円形+パレット中央下・mov radii(nob50/bio50/smile55)   // ★検索デッキのapps/dockドラッグのブレ根治=dock/レール上にかざす間は並べ替えを発火しない+入替は中央寄りのみ+発火間隔130ms。両方(shake-to-shake/shaketoshake)へ配布継続   // ★shake-to-shake/shaketoshake(sts)両方に最新配布=画像/動画/文字/todoが相互に送りあえる(同一Firebase・ルール完全準拠)。bio-icon(引き継ぎ/アクティベートのmov)radius50px復元   // ★思い出(gallery)をリアルタイム購読化=削除/♥/追加が他ビュー/別端末と即同期(アーカイブ.on(value)+自分の操作は楽観更新で抑制/moment app coverflowも.on)。登録後オンボーディング(MBTI→Welcome)含む   // ★登録後オンボーディング: ①MBTIを選ぼう(Xスライダ+記念日追加0.5s ease+→) → ②Welcome(手書きwelcome/<lang>+プロフ要約[アイコン/名前細字/MBTI💜記念日]+QR白地透明枠+見たよ通知トグル+読み取る📸+✓)。旧gcNotif/ありがとう文言を置換   // ★LINE状態不一致根治(Firebase pk/リレー)・GitHub/LINEペア解除+Intelligence色・地域(日本LINE/他GitHub)・引き継ぎ丸ブランドアイコン+radius・登録色パレットグラデ枠+内色scaleup・dockはapps中search上へ+ドロップ枠なし友達rail・投稿UI均等・太陽緑排除・MBTI😵on X・復元リングUI(smile.mov+AppleWatch風進捗+完了バースト)・Classicにjellyfish背景(速度ランプ/radius22)・2ファクタ認証(回復コード+パスキー再発行)   // ★dock=left/top(px)完全transform化廃止(位置ズレ/2段階戻り根治・右左切替もpx)・選択中は中身blur・ドロップ枠(白リング)廃止=友達は下にscaleup枠(#sdRailDrop scaleup/scaledown)・「既にドックに」UI廃止・カメラアイコン枠(影)廃止・投稿UIのAa/カメラ切替/撮影ボタンを下+余白・hello長押しで別言語0.3s ease・sts/shaketoshakeへ最新配布(チャット/画像動画修復)   // ★色背景起動高速化(非globeはhello省略)・自分アイコンtransform廃止(位置ズレ根治)・カメラアイコン塗り除外・dockドロップ白リング・友達追加しやすく+×/−バッジ0.5s scale・app並べ替え0.3s ease・連絡先送り横スワイプ・チャット中dock長押し無効・地球儀(下三角→↓白w1/宇宙黒/アイコン拡大/キーボードで比率ズレ根治/翻訳スワイプ回転)・BEAST CODE非表示・ppp16:9,4:3のみ+透明blur・設定タブ枠・普通camera長押し動画3:4   // ★ホームの思い出バー/記念日を撤去→思い出appの右端タイムラインへ移設(今日/昨日ラベル+記念日emoji行・15px左右中央)・dockリフト/レールslideup廃止=フェードのみ(干渉ゼロ)・友達×=白丸borderなし黒文字でさらに上   // ★思い出: ×=weight1拡大/♥毎回0.7→1/画像縮小/dockの反対側にdayタイムライン(0.5s・記念日emoji)+0.5s scaleupビューア・MBTI(設定/slider/X=😵)・曲ジャケの白リング→白80%ナチュラルシャドウ・カメラ: 撮影後effect+🫨/＋=位置シェア/emoji円形リング焼き込み/保存=右下↓/←=retake反時計回転   // ★安定版: env UIのtransition重複根絶(gc-appzoom廃止/visibilityフェード)・dock再設計(deckMove=inline !important単一遷移・ドラッグ中スワイプ/編集中タップのガード・上限7個/6-7個は縮小・ドロップリング両方向フェード)・apps長押し=編集モード(全体ジグル+友達×→振って削除UI・他タイル非表示バグ根治)・ドラッグ中は下に友達レール(ドロップ先)がslideup・iHax=枠なし透明blur 0.5s・mov黒背景透過(screen)・投稿UI=最細フォントdefault/パレット中央下/＋weight1枠なし・楽曲検索input33px・+Todo枠透明

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  // ★ 旧 precache を全消去（GLOBE_CACHE だけ温存）＋clients.claim＋全ウィンドウを最新HTMLへ強制ナビゲート(reload)。
  //   「昨日以前の古いPWA」も、新SWが有効化された瞬間に最新ビルド(network-direct)へ自動更新＝チャット取得不能を解消。
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return (k === GLOBE_CACHE || k === MEDIA_CACHE || k === 'gc-badge' || IHAX_KEEP_RE.test(k)) ? null : caches.delete(k); })); })   // ★iHaxモデルのキャッシュは保持=再DL/クラッシュ根絶
      // ★PWA大幅更新: MEDIA_CACHE のアイコン類だけ消して新アイコン(StS)を確実に反映。重い地球儀テクスチャ(GLOBE_CACHE/その他メディア)は温存。
      // ★新SW有効化(=新デプロイ)のたび、SWRでキャッシュした「コードを含む動的JS(spotlight-tpl/vocabx)」とアイコン類を破棄＝古いPWAでも次回取得で確実に最新化。重い地球儀テクスチャ(GLOBE_CACHE)だけ温存。
      .then(function () { return caches.open(MEDIA_CACHE).then(function (c) { return c.keys().then(function (rs) { return Promise.all(rs.filter(function (r) { return /(icon-|founder|apple-touch|spotlight-tpl|vocabx-data|mac-dock|index-mac|lookDown|smile\.mov|Todo\.png|iHax-AI|iHax-Apps|apps\.png|burble\.png|camera\.png|photos\.png|ppm-x\.png|sumi-beast-seed\.png|storymagic)/i.test(r.url); }).map(function (r) { return c.delete(r); })); }); }).catch(function () {}); })   // ★更新した画像類はcache-first残留を破棄して新版を取り直す
      .then(function () { return self.clients.claim(); })
      .then(function () { return self.clients.matchAll({ type: 'window', includeUncontrolled: true }); })
      .then(function (cl) { for (var i = 0; i < cl.length; i++) { try { if (!(cl[i].focused || cl[i].visibilityState === 'visible')) cl[i].navigate(cl[i].url); } catch (_) {} } })   // ★使用中(前面)のウィンドウは強制リロードしない=チャット/アカウント登録が更新で中断されない。裏のタブだけ最新化(前面は次回ナビ/再起動で最新。HTML/JSはネット直行なので即最新)
      .catch(function () {})
  );
});

// 地球儀アセットのみ cache-first。それ以外は respondWith しない＝ネットワーク直行（キャッシュ無し・即時更新）。
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  // 地球儀アセット: cache-first（versioned CDN＝実質不変）
  if (GLOBE_RE.test(url)) {
    e.respondWith(
      caches.open(GLOBE_CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          if (hit) return hit;
          return fetch(e.request).then(function (res) {
            try { if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone()); } catch (_) {}
            return res;
          });
        });
      })
    );
    return;
  }
  // 同一オリジンの静的メディアのみ cache-first（★キャッシュ命中=ネットに行かない=Netlifyリクエスト0）。HTML/JS/CSS は対象外＝ネット直行。
  // ★Rangeリクエスト(動画/音声のシーク)は206が返る＝キャッシュすると再生が壊れるので除外し、200のみ保存。
  if ((MEDIA_RE.test(url) || /(vocabx-data)\.js(\?|$)/.test(url)) && url.indexOf(self.location.origin) === 0 && !e.request.headers.has('range')) {   // ★語彙(666KB)もcache-first。spotlight-tpl(検索+アプリ一覧テンプレ)は絶対キャッシュしない=ネット直行=デプロイ後も常に最新(PWA入れ直し不要・古い検索CSS/アプリ一覧消失の根治)
    e.respondWith(
      caches.open(MEDIA_CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          if (hit) return hit;                       // ★命中=即返し・裏取得なし（リクエスト最小化）
          return fetch(e.request).then(function (res) {
            try { if (res && res.status === 200) cache.put(e.request, res.clone()); } catch (_) {}   // 200のみ保存（206/404等は保存しない）
            return res;
          });
        });
      })
    );
    return;
  }
  // それ以外（HTML/JS/CSS/Firebase等）は respondWith しない＝完全ネット直行（常に最新）。
});

// 通知を受信して表示（shake-push Worker から送られる）
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch (_) { try { data = { body: e.data.text() }; } catch (__) {} }
  var title = data.title || 'Globe Chat';
  var isS2s = !!(data.s2s || /[?&]s2s=1/.test(data.url || ''));   // S8: シェイクでシェア通知
  var opts = {
    body: data.body || (isS2s ? '🫨シェイクをしよう👀' : '📸 シェイクタイム！いま撮ろう'),
    icon: data.icon || 'icon-180.png',
    badge: 'icon-180.png',
    tag: data.tag || (isS2s ? 's2s' : 'globechat'),
    renotify: true,
    data: { url: data.url || (isS2s ? './?s2s=1' : './'), s2s: isS2s ? 1 : 0 }
  };
  // アプリを見ている最中は OS 通知を出さない（本体側のアプリ内通知と二重にならないように）。閉じている/背景なら表示＋OSアプリバッジを加算。
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
      for (var i = 0; i < cl.length; i++) {
        if (cl[i].focused || cl[i].visibilityState === 'visible') {
          return;   // 前面＝ページ側(updateHomeBadge)が通知/バッジを管理。二重化しない。
        }
      }
      // S8: シェイクでシェア通知は「未読」ではないのでアプリバッジを増やさず通知のみ表示。
      if (isS2s) { return self.registration.showNotification(title, opts); }
      // 背面/休止/終了 → OS通知を出し、ホーム画面アイコンのバッジを加算（件数があればその分・無ければ+1）。
      var inc = Math.max(1, parseInt(data.count, 10) || 1);
      return readBadge().then(function (cur) {
        var n = cur + inc;
        return writeBadge(n).then(function () {
          try { if (self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge(n); } catch (_) {}
          return self.registration.showNotification(title, opts);
        });
      });
    })
  );
});

// バッジ件数の永続化（SWは再起動で変数が消えるので Cache に保存＝ページ側 setOSBadge と件数を共有）
function readBadge() { return caches.open('gc-badge').then(function (c) { return c.match('count'); }).then(function (r) { return r ? r.json() : null; }).then(function (j) { return (j && j.n) || 0; }).catch(function () { return 0; }); }
function writeBadge(n) { return caches.open('gc-badge').then(function (c) { return c.put('count', new Response(JSON.stringify({ n: n }))); }).catch(function () {}); }

// 通知タップ：既存ウィンドウにフォーカス、無ければ開く
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var dat = e.notification.data || {};
  var url = dat.url || './';
  // S4: 「シェイクでシェア」通知 → 起動中はアプリ内でシェイクUI(openShakePrompt)を開く／終了中は ?s2s=1 で起動
  var isS2s = !!(dat.s2s || /[?&]s2s=1/.test(url));
  var rm = dat.room || ((url.match(/[?&]room=([^&]+)/) || [])[1] || '');
  try { if (rm && /%/.test(rm)) rm = decodeURIComponent(rm); } catch (_) {}
  if (isS2s && url.indexOf('s2s=1') < 0) url = './?s2s=1';   // 終了中起動用に必ず ?s2s=1 を付与
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) {
          try { if (isS2s) c.postMessage({ type: 'gc-open-s2s' }); else if (rm) c.postMessage({ type: 'gc-open-room', room: rm }); } catch (_) {}   // 起動中はリロード無しでUIを開く(会話 or シェイク)
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);   // 終了中→?room= / ?s2s=1 付きで起動→launch handlerが開く
    })
  );
});
