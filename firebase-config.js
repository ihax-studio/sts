/* Firebase設定（ichat-pwa）— 確定版 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCUIZzl-T4Vn3XaofEtsoI3S5zlNt8xsXI",
  authDomain: "ichat-pwa.firebaseapp.com",
  databaseURL: "https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ichat-pwa",
  storageBucket: "ichat-pwa.firebasestorage.app",
  messagingSenderId: "492134459695",
  appId: "1:492134459695:web:98fb0367b530abbe2299da"
};

/* 画像/ファイル保存（Telegram中継 Cloudflare Worker）の公開URL */
window.STORAGE_URL = "https://shake-toshake.s-users15.workers.dev";

/* Web Push（通知）の VAPID 公開鍵。※公開鍵なので埋め込みOK。秘密鍵は絶対に置かない（Worker側のみ） */
window.VAPID_PUBLIC = "BEOTq3FWs7sWBargPnFUm0N5MXLHeoV_WcLrteNgtxz8M7SPhg49-n0AMkuw3fBaWaVKTSc5s2p9iVTVWNtYMOo";
/* 通知送信Workerの公開URL（shake-push Worker の /push エンドポイント） */
window.PUSH_URL = "https://shake-push.s-users15.workers.dev/push";

/* App Check（ボット/連打対策）の reCAPTCHA v3 サイトキー。※サイトキーは公開OK */
window.RECAPTCHA_SITE_KEY = "6LfMsBwtAAAAALnqY-OUxeKzZPk2PGkzSb3RGPzp";

/* メッセージ暗号化のアプリ共有ペッパー（会話鍵 = PBKDF2(pepper, salt=cid)）。
   ・Firebase に平文を残さないための「保存時暗号化」用。DBダンプ流出に強い。
   ・管理者「と」も cid から同じ鍵を導出できる＝中継/プレビュー/empty modeが従来どおり動く。
   ・クライアント配布物なので“完全な秘密”ではない（=現状の信頼モデルと同じ）。本物のE2EEが要るなら別途鍵交換が必要。
   ※ Cron Worker でTelegram画像を消すだけなら復号不要（message_idは平文保持）なので、Worker側にこの値を置く必要はない。 */
window.CHAT_PEPPER = (function(){ var _b=atob("Vk9WFk0KFgxqQwkfcEsCGlphSQ93XQMdbF8IZXVYDRFzWQp7bVwO"),_s=""; for(var _i=0;_i<_b.length;_i++){ _s+=String.fromCharCode(_b.charCodeAt(_i)^0x3B); } return _s; })();   // ★合言葉を難読化(XOR+base64・値は従来と同一・検証済)
