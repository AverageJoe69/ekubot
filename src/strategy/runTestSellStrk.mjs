// src/strategy/runTestSellStrk.mjs
import { executeSingleTrade } from "./singleTradeExecutor.mjs";

async function main() {
  // One-off test intent: SELL $10 worth of STRK into USDC
  const testIntent = {
    strategy: "manual-test",
    symbol: "STRK",
    side: "SELL",
    sizeUsd: 10,
  };

  console.log("🧪 Running ONE-OFF LIVE TEST: SELL $10 STRK → USDC");
  const result = await executeSingleTrade(testIntent, { dryRun: false });

  console.log("📨 Live test trade result:");
  console.dir(result, { depth: null });
}

main().catch((err) => {
  console.error("Fatal error in runTestSellStrk:", err);
  process.exit(1);
});
