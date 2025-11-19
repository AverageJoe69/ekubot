// src/strategy/priceFeed.mjs
// -------------------------------------------------------------
// Live STRK/USDC price via AVNU swap/v2/quotes
// -------------------------------------------------------------

import axios from "axios";
import { normalizeAddress, USDC_ADDRESS } from "../utils/ekubo.mjs";

// AVNU base URL
const AVNU_BASE_URL =
  process.env.AVNU_BASE_URL || "https://starknet.api.avnu.fi";

// STRK address (same as ekubo.mjs default)
const RAW_STRK_ADDRESS =
  process.env.STRK_ADDRESS ||
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const STRK_ADDRESS = normalizeAddress(RAW_STRK_ADDRESS);

// We'll ask: "what's the best quote to SELL 1 STRK for USDC?"
const ONE_STRK_WEI = 10n ** 18n; // STRK has 18 decimals
const USDC_DECIMALS = 6n;

// In-memory price history
const history = []; // [{ t: number, price: number }]

// -------------------------------------------------------------
// Low-level AVNU fetch
// -------------------------------------------------------------

async function fetchStrkUsdcPriceFromAvnu() {
  if (!STRK_ADDRESS || !USDC_ADDRESS) {
    throw new Error("STRK_ADDRESS or USDC_ADDRESS not configured");
  }

  const url = `${AVNU_BASE_URL}/swap/v2/quotes`;

  const params = {
    sellTokenAddress: STRK_ADDRESS,
    buyTokenAddress: USDC_ADDRESS,
    sellAmount: "0x" + ONE_STRK_WEI.toString(16), // 1 STRK, hex
  };

  const resp = await axios.get(url, {
    params,
    timeout: 7000,
  });

  const data = resp.data;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("AVNU returned no quotes for STRK/USDC");
  }

  const entry = data[0];

  // AVNU returns buyAmount as hex string (USDC in smallest units)
  const buyAmountHex = entry.buyAmount || entry.buy_amount;
  if (!buyAmountHex) {
    throw new Error("AVNU quote missing buyAmount");
  }

  const buyAmountWei = BigInt(buyAmountHex);

  // ❗ IMPORTANT: use floating point for decimal scaling,
  // not integer BigInt division (which was giving us zero).
  const buyUsdc = Number(buyAmountWei) / 10 ** Number(USDC_DECIMALS); // e.g. 0.83
  const sellStrk = Number(ONE_STRK_WEI) / 10 ** 18; // exactly 1.0

  if (!Number.isFinite(buyUsdc) || buyUsdc <= 0) {
    throw new Error("AVNU buyAmount produced invalid USDC value");
  }

  const price = buyUsdc / sellStrk; // USDC per STRK

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Computed invalid STRK/USDC price from AVNU");
  }

  return price;
}

// -------------------------------------------------------------
// Public API
// -------------------------------------------------------------

export async function getLatestStrkPrice() {
  try {
    const price = await fetchStrkUsdcPriceFromAvnu();

    history.push({ t: Date.now(), price });
    if (history.length > 500) history.shift();

    return price;
  } catch (err) {
    console.error(
      "[priceFeed] AVNU STRK/USDC price fetch failed:",
      err?.message || err,
    );
    return null;
  }
}

export async function getStrkPriceHistory() {
  // shallow copy so callers can't mutate internal array
  return [...history];
}
