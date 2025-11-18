// src/utils/testUniverse.mjs
import { buildUniverseFromText } from "./ekubo.mjs";

async function main() {
  const raw = process.argv.slice(2).join(" ") ||
    "STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM";

  console.log("🧪 Building universe for:", raw);
  const universe = await buildUniverseFromText(raw);

  console.log("\n✅ Universe object:");
  console.dir(universe, { depth: 4 });

  console.log("\n📊 Summary:");
  console.log("  Symbols requested:", universe.symbols.join(", "));
  console.log("  Tradable vs USDC:", universe.tradable.map(t => t.symbol).join(", ") || "(none)");
  console.log("  Unresolved:", universe.unresolved.join(", ") || "(none)");

  console.log("\n🔧 Per-token USDC pools:");
  for (const t of universe.tradable) {
    console.log(
      `- ${t.symbol}: ${t.usdcPools?.length ?? 0} pool(s), address ${t.address}`,
    );
  }
}

main().catch((err) => {
  console.error("❌ testUniverse error:", err);
  process.exit(1);
});
