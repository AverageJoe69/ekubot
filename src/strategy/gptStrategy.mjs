// src/strategy/gptStrategy.mjs
// -------------------------------------------------------------
// TEMP STRK SWING STRATEGY (no external GPT dependency)
// -------------------------------------------------------------
//
// This is a simple heuristic swing strategy that mimics
// "buy low / sell high" behaviour using moving averages.
//
// Later, we can swap the internals of callGptStrategy to
// actually call your GPT model. The rest of the code
// (baseStrategy, trading loop, Telegram) can stay as-is.
//

/**
 * @param {Object} params
 * @param {Array} params.priceData - array of candles { open, high, low, close, volume }
 * @param {Object} params.position - { usdc, strk, latestPrice? }
 * @param {number} params.latestPrice
 * @param {string} params.now - ISO timestamp
 *
 * @returns {Promise<{
*   action: "BUY" | "SELL" | "HOLD",
*   confidence: number,
*   size_usdc: number,
*   reason: string
* }>}
*/
export async function callGptStrategy({ priceData, position, latestPrice, now }) {
 // Basic guards
 if (!Array.isArray(priceData) || priceData.length < 10 || !latestPrice) {
   return {
     action: "HOLD",
     confidence: 0.1,
     size_usdc: 0,
     reason: "not-enough-data",
   };
 }

 const closes = priceData.map((c) => Number(c.close ?? latestPrice));

 // Simple moving averages
 const shortWindow = 5;
 const longWindow = 15;

 const shortMa = average(closes.slice(-shortWindow));
 const longMa = average(closes.slice(-longWindow));

 const lastClose = closes[closes.length - 1];
 const prevClose = closes[closes.length - 2] ?? lastClose;

 const hasUsdc = (position.usdc ?? 0) > 0;
 const hasStrk = (position.strk ?? 0) > 0;

 // Very simple rules:
 //
 // BUY:
 // - short MA has crossed above long MA
 // - last close > prev close (up candle)
 // - we have USDC to spend
 //
 // SELL:
 // - short MA has crossed below long MA
 // - last close < prev close (down candle)
 // - we have STRK to sell
 //
 // Otherwise HOLD.

 const bullish = shortMa > longMa && lastClose > prevClose;
 const bearish = shortMa < longMa && lastClose < prevClose;

 // Default position size: 10% of USDC or STRK value, capped
 const maxTradeUsd = 50;
 const usdc = Number(position.usdc ?? 0);
 const strk = Number(position.strk ?? 0);
 const strkValueUsd = strk * latestPrice;

 if (bullish && hasUsdc) {
   const size_usdc = Math.min(usdc * 0.1, maxTradeUsd);
   if (size_usdc > 5) {
     return {
       action: "BUY",
       confidence: 0.7,
       size_usdc,
       reason: `bullish: shortMA(${shortMa.toFixed(
         4,
       )}) > longMA(${longMa.toFixed(4)}), up candle`,
     };
   }
 }

 if (bearish && hasStrk && strkValueUsd > 0) {
   const size_usdc = Math.min(strkValueUsd * 0.1, maxTradeUsd);
   if (size_usdc > 5) {
     return {
       action: "SELL",
       confidence: 0.7,
       size_usdc,
       reason: `bearish: shortMA(${shortMa.toFixed(
         4,
       )}) < longMA(${longMa.toFixed(4)}), down candle`,
     };
   }
 }

 // Otherwise HOLD
 return {
   action: "HOLD",
   confidence: 0.3,
   size_usdc: 0,
   reason: "no-clear-edge",
 };
}

function average(arr) {
 if (!arr.length) return 0;
 const sum = arr.reduce((acc, v) => acc + Number(v || 0), 0);
 return sum / arr.length;
}
