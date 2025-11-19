// src/strategy/strategies/strkGptStrategy.mjs
// -------------------------------------------------------------
// Dependency-free STRK swing strategy.
// Uses short vs long moving averages on the AVNU price feed.
// Tuned to be more *active* with a bootstrap first BUY.
// -------------------------------------------------------------

/**
 * ctx: {
 *   chatId,
 *   snapshot,
 *   priceData: [{ t, price }],
 *   latestPrice: number,
 *   position: { usdc, strk, latestPrice },
 *   now,
 *   mode
 * }
 */
export async function strkGptStrategy(ctx) {
  const { priceData, latestPrice, position } = ctx;

  const prices = (priceData || [])
    .map((p) => p.price)
    .filter((x) => typeof x === "number" && x > 0);

  if (!latestPrice || latestPrice <= 0) {
    return [];
  }

  // Need a minimum of points for MA logic
  if (prices.length < 10) {
    // not enough data yet, just hold
    return [];
  }

  const sma = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // More responsive windows
  const shortWindow = 3;
  const longWindow = 10;

  const shortMA = sma(prices.slice(-shortWindow));
  const longMA = sma(prices.slice(-longWindow));

  const momentum = shortMA - longMA;
  const relDiff = longMA ? momentum / longMA : 0;

  const usdc = Number(position.usdc ?? 0);
  const strk = Number(position.strk ?? 0);
  const strkUsd = strk * latestPrice;

  // Tunable knobs
  const baseSizeUsd = 50;    // target trade size
  const minRelDiff = 0.0005; // 0.05% threshold to act (more aggressive)

  // 🔹 Bootstrap: if we have *no* STRK but have USDC, open an initial long
  if (strkUsd < 1 && usdc >= 10) {
    const sizeUsd = Math.min(usdc, baseSizeUsd);
    return [
      {
        strategy: "ma-swing",
        side: "BUY",
        sizeUsd,
        confidence: 0.5,
        reason: "bootstrap: open initial STRK position with no existing holdings",
      },
    ];
  }

  // BUY condition: short MA > long MA by threshold and we have USDC
  if (relDiff > minRelDiff && usdc >= 10) {
    const strength = Math.min(1, relDiff / 0.005); // saturate around 0.5% diff
    const sizeUsd = Math.min(usdc, baseSizeUsd * (0.5 + strength));

    return [
      {
        strategy: "ma-swing",
        side: "BUY",
        sizeUsd,
        confidence: strength,
        reason: `short MA above long MA by ${(relDiff * 100).toFixed(3)}%`,
      },
    ];
  }

  // SELL condition: short MA < long MA by threshold and we have STRK
  if (relDiff < -minRelDiff && strkUsd >= 10) {
    const strength = Math.min(1, (-relDiff) / 0.005);
    const sizeUsd = Math.min(strkUsd, baseSizeUsd * (0.5 + strength));

    return [
      {
        strategy: "ma-swing",
        side: "SELL",
        sizeUsd,
        confidence: strength,
        reason: `short MA below long MA by ${(relDiff * 100).toFixed(3)}%`,
      },
    ];
  }

  // Otherwise: HOLD
  return [];
}
