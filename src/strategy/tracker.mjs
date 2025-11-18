// src/strategy/tracker.mjs
import { getUniverse } from "../state/watchlist.mjs";

/**
 * Normalize a value into a BigInt, safely handling what survives JSON:
 * - string (e.g. "1000000000000000000")
 * - number
 * - bigint
 * - null/undefined
 */
function normalizeBigInt(value) {
  if (value === null || value === undefined) return 0n;

  if (typeof value === "bigint") return value;

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return 0n;
    return BigInt(s);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return BigInt(Math.floor(value));
  }

  // Anything else (object, etc.) → treat as zero.
  return 0n;
}

/**
 * Pick the best USDC pool for a token.
 * Strategy: highest liquidity (liquidityBigInt or liquidity).
 */
export function pickBestUsdcPoolForToken(token) {
  const allPools = Array.isArray(token.usdcPools) ? token.usdcPools : [];

  if (!allPools.length) return null;

  const activePools = allPools.filter((p) => {
    const liq = normalizeBigInt(
      p?.liquidityBigInt !== undefined ? p.liquidityBigInt : p?.liquidity,
    );
    return liq > 0n;
  });

  if (!activePools.length) return null;

  activePools.sort((a, b) => {
    const A = normalizeBigInt(
      a?.liquidityBigInt !== undefined ? a.liquidityBigInt : a?.liquidity,
    );
    const B = normalizeBigInt(
      b?.liquidityBigInt !== undefined ? b.liquidityBigInt : b?.liquidity,
    );
    if (A === B) return 0;
    return A > B ? -1 : 1;
  });

  return activePools[0];
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
      const liq = normalizeBigInt(
        p?.liquidityBigInt !== undefined ? p.liquidityBigInt : p?.liquidity,
      );
      return liq > 0n;
    });

    const bestPoolRaw = pickBestUsdcPoolForToken(t);

    const bestPool = bestPoolRaw
      ? {
          keyHash: bestPoolRaw.keyHash,
          fee: bestPoolRaw.fee,
          tickSpacing: bestPoolRaw.tickSpacing,
          liquidityBigInt: normalizeBigInt(
            bestPoolRaw.liquidityBigInt ?? bestPoolRaw.liquidity,
          ),
        }
      : null;

    return {
      symbol: t.symbol,
      address: t.address,
      totalUsdcPools: allPools.length,
      activeUsdcPools: activePools.length,
      bestPool,
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
