// src/utils/testTrack.mjs
import { buildUniverseFromText } from "./ekubo.mjs";

function formatBigInt(bi) {
  if (bi === 0n) return "0";
  // extremely rough pretty-print; this is just debug
  const s = bi.toString();
  if (s.length > 12) {
    const mantissa = Number(s.slice(0, 3));
    const exp = s.length - 1;
    return `${mantissa.toFixed(0)}e${exp}`;
  }
  return s;
}

async function main() {
  const raw =
    process.argv.slice(2).join(" ") ||
    "STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM";

  console.log("🧪 Tracking test for universe:", raw);

  const universe = await buildUniverseFromText(raw);

  console.log("\n📊 Universe summary:");
  console.log("  Symbols requested:", universe.symbols.join(", "));
  console.log(
    "  Tradable vs USDC:",
    universe.tradable.map((t) => t.symbol).join(", ") || "(none)",
  );
  console.log(
    "  Unresolved:",
    universe.unresolved.join(", ") || "(none)",
  );

  console.log("\n📡 Per-token tracking info (USDC pools):");

  for (const t of universe.tradable) {
    const allPools = t.usdcPools || [];
    const activePools = allPools.filter(
      (p) => (p.liquidityBigInt ?? 0n) > 0n,
    );

    console.log(
      `\n=== ${t.symbol} (${t.address}) ===\n` +
        `Total USDC pools: ${allPools.length}\n` +
        `Active pools (liquidity > 0): ${activePools.length}`,
    );

    if (!activePools.length) {
      console.log("  (no active pools, just dust / empty)");
      continue;
    }

    // Sort active pools by liquidity descending
    activePools.sort((a, b) => {
      const A = a.liquidityBigInt ?? 0n;
      const B = b.liquidityBigInt ?? 0n;
      if (A === B) return 0;
      return A > B ? -1 : 1;
    });

    const top = activePools.slice(0, 5);

    console.log("  Top active pools:");
    for (const p of top) {
      const liq = p.liquidityBigInt ?? 0n;
      const keyShort = String(p.keyHash).slice(0, 10) + "…";
      console.log(
        `  • key ${keyShort} | fee: ${p.fee} | tickSpacing: ${p.tickSpacing} | liq: ${formatBigInt(
          liq,
        )}`,
      );
    }
  }

  console.log("\n✅ Tracking test complete.");
}

main().catch((err) => {
  console.error("❌ testTrack error:", err);
  process.exit(1);
});
