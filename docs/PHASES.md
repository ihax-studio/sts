# Shake to Shake / Meet to Meet — フェーズ計画

各フェーズの詳細は `docs/phases/<id>.md` に記載。本書はそれらを束ねるマスター資料です。

---

## 概要

このリポジトリには **2つの独立したコードベース** が同居しており、データモデルも別系統です。フェーズはこの2系統のどちらに属するか（あるいは両者の橋渡しか）を意識すると整理しやすくなります。

| コードベース | エントリ | データ層 | 役割 |
| --- | --- | --- | --- |
| **globe-chat** | `index.html`（単一HTML / build-index.mjs で生成） | Firebase RTDB `rooms/`（自前チャット層 `dm_a_b`・`{u,text,t}`）、`s2s/`、`posts/` | 3Dグローブ + シェイク共有 + 音楽プレビュー + 管理者ツール。本番 = `shake-to-shake.netlify.app` |
| **Meet to Meet** | `meettomeet.html`（+ `app.js` / `shaketoshake.css` / `firebase-config.js`） | Firebase RTDB `chats/<cid>`・`groups/`・`convos/`（`{f,t,ts}` 規格、暗号 salt = cid） | 登録 → ホーム → DM/グループチャット。クラシック版 = `classic.html` |

- 暗号は **会話ID（cid）を salt** に使うため、両系統のチャット統合（フェーズ06）は ID 規格の統一が暗号互換の前提になります。
- サーバ側の cron/保存は `worker/`（Cloudflare Workers + Telegram/R2）。Firebase ルールは `database.rules.json`。
- 多くのフェーズは「コードは実装済み・あとは Firebase ルールの本番反映や実機検証だけ」という状態です（特に 05 / 13）。

---

## フェーズ一覧

