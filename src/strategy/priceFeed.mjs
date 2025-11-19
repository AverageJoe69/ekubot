// src/strategy/priceFeed.mjs
// -------------------------------------------------------------
// REAL STRK price feed via AVNU quotes endpoint.
// -------------------------------------------------------------

import axios from "axios";

// AVNU endpoint for token quotes
const AVNU_QUOTE_URL = "https://starknet.api.avnu.fi/v1/quotes";

const STRK = {
  address: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
};

const USDC = {
  address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  decimals: 6,
};

// store a rolling buffer of price points (for MA strategy)
const history = [];

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

function normalizeQuotePrice(quote) {
  if (!quote?.quote) return null;

  const { buyAmount, sellAmount } = quote.quote;

  // STARK → USDC price = USDC received / STRK sold
  const usdc = Number(sellAmount) / 10 ** USDC.decimals;
  const strk = Number(buyAmount) / 10 ** STRK.decimals;

  if (strk === 0) return null;

  return usdc / strk;
}

// -------------------------------------------------------------
// Fetch latest real price
// -------------------------------------------------------------

export async function getLatestStrkPrice() {
  try {
    const body = {
      sellTokenAddress: STRK.address,
      buyTokenAddress: USDC.address,
      sellAmount: String(1n * 10n ** 18n),
      slippage: 0.01,
    };

    const res = await axios.post(AVNU_QUOTE_URL, body, {
      headers: { "Content-Type": "application/json" },
      timeout: 4000,
    });

    const price = normalizeQuotePrice(res.data);
    if (!price) throw new Error("bad quote");

    // Save to history
    history.push({ ts: Date.now(), price });
    if (history.length > 200) history.shift(); // limit buffer

    return price;
  } catch (err) {
    console.warn("[priceFeed] AVNU quote failed, price unavailable");
    return null;
  }
}

// -------------------------------------------------------------
// Return price history for strategy
// -------------------------------------------------------------

export async function getStrkPriceHistory() {
  return history;
}
