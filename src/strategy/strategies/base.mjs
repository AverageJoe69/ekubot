// src/strategy/strategies/base.mjs

/**
 * Very simple "base" strategy.
 *
 * Idea:
 * - For each token in the universe
 * - If it has an active best pool and enough liquidity
 * - Emit a BUY intent for a small fixed USDC notional (paper only for now)
 *
 * This is intentionally dumb – the point is to define the *shape* of a
 * strategy module that we can extend later (whale-following, new coins,
 * volume-based, etc.).
 */

/**
 * @param {object} ctx
 *   { chatId, mode, snapshot, now }
 * @returns {Promise<Array<object>>} intents
 */
export async function baseStrategy(ctx) {
    const snapshot = ctx.snapshot;
    const intents = [];
  
    // Hard-coded knobs for now; can later come from env or Telegram config
    const minLiquidity = 1_000_000_000_000n; // 1e12, arbitrary
    const defaultSizeUsd = 10; // "we would buy 10 USDC of each token"
  
    for (const t of snapshot.tokens) {
      if (!t.bestPool) continue;
  
      const liq =
        typeof t.bestPool.liquidityBigInt === "bigint"
          ? t.bestPool.liquidityBigInt
          : 0n;
  
      if (liq <= minLiquidity) {
        // Skip very illiquid pools in base strategy
        continue;
      }
  
      // For now: always BUY with fixed size.
      // Later: side/size can depend on price action or other signals.
      intents.push({
        strategy: "base",
        symbol: t.symbol,
        tokenAddress: t.address,
        side: "BUY", // or "SELL" in future
        sizeUsd: defaultSizeUsd,
        poolKeyHash: t.bestPool.keyHash,
        fee: t.bestPool.fee,
        tickSpacing: t.bestPool.tickSpacing,
        liquidityBigInt: liq,
        reason: "base-liquidity-threshold",
        meta: {
          minLiquidity: String(minLiquidity),
        },
      });
    }
  
    return intents;
  }
  