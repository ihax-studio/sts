/* ihax-worker.js — iHax(オンデバイスLLM)の WebLLM ハンドラスレッド。
   ★バージョンは ihax.js 側の dynamic import と必ず同一に固定(0.2.84)。
     main/worker が別バージョンを掴むとプロトコル不一致で「沈黙クラッシュ」する
     (qwenpad-cf で実証済みの事故パターン)。上げる時は ihax.js と同時に。
   ★CSP の都合で cdn.jsdelivr.net を使用(esm.run は connect/script 先として不許可)。 */
import { WebWorkerMLCEngineHandler } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
