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

// We’ll always ask: “what’s the best quote to SELL 1 STRK for USDC?”
const ONE_STRK_WEI = 10n ** 18n; // STRK has 18 decimals
const USDC_DECIMALS = 6n;

// In-memory price history for the GPT strategy
const history = []; // [{ t: number, price: number }]

/**
 * Low-level: fetch STRK/USDC execution price from AVNU.
 *
 * Uses GET /swap/v2/quotes with:
 *   sellTokenAddress = STRK
 *   buyTokenAddress  = USDC
 *   sellAmount       = 1 STRK (1e18)
 *
 * Returns: Number (USDC per 1 STRK)
 */
async function fetchStrkUsdcPriceFromAvnu() {
  if (!STRK_ADDRESS || !USDC_ADDRESS) {
    throw new Error("STRK_ADDRESS or USDC_ADDRESS not configured");
  }

  const url = `${AVNU_BASE_URL}/swap/v2/quotes`;

  const params = {
    sellTokenAddress: STRK_ADDRESS,
    buyTokenAddress: USDC_ADDRESS,
    // 1 STRK in wei, hex-encoded
    sellAmount: "0x" + ONE_STRK_WEI.toString(16),
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

  // AVNU returns buyAmount as hex string, e.g. "0x1234..."
  const buyAmountHex = entry.buyAmount || entry.buy_amount;
  if (!buyAmountHex) {
    throw new Error("AVNU quote missing buyAmount");
  }

  const buyAmountWei = BigInt(buyAmountHex);

  // Convert to token units:
  // - we sold 1 STRK (ONE_STRK_WEI), so sell tokens = 1
  // - USDC has 6 decimals: tokens = wei / 10^6
  const buyUsdcTokens = buyAmountWei / 10n ** USDC_DECIMALS;
  const sellStrkTokens = ONE_STRK_WEI / 10n ** 18n; // = 1n

  if (sellStrkTokens === 0n) {
    throw new Error("sellStrkTokens is zero (unexpected)");
  }

  // USDC per STRK
  const price = Number(buyUsdcTokens) / Number(sellStrkTokens);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Computed invalid STRK/USDC price from AVNU");
  }

  return price;
}

/**
 * Public: get latest STRK price (USDC per STRK).
 *
 * - Calls AVNU once
 * - Updates in-memory history
 * - Returns Number or null on failure
 */
export async function getLatestStrkPrice() {
  try {
    const price = await fetchStrkUsdcPriceFromAvnu();

    history.push({ t: Date.now(), price });
    // keep history reasonably small
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

/**
 * Public: return a shallow copy of the price history.
 * Shape: [{ t: number, price: number }, ...]
 */
export async function getStrkPriceHistory() {
  return [...history];
}
