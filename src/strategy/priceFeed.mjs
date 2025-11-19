// src/strategy/priceFeed.mjs
// -------------------------------------------------------------
// REAL STRK/USDC PRICE FROM AVNU
// -------------------------------------------------------------

import axios from "axios";

const STRK_DECIMALS = 18n;
const USDC_DECIMALS = 6n;

let history = [];            // rolling price history
const MAX_HISTORY = 120;     // last 120 ticks (~2 hours if tick every minute)

function pushHistory(price) {
  history.push({ ts: Date.now(), price });
  if (history.length > MAX_HISTORY) history.shift();
}

// -------------------------------------------------------------
// 1) Get real price from AVNU (STRK → USDC)
// -------------------------------------------------------------

export async function getLatestStrkPrice() {
  try {
     // How much USDC do we get for 1 STRK?
     const amountIn = "1000000000000000000"; // 1 STRK in wei

     const url = `https://api.avnu.fi/v1/aggregator/swap?inputToken=STRK&outputToken=USDC&amount=${amountIn}`;

     const res = await axios.get(url);

     const out = res.data?.bestRoute?.output;
     if (!out) throw new Error("no output");

     // Convert to float USD
     const usdc = Number(out) / 1e6;

     pushHistory(usdc);
     return usdc;
  } catch (err) {
     console.error("[priceFeed] AVNU price failed:", err.message);

     // Fallback to last known price
     if (history.length) return history[history.length - 1].price;

     return 1.0; // worst case fallback
  }
}

// -------------------------------------------------------------
// 2) History accessor (GPT strategy uses this)
// -------------------------------------------------------------

export async function getStrkPriceHistory() {
  return history.map(h => ({
    ts: h.ts,
    price: h.price
  }));
}