| ID | タイトル | グループ | 優先度 | 工数 | 主な依存 | 1行 how-to | 詳細 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 背景切り替えを確実に動作＋ボタンの枠を消す | B | medium | S | なし | `index.html` の `.gc-bgpick-opt` に `outline:none` ＋ `-webkit-tap-highlight-color:transparent` で枠を消し、Off/Blur 即時反映済・Color は iOS の `input[type=color]` パネル起動を実機確認 | [01-bg-picker-fix.md](phases/01-bg-picker-fix.md) |
| 02 | 変更ダイヤログを0.3s scaleupで出/消 | B | medium | S | なし | `vis`+RAF で `.vis`(display)→次フレームで `.show`(opacity/transform)、カードを `scale(.9→1)`+opacity 0.3s ease。閉じは show 除去300ms後に vis 除去 | [02-dialog-scaleup.md](phases/02-dialog-scaleup.md) |
| 03 | meettomeet.html を稼働させる | B | **high** | M | `shaketoshake.css` / `lib/firebase-*-compat.js` / `firebase-config.js` / `app.js` / 匿名認証・App Check | HTTP配信(ルート直下・file://不可)で開き、`boot()→show()` splash→scrReg→scrHome 遷移と `ensureAuth` をConsoleで確認、404/CSP/SW を潰す | [03-meettomeet-boot.md](phases/03-meettomeet-boot.md) |
| 04 | 下部までコンテンツ表示＋下部シャドウ削除＋アクティビティ終了ボタン | B | medium | M | 対象シャドウ確定・`__openActivity` トリガ特定（要ユーザ確認） | `shaketoshake.css:110` の `.list` 下パディング110pxを縮め下端まで表示、`--app-bg` 下グラデ or ボタン box-shadow 削除、終了= `app.js:1554`(act-quit) / 離脱= `app.js:414`(leaveGroup) | [04-meettomeet-layout.md](phases/04-meettomeet-layout.md) |
| 05 | meettomeet グループ作成バグ修正 | B | medium | S | `database.rules.json` の groups/chats/last/userGroups ルールが本番デプロイ済 | `createGroupFromSel`(app.js:388-413) は groups+userGroups アトミック書込→chats/last を別 set() に分離済（真因= last write rule の pre-update評価）。まず実機/emulatorで検証、残れば read-after-write で直列化補強 | [05-meettomeet-group-bug.md](phases/05-meettomeet-group-bug.md) |
| 06 | meettomeet ↔ index のチャットトンネル統一 | B | medium | **XL** | ルール改修反映・cid 規格読込（要確認）・既存 rooms/ 移行判断 | `index.html` の自前層(`rooms/dm_a_b`・`{u,text,t}`)を `app.js` 規格(`chats/<cid=a__b>`・`{f,t,ts}`+convos/last)へ寄せ、会話ID・暗号salt・FBルールを1本化 | [06-chat-tunnel-unify.md](phases/06-chat-tunnel-unify.md) |
| 07 | シェイク共有のSNS化（通知ゲート/40分窓/Telegram保存） | B | medium | M | `worker/telegram-storage.js`(STORAGE_URL)・`worker/s2s-push.js`(PUSH_URL)・`storage.js` / `index-s2s.js` | `index-s2s.js` の40分窓(`WIN`)・通知ゲート(`gated`)・Telegram保存(`Store.putImage→s2s/<uid>`)を globe-chat へ移植、`onMotion` を s2s投稿へ分岐、閲覧を `s2s/` に一本化 | [07-shake-sns.md](phases/07-shake-sns.md) |
| 08 | フルスクリーン音楽プレイヤー（アルバムカルーセル/EQ） | C | medium | L | 07-music-mini-nowplaying（ミニプレイヤー） | iindex.html の `#player`(カルーセル/Web Audio EQ/scrub)を index.html へ移植、ミニ `#gcNp` タップ→`openPlayer`。最重要は `_mapTracks` を raw iTunes フィールド温存に拡張（データshape統一） | [08-music-fullplayer.md](phases/08-music-fullplayer.md) |
| 09 | empty のサーバ側実削除＋サーバ定期バックアップ | B | **high** | L | ルール反映(rooms msgs `.indexOn:[t]`+empty admin限定)・`wrangler.toml` に `ROOMS_EMPTY_MIN`+R2 binding・R2バケット | `worker/telegram-storage.js` の cron に `purgeExpiredRooms`(shallow列挙→orderBy="t"&endAt で古い msgs だけ PATCH null)と `backupRtdb`(rooms を JSON で R2/Telegram へ)を追加。既存 purgeExpired は convos/chats 専用＝rooms は今ゼロ | [09-empty-server-backup.md](phases/09-empty-server-backup.md) |
| 10 | 画像トランスコード（512色/最大800px） | C | medium | M | なし | `sendImages` の push 直前で全 shots を新設 `transcodeDataURL`（最大800px縮小＋RGB各3bit量子化で512色相当＋JPEG/WebP再圧縮）に通し RTDB バイト量削減 | [10-image-transcode.md](phases/10-image-transcode.md) |
| 11 | 全ユーザーの地域マッププロット（iOSマップ風） | C | medium | L | `project()` / `__globe`・ルールに `regionStats` 追加・Worker cron集計・`getMyLocation` に cc | `project()`/`CC_LATLON`/`buildFriendPins` を流用しピン描画共通化。管理者= `openAdminList` の users 全件で個別ピン(モードA)、全員向け= 公開 `regionStats` を Worker 集計し地域ヒート(モードB) | [11-user-map-plot.md](phases/11-user-map-plot.md) |
| 12 | アカウント詳細の🫨📎🗺️を機能化 | C | low | S | 07-shake-sns | `index.html:2633` の disabled 3ボタンに ID付与+disabled除去、3936直後に onclick。🫨=`openChat`+シェイク誘導／📎=隠し file input→`rooms/<room>/msgs` 画像push／🗺️=相手 loc へ `flyTo`+`buildFriendPins` | [12-acct-icons.md](phases/12-acct-icons.md) |
| 13 | 管理者の複数デバイス共有受信（Firebaseルール反映） | C | **high** | S | `database.rules.json`(git 47c744b)・project `ichat-pwa` admin・各端末 `prof.admin=true` | クライアントは実装済(`ADMIN_ID=and_admin`/`myAddr`/`watchFriends` が friends/and_admin と friends/uid を二重購読)。残りは `friends/and_admin`(.read=auth!=null) を本番へ反映する1手のみ | [13-admin-multidevice.md](phases/13-admin-multidevice.md) |

工数の目安: **S** = 数十分〜1時間、**M** = 半日、**L** = 1日前後、**XL** = 複数日。

---

## 推奨実行順

基本方針は **Group A（index の小修正・即効） → Group B（meettomeet を動かす土台） → Group C（新機能）** ですが、それを「すぐ終わる高優先（S/M）を先に」で並べ替えています。Group A は現状フェーズ未割当（01・02 が index 系の小修正に相当）なので、実務上は **「軽い index 修正 → meettomeet を起動 → サーバ衛生（empty/backup） → 機能拡張」** の流れです。

### ステップ 1 — まず本番反映だけで効く高優先（数手で完了）

1. **13 管理者の複数デバイス共有**（C / high / S）— クライアント実装済。`database.rules.json` の `friends/and_admin` 反映 **1手** のみ。最小コストで最大効果なので最初に片付ける。
2. **05 グループ作成バグ修正**（B / medium / S）— コード分離は済。ルール本番デプロイ済か実機/emulator で検証し、直っていれば確認だけで完了。

> 13 と 05 はいずれも「`firebase deploy --only database`（または Console 貼付）＋実機確認」で閉じられる可能性が高く、ロードマップの足場固めになります。

### ステップ 2 — index 系の軽い UI 修正（Group A 相当・依存なし）

3. **01 背景ピッカー＆枠消し**（B / medium / S・依存なし）
4. **02 ダイアログ scaleup アニメ**（B / medium / S・依存なし）

> どちらも `index.html` 単体・依存ゼロ。CSS/RAF の小修正で、リスクが低く UX 改善が見える。

### ステップ 3 — meettomeet を「動く」状態にする（Group B の土台）

5. **03 meettomeet.html を稼働**（B / **high** / M）— Meet to Meet 系フェーズ全部の前提。これが動かないと 04/06 が検証できない。
6. **04 レイアウト＆終了ボタン**（B / medium / M）— 03 で起動した状態に対する調整。シャドウ対象と `__openActivity` トリガはユーザ確認待ちが残る。

### ステップ 4 — サーバ衛生（高優先・放置すると DB が肥大）

7. **09 empty のサーバ側実削除＋バックアップ**（B / **high** / L）— 現状 rooms の実削除がゼロ。Worker cron ＋ R2 のセットアップが要るので L だが、優先度は高い。データ肥大とバックアップ欠如のリスクを早めに解消する。
8. **10 画像トランスコード**（C / medium / M・依存なし）— 09 と同じく「RTDB のバイト量を減らす」系。09 と前後どちらでも可。送信前 1関数挿入で完結。

### ステップ 5 — シェイク共有を SNS 化（後続機能のハブ）

9. **07 シェイク共有の SNS 化**（B / medium / M）— 12（アイコン機能化）の依存元。`s2s/` への一本化はここで確立する。

### ステップ 6 — 新機能（Group C・体験拡張）

10. **08 フルスクリーン音楽プレイヤー**（C / medium / L）— ミニ now-playing が前提（07-music-mini-nowplaying）。
11. **11 地域マッププロット**（C / medium / L）— Worker 集計とルール追加を伴う独立機能。
12. **12 アカウント詳細アイコン機能化**（C / low / S）— 07 完了後に着手。既存関数の再利用のみで軽い仕上げ。

### ステップ 7 — 最後に最重量（要時間・先行統合が前提）

13. **06 チャットトンネル統一**（B / medium / **XL**）— index の `rooms/` を app.js の `chats/` 規格へ寄せる大改修。暗号 salt = cid のため ID 統一が必須で、既存 rooms/ メッセージの移行判断（復号→再暗号 or 切り捨て）も伴う。03（meettomeet 稼働）が前提、05/13 のルール整備の延長線上にあるので、土台が固まった最後に回すのが安全。

> **要点**: まず 13 → 05 の「ルール反映で閉じる高優先」を片付け、続いて 01/02 の軽い index 修正で勢いをつける。次に 03→04 で meettomeet を立ち上げ、09/10 でサーバ衛生を整える。SNS ハブの 07 を済ませてから C グループ（08/11/12）の機能拡張に進み、最重量で破壊的な 06 のチャット統合は土台が全部固まった最後に着手する。

---

## グループ別サマリ

### Group A — index の小修正（即効・低リスク）
現状フェーズIDの明示割当はありませんが、**01・02** が実質ここに該当します（`index.html` 単体・依存なし・工数 S）。CSS と RAF アニメの軽微な修正で、最初に勢いをつける枠。

### Group B — Meet to Meet を動かす & globe-chat の土台
- **03**（high/M）: meettomeet を起動させる前提フェーズ。
- **04**（medium/M）: 起動後のレイアウト・終了ボタン調整。
- **05**（medium/S）: グループ作成バグ。コード済・ルール反映と検証が残課題。
- **06**（medium/XL）: 2系統チャットの統一。最重量・破壊的・最後。
- **07**（medium/M）: シェイク共有の SNS 化。12 の依存元。
- **09**（high/L）: empty の実削除＋サーバ定期バックアップ。サーバ衛生の核。

Group B は「meettomeet を立ち上げる（03/04）」「データ層を健全化する（05/09）」「共有体験を拡張する（07）」「最後に2系統を統合する（06）」の4塊。

### Group C — 新機能（体験拡張）
- **08**（medium/L）: フルスクリーン音楽プレイヤー（ミニ now-playing が前提）。
- **10**（medium/M）: 画像トランスコード（送信前1関数・依存なし）。
- **11**（medium/L）: 全ユーザー地域マップ（Worker 集計＋ルール追加）。
- **12**（low/S）: アカウント詳細アイコン機能化（07 完了後）。
- **13**（high/S）: 管理者の複数デバイス共有受信。クライアント済・ルール反映1手。最優先で先に片付けるべき例外。

Group C は基本的に後段の機能拡張ですが、**13 だけは「ルール反映1手で閉じる high 優先」** なので、グループの順序に関わらずロードマップ冒頭で処理します。
