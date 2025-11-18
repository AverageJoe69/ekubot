// src/strategy/testTrackerFromStore.mjs
import { buildUniverseFromText } from "../utils/ekubo.mjs";
import { setUniverse } from "../state/watchlist.mjs";
import { logTrackingSnapshot } from "./tracker.mjs";

async function main() {
  const chatId = 12345;
  const raw =
    process.argv.slice(2).join(" ") ||
    "STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM";

  console.log("🧪 Building and storing universe for chat", chatId);
  const universe = await buildUniverseFromText(raw);
  await setUniverse(chatId, universe);

  console.log("📡 Logging tracking snapshot from store…");
  await logTrackingSnapshot(chatId);

  console.log("✅ tracker-from-store test complete.");
}

main().catch((err) => {
  console.error("❌ testTrackerFromStore error:", err);
  process.exit(1);
});
