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
var SW_VER = '2026-07-14-both-222';   // ★shake-to-shake/shaketoshake(sts)両方に最新配布=画像/動画/文字/todoが相互に送りあえる(同一Firebase・ルール完全準拠)。bio-icon(引き継ぎ/アクティベートのmov)radius50px復元   // ★思い出(gallery)をリアルタイム購読化=削除/♥/追加が他ビュー/別端末と即同期(アーカイブ.on(value)+自分の操作は楽観更新で抑制/moment app coverflowも.on)。登録後オンボーディング(MBTI→Welcome)含む   // ★登録後オンボーディング: ①MBTIを選ぼう(Xスライダ+記念日追加0.5s ease+→) → ②Welcome(手書きwelcome/<lang>+プロフ要約[アイコン/名前細字/MBTI💜記念日]+QR白地透明枠+見たよ通知トグル+読み取る📸+✓)。旧gcNotif/ありがとう文言を置換   // ★LINE状態不一致根治(Firebase pk/リレー)・GitHub/LINEペア解除+Intelligence色・地域(日本LINE/他GitHub)・引き継ぎ丸ブランドアイコン+radius・登録色パレットグラデ枠+内色scaleup・dockはapps中search上へ+ドロップ枠なし友達rail・投稿UI均等・太陽緑排除・MBTI😵on X・復元リングUI(smile.mov+AppleWatch風進捗+完了バースト)・Classicにjellyfish背景(速度ランプ/radius22)・2ファクタ認証(回復コード+パスキー再発行)   // ★dock=left/top(px)完全transform化廃止(位置ズレ/2段階戻り根治・右左切替もpx)・選択中は中身blur・ドロップ枠(白リング)廃止=友達は下にscaleup枠(#sdRailDrop scaleup/scaledown)・「既にドックに」UI廃止・カメラアイコン枠(影)廃止・投稿UIのAa/カメラ切替/撮影ボタンを下+余白・hello長押しで別言語0.3s ease・sts/shaketoshakeへ最新配布(チャット/画像動画修復)   // ★色背景起動高速化(非globeはhello省略)・自分アイコンtransform廃止(位置ズレ根治)・カメラアイコン塗り除外・dockドロップ白リング・友達追加しやすく+×/−バッジ0.5s scale・app並べ替え0.3s ease・連絡先送り横スワイプ・チャット中dock長押し無効・地球儀(下三角→↓白w1/宇宙黒/アイコン拡大/キーボードで比率ズレ根治/翻訳スワイプ回転)・BEAST CODE非表示・ppp16:9,4:3のみ+透明blur・設定タブ枠・普通camera長押し動画3:4   // ★ホームの思い出バー/記念日を撤去→思い出appの右端タイムラインへ移設(今日/昨日ラベル+記念日emoji行・15px左右中央)・dockリフト/レールslideup廃止=フェードのみ(干渉ゼロ)・友達×=白丸borderなし黒文字でさらに上   // ★思い出: ×=weight1拡大/♥毎回0.7→1/画像縮小/dockの反対側にdayタイムライン(0.5s・記念日emoji)+0.5s scaleupビューア・MBTI(設定/slider/X=😵)・曲ジャケの白リング→白80%ナチュラルシャドウ・カメラ: 撮影後effect+🫨/＋=位置シェア/emoji円形リング焼き込み/保存=右下↓/←=retake反時計回転   // ★安定版: env UIのtransition重複根絶(gc-appzoom廃止/visibilityフェード)・dock再設計(deckMove=inline !important単一遷移・ドラッグ中スワイプ/編集中タップのガード・上限7個/6-7個は縮小・ドロップリング両方向フェード)・apps長押し=編集モード(全体ジグル+友達×→振って削除UI・他タイル非表示バグ根治)・ドラッグ中は下に友達レール(ドロップ先)がslideup・iHax=枠なし透明blur 0.5s・mov黒背景透過(screen)・投稿UI=最細フォントdefault/パレット中央下/＋weight1枠なし・楽曲検索input33px・+Todo枠透明

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  // ★ 旧 precache を全消去（GLOBE_CACHE だけ温存）＋clients.claim＋全ウィンドウを最新HTMLへ強制ナビゲート(reload)。
  //   「昨日以前の古いPWA」も、新SWが有効化された瞬間に最新ビルド(network-direct)へ自動更新＝チャット取得不能を解消。
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return (k === GLOBE_CACHE || k === MEDIA_CACHE || k === 'gc-badge') ? null : caches.delete(k); })); })
      // ★PWA大幅更新: MEDIA_CACHE のアイコン類だけ消して新アイコン(StS)を確実に反映。重い地球儀テクスチャ(GLOBE_CACHE/その他メディア)は温存。
      // ★新SW有効化(=新デプロイ)のたび、SWRでキャッシュした「コードを含む動的JS(spotlight-tpl/vocabx)」とアイコン類を破棄＝古いPWAでも次回取得で確実に最新化。重い地球儀テクスチャ(GLOBE_CACHE)だけ温存。
      .then(function () { return caches.open(MEDIA_CACHE).then(function (c) { return c.keys().then(function (rs) { return Promise.all(rs.filter(function (r) { return /(icon-|founder|apple-touch|spotlight-tpl|vocabx-data|mac-dock|index-mac|lookDown|iHax-AI|iHax-Apps|apps\.png|burble\.png|camera\.png|photos\.png|ppm-x\.png|sumi-beast-seed\.png|storymagic)/i.test(r.url); }).map(function (r) { return c.delete(r); })); }); }).catch(function () {}); })   // ★更新した画像類はcache-first残留を破棄して新版を取り直す
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
