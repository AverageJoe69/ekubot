// src/strategy/tracker.mjs
import { getUniverse } from "../state/watchlist.mjs";

/**
 * Pick the best USDC pool for a token.
 * Strategy: highest liquidityBigInt > 0.
 */
export function pickBestUsdcPoolForToken(token) {
  const allPools = Array.isArray(token.usdcPools) ? token.usdcPools : [];

  const active = allPools.filter((p) => {
    const liq =
      p && typeof p.liquidityBigInt === "bigint"
        ? p.liquidityBigInt
        : 0n;
    return liq > 0n;
  });

  if (!active.length) return null;

  active.sort((a, b) => {
    const A =
      a && typeof a.liquidityBigInt === "bigint"
        ? a.liquidityBigInt
        : 0n;
    const B =
      b && typeof b.liquidityBigInt === "bigint"
        ? b.liquidityBigInt
        : 0n;
    if (A === B) return 0;
    return A > B ? -1 : 1;
  });

  return active[0];
}

/**
 * Build a tracking snapshot from the stored universe for a chat.
 * Used by Telegram `/show_pairs` and by the trading loop.
 */
export async function buildTrackingSnapshot(chatId) {
  const universe = await getUniverse(chatId);

  if (
    !universe ||
    !Array.isArray(universe.tradable) ||
    universe.tradable.length === 0
  ) {
    return {
      chatId: String(chatId),
      hasUniverse: false,
      universe: universe || null,
      universeUpdatedAt:
        universe && universe.updatedAt ? universe.updatedAt : null,
      tokens: [],
    };
  }

  const tokens = universe.tradable.map((t) => {
    const allPools = Array.isArray(t.usdcPools) ? t.usdcPools : [];

    const activePools = allPools.filter((p) => {
      const liq =
        p && typeof p.liquidityBigInt === "bigint"
          ? p.liquidityBigInt
          : 0n;
      return liq > 0n;
    });

    const bestPool = pickBestUsdcPoolForToken(t);

    return {
      symbol: t.symbol,
      address: t.address,
      totalUsdcPools: allPools.length,
      activeUsdcPools: activePools.length,
      bestPool: bestPool
        ? {
            keyHash: bestPool.keyHash,
            fee: bestPool.fee,
            tickSpacing: bestPool.tickSpacing,
            liquidityBigInt:
              typeof bestPool.liquidityBigInt === "bigint"
                ? bestPool.liquidityBigInt
                : 0n,
          }
        : null,
    };
  });

  return {
    chatId: String(chatId),
    hasUniverse: true,
    universeUpdatedAt: universe.updatedAt,
    tokens,
  };
}

/**
 * For CLI / logging.
 */
export async function logTrackingSnapshot(chatId) {
  const snap = await buildTrackingSnapshot(chatId);

  if (!snap.hasUniverse) {
    console.log(
      "[tracker] No universe set for chat",
      chatId,
      "Use /set_universe first.",
    );
    return;
  }

  console.log(
    "[tracker] Universe for chat",
    chatId,
    "(updated",
    snap.universeUpdatedAt,
    ")",
  );

  for (const t of snap.tokens) {
    console.log(
      "\n===" +
        " " +
        t.symbol +
        " " +
        "(" +
        t.address +
        ")" +
        " ===\n" +
        "Total USDC pools: " +
        t.totalUsdcPools +
        "\n" +
        "Active pools: " +
        t.activeUsdcPools,
    );

    if (!t.bestPool) {
      console.log("  (no active pools with liquidity > 0)");
      continue;
    }

    const keyShort = String(t.bestPool.keyHash).slice(0, 10) + "…";
    console.log(
      "  Best pool: " +
        keyShort +
        " | fee: " +
        t.bestPool.fee +
        " | tickSpacing: " +
        t.bestPool.tickSpacing +
        " | liq: " +
        t.bestPool.liquidityBigInt.toString(),
    );
  }
}
