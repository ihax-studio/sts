/* ============================================================================
   seat-sync.js — 座席 入退室システムの Firebase RTDB 同期ブリッジ
   ----------------------------------------------------------------------------
   ・既存の table/card/board は localStorage('seatingApp_v1') を「ローカルキャッシュ」
     として今まで通り使う。本ブリッジが localStorage <-> RTDB を双方向同期する。
   ・教室(ルーム)単位: localStorage('seatRoom') のコードで rooms/<room> に紐付く。
       rooms/<room>/table              … 座席表（table.html が書く）
       rooms/<room>/persons/<personId> … 各カードが「自分の人物」だけ書く
       rooms/<room>/log/<pushId>       … 入退室ログ（push で追記）
   ・chat-app と同じ匿名認証(auth!=null)。設定は親と共通の firebase-config.js を使う。
   ・Firebase が無い/未設定/オフライン時は no-op に縮退 → ローカルのみで従来通り動作。
   ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'seatingApp_v1';
  var ROOM_KEY  = 'seatRoom';
  var bc = ('BroadcastChannel' in window) ? new BroadcastChannel(STORE_KEY) : null;

  function roomId() { try { return (localStorage.getItem(ROOM_KEY) || '').trim(); } catch (e) { return ''; } }
  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } } // undefined を落とす（RTDBはundefined不可）

  /* 直近の remote スナップショット（差分判定用） */
  var lastRemote = { table: null, persons: {}, log: {} };
  var ref = null, db = null, auth = null;
  var ready = false;          // 認証済み & ルーム購読中
  var queued = [];            // ready 前に来た push を退避
  var firstSyncDone = false;

  /* remote → local 反映時は「自分の保存」とみなさないためのガード */
  var applyingRemote = false;

  function writeLocal(s) {
    applyingRemote = true;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
    try { bc && bc.postMessage({ t: 'sync' }); } catch (e) {}      // 同一オリジンの他文書(card/board/table)へ
    try { window.dispatchEvent(new CustomEvent('seat-remote-sync', { detail: { first: !firstSyncDone } })); } catch (e) {} // 同一文書内のリスナへ
    applyingRemote = false;
  }

  /* remote スナップショット → ローカル store を再構築 */
  function applySnapshot(v) {
    v = v || {};
    lastRemote = { table: v.table || null, persons: v.persons || {}, log: v.log || {} };

    var persons = Object.keys(lastRemote.persons).map(function (k) {
      return Object.assign({ id: k }, lastRemote.persons[k]);
    });
    var log = Object.keys(lastRemote.log).map(function (k) {
      return Object.assign({}, lastRemote.log[k]);
    }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); });

    var s = loadStore();
    if (lastRemote.table) s.table = lastRemote.table;
    else if (firstSyncDone) delete s.table;   // 別端末で座席表が削除された → こちらも消す（初回同期では消さない）
    s.persons = persons;
    s.log = log;
    writeLocal(s);
    firstSyncDone = true;
  }

  function attach() {
    var rid = roomId();
    if (!db || !rid) return;
    if (ref) { try { ref.off(); } catch (e) {} }
    ref = db.ref('rooms/' + rid);
    ref.on('value', function (snap) { applySnapshot(snap.val()); });
    ready = true;
    var q = queued; queued = [];
    q.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function whenReady(fn) { if (ready && ref) { try { fn(); } catch (e) {} } else queued.push(fn); }

  /* ===== 公開 push API（各ページの変更点から明示的に呼ぶ）===== */
  var API = {
    available: function () { return ready && !!ref; },
    roomId: roomId,
    isApplyingRemote: function () { return applyingRemote; },

    setRoom: function (rid) {
      try { localStorage.setItem(ROOM_KEY, String(rid || '').trim()); } catch (e) {}
      firstSyncDone = false;
      if (db) attach();
    },

    /* 座席表（table.html の保存時） */
    pushTable: function (table) {
      if (!table) return;
      whenReady(function () { ref.child('table').set(clone(table)).catch(function () {}); });
    },

    /* 座席表を削除（board の長押し削除） */
    removeTable: function () {
      whenReady(function () { ref.child('table').remove().catch(function () {}); });
    },

    /* 人物 upsert（card が自分の人物だけ書く）。p は {id, name, seatId, seatLabel, status?, meta} */
    pushPerson: function (p) {
      if (!p || !p.id) return;
      var id = p.id; var rest = Object.assign({}, p); delete rest.id;
      whenReady(function () { ref.child('persons/' + id).update(clone(rest)).catch(function () {}); });
    },

    /* 在室/退室の確定 */
    setPersonStatus: function (id, status) {
      if (!id) return;
      whenReady(function () { ref.child('persons/' + id + '/status').set(status).catch(function () {}); });
    },

    /* 入退室ログを1件追記 */
    pushLog: function (entry) {
      if (!entry) return;
      whenReady(function () { ref.child('log').push(clone(entry)).catch(function () {}); });
    },

    /* 人物+そのログを削除（board の削除モード） */
    removePerson: function (id) {
      if (!id) return;
      whenReady(function () {
        ref.child('persons/' + id).remove().catch(function () {});
        ref.child('log').once('value', function (s) {
          var v = s.val() || {};
          Object.keys(v).forEach(function (k) {
            var e = v[k];
            if (e && (e.personId === id || (e.name + '|' + e.seatId) === id)) {
              ref.child('log/' + k).remove().catch(function () {});
            }
          });
        });
      });
    }
  };

  window.SeatSync = API;

  /* ===== 初期化 ===== */
  (function init() {
    if (!window.firebase || !window.FIREBASE_CONFIG) {
      // Firebase 未ロード/未設定 → ローカルのみで動作（API は no-op キューに溜まるだけ）
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    } catch (e) {}
    try {
      if (firebase.appCheck && window.RECAPTCHA_SITE_KEY) firebase.appCheck().activate(window.RECAPTCHA_SITE_KEY, true);
    } catch (e) {}
    try {
      auth = firebase.auth();
      db = firebase.database();
    } catch (e) { return; }

    auth.onAuthStateChanged(function (u) {
      if (u) { attach(); return; }
      auth.signInAnonymously().catch(function (err) {
        try { console.warn('[seat-sync] anonymous auth failed', err && err.code); } catch (e) {}
      });
    });
  })();
})();
