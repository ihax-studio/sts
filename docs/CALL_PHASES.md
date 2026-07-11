# 通話機能 フェーズ計画（SkyWay 音声通話 + PWA着信 + リッチUI）

shake-to-shake（globe-chat / index.html）に、SkyWay(WebRTC)の音声通話を「iPhoneのPWAホーム画面」で実用化する計画。
本物の電話風UI・着信音・シェイク振動・画像/テキスト送信・グループ・端末転送までを段階実装する。

---

## ⚠️ iOS PWA の現実（できる/できない）— 設計の前提
ユーザー調査の通り。これを踏まえてUIを設計する。
- ❌ **CallKit / ロック画面の全画面着信UI** … ネイティブ専用。PWAでは不可。
- ❌ **Web Push のカスタム着信音** … iOSはシステムのプッシュ音に固定。`sound` 無視。
- ❌ **Web Push の画像(image)** … iOSは無視（テキストのみ）。
- ✅ **アプリバッジ**（`navigator.setAppBadge(n)`）… 着信/不在をホーム画面に数字表示。
- ✅ **通知タップ→`clients.openWindow()`** … PWAを起動し、URLパラメータで着信ルームへ直行。
- ✅ **アプリを開いた中（in-app）でのリッチUI・カスタム着信音(.m4r/AudioContext)・WebRTC音声** … 全部可能。
- ⚠️ **PiP（ホーム画面で継続）** … iOSは音声のみのPiP不可。映像なしでは難。代替＝バッジ+通知+復帰ピル。

**着地点**：着信＝「Web Pushでシステム通知＋バッジ」→ ユーザーがタップ→ PWAが開き → **アプリ内で選択した着信音(.m4r)を大音量再生＋Image#14の着信UI** → 応答で SkyWay 音声接続。アプリを開いている間は本物の電話に近い体験。

---

## 🔑 前提・依存（着手前に必要）
- **SkyWay 無料プラン**：`App ID` と `Secret`。トークンは**Cloudflare Worker**で署名生成（Secretはクライアントに出さない）。→ ユーザーが SkyWay コンソールで App 作成し App ID/Secret を提供。
- **1GB/月 制限**：使用量は SkyWay 側計測。クライアントで概算（通話秒数×ビットレート）を持ち、**800MB超で「通話がもうすぐ終了します」警告**。
- **実音声テストは実機2台必須**（headlessでWebRTC音声は検証不可）。UI/フローはheadlessで検証。
- アイコン（配置済）：`mic.png` `photos.png` `phone.down.fill.png` `phone.arrow.down.left.png` `shake-shake.png` `user.png`。着信音 `Reflection*.m4r`（配置済・通話Appで選択）。

---

## フェーズ

### Phase 1 — 通話UIシェル（音声なし・見た目と操作だけ）  ※creds不要・先行可
Image #6/#15 の通話画面 + Image #14 の着信UI + Image #13 の「通話を再開」ピルを実装（モック）。
- 通話画面（フレームなし・blur・シンプル）：シルク風背景blur / 上に "Hello"・下に "Hi!" メッセージ流れ / 中央 `mic.png`(白丸) / 左 シェイク絵文字(🫨/shake-shake) / 右 `photos.png` / 左下 ピンク `phone.down.fill`(終了) / 右下 `user.png`(グループ) / 下部テキスト入力(0.5s scaleup)。
- 着信UI（Image#14）：Dynamic Island風ピル・赤(拒否)/緑(応答)・"Hi! User"。
- 復帰ピル（Image#13）：最小化時の「通話を再開」黒ピル。
- メッセージ吹き出し（Image#10/11/12）：絵文字+テキスト、入力 "Hey!" 0.5s scaleup。
- **検証**：CDP実描画で各UI表示・ボタン・アニメ。

### Phase 2 — SkyWay 1:1 音声接続  ※要 creds
- SkyWay SDK(CDN) 読込。`worker/skyway-token.js`(Cloudflare Worker)で App ID/Secret からトークン署名。
- 友達を選んで発信→相手着信→応答で **音声(モノラル・低ビットレート)接続**。終了で切断。
- マイク mute/unmute、相手の接続/切断状態表示。
- **検証**：実機2台（headlessはトークン取得とSDK初期化までを確認）。

### Phase 3 — 着信通知（Web Push）+ 着信音
- 発信時：相手の `push/<uid>` へ Web Push（既存 PUSH_URL Worker 再利用）。本文「〇〇から着信」+ `setAppBadge(1)`。
- 通知タップ→ `openWindow('/?call=<room>&from=<uid>')` → アプリ起動→ **選択中の着信音(.m4r)を大音量ループ再生** + Image#14 着信UI。
- 通話キャンセル時：サイレントPushで通知を `notification.close()`（鳴り止め）。
- **検証**：実機（push購読は実機必須）。

### Phase 4 — 通話中の拡張（マイク/シェイク/画像/テキスト）
- **マイク push-to-talk**：長押し=発話中（相手へ送話）、**ダブルタップ=10分ONのまま**（連続通話）。
- **シェイク→振動**：通話中に端末を振る(devicemotion)→相手に振動イベント送信→相手が `navigator.vibrate`。
- **画像送信**：`photos.png`→ピッカー→**1024色・長辺950px以下**に圧縮→0.5s scaleupで下入力から送信。
- **テキスト送信**：下部入力に打って送信、入力時0.5s scaleup。
- **検証**：UI/圧縮/イベントはheadless、実送受信は実機2台。

### Phase 5 — グループ通話
- 右下 `user.png`→**グループ通話**（SkyWay Room に複数参加）。退出/終了。
- 既存グループ(`groups/<gid>`)と連携してメンバー招集。
- **検証**：実機複数。

### Phase 6 — 仕上げ（継続/制限/転送）
- **データ制限**：概算使用量を保持、**800MB超で警告**、1GBで終了案内。
- **継続/復帰**：ホームへ戻っても通話セッション維持（音声は継続）＋ Image#13「通話を再開」ピルで戻る（iOS PiP不可のため擬似）。
- **端末転送**：共通ログイン中の別デバイスへ通話を転送（`phone.arrow.down.left.png`）。現端末で切り別端末で再接続するハンドオフ。
- **検証**：実機・複数デバイス。

---

## 進め方
Phase 1（UIシェル）は creds 不要なので**先に実装・検証・push**できる。
並行して SkyWay の App ID/Secret を用意 → Phase 2 以降（実音声）。
各フェーズ末で commit/push（SW_VER bump）→ Netlify デプロイ。実機検証はユーザー。
