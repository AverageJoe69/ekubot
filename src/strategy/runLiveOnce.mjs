// src/strategy/runLiveOnce.mjs
import { tradeTick } from "./trading.mjs";
import { executeSingleTrade } from "./singleTradeExecutor.mjs";
import { buildUniverseFromText } from "../utils/ekubo.mjs";
import { setUniverse } from "../state/watchlist.mjs";

/**
 * Run one live trading cycle.
 *
 * dryRun = true  → simulate, no on-chain tx.
 * dryRun = false → actually call AVNU and trade on mainnet.
 */
async function runLiveOnce({ dryRun = true } = {}) {
  const chatId = 7514936297;
  const universeText = "STRK, ETH";

  console.log(
    "🧪 [runLiveOnce] Building universe for chat",
    chatId,
    "with symbols:",
    universeText,
  );

  // 1) Build & store universe in THIS process
  const universe = await buildUniverseFromText(universeText);
  await setUniverse(chatId, universe);

  console.log(
    "✅ Universe prepared with",
    universe.tradable?.length ?? 0,
    "tradable token(s).",
  );

  // 2) Run live trade tick
  console.log("🧪 Running LIVE trade tick for chat", chatId);

  const result = await tradeTick(chatId, { mode: "live" });

  if (!result.ok) {
    console.log("❌ tradeTick failed:", result.reason, result.message);
    process.exit(1);
  }

  if (!result.primaryIntent) {
    console.log("⚠️ No primary intent selected. Nothing to trade.");
    process.exit(0);
  }

  console.log("✅ Primary intent selected:");
  console.dir(result.primaryIntent, { depth: null });

  // 3) Execute the trade (now AVNU-backed, but still dry-run by default)
  console.log(`🚦 Executing trade (dryRun = ${dryRun})`);
  const txResult = await executeSingleTrade(result.primaryIntent, { dryRun });

  console.log("📨 Trade execution result:");
  console.dir(txResult, { depth: null });

  process.exit(0);
}

// NOTE: change dryRun: true → false when you’re ready for real swaps.
runLiveOnce({ dryRun: false }).catch((err) => {
  console.error("Fatal error in runLiveOnce:", err);
  process.exit(1);
});
