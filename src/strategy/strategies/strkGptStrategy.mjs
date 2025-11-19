// src/strategy/strategies/strkGptStrategy.mjs
// -------------------------------------------------------------
// Dependency-free STRK swing strategy.
// Uses short vs long moving averages on the AVNU price feed.
// No OpenAI / no external packages.
// -------------------------------------------------------------

/**
 * ctx: {
 *   chatId,
 *   snapshot,
 *   priceData: [{ ts, price }],
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

  // Need at least 20 points for MA
  if (prices.length < 20) {
    return [];
  }

  const sma = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const shortWindow = 5;
  const longWindow = 20;

  const shortMA = sma(prices.slice(-shortWindow));
  const longMA = sma(prices.slice(-longWindow));

  const momentum = shortMA - longMA;
  const relDiff = longMA ? momentum / longMA : 0;

  const usdc = Number(position.usdc ?? 0);
  const strk = Number(position.strk ?? 0);
  const strkUsd = strk * latestPrice;

  // Tunable knobs
  const baseSizeUsd = 50;      // target trade size
  const minRelDiff = 0.003;    // 0.3% threshold to act

  // BUY condition: short MA > long MA by threshold and we have USDC
  if (relDiff > minRelDiff && usdc >= 10) {
    const strength = Math.min(1, relDiff / 0.01); // saturate at ~1% diff
    const sizeUsd = Math.min(usdc, baseSizeUsd * (0.5 + strength));

    return [
      {
        strategy: "ma-swing",
        side: "BUY",
        sizeUsd,
        confidence: strength,
        reason: `short MA above long MA by ${(relDiff * 100).toFixed(2)}%`,
      },
    ];
  }

  // SELL condition: short MA < long MA by threshold and we have STRK
  if (relDiff < -minRelDiff && strkUsd >= 10) {
    const strength = Math.min(1, (-relDiff) / 0.01);
    const sizeUsd = Math.min(strkUsd, baseSizeUsd * (0.5 + strength));

    return [
      {
        strategy: "ma-swing",
        side: "SELL",
        sizeUsd,
        confidence: strength,
        reason: `short MA below long MA by ${(relDiff * 100).toFixed(2)}%`,
      },
    ];
  }

  // Otherwise: HOLD
  return [];
}
