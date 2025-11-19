// src/strategy/priceFeed.mjs
// -------------------------------------------------------------
// STRK/USDC price feed via AVNU + simple 1m candle engine.
// Designed to be resilient: network errors do NOT throw,
// they fall back to the last known price or 0.
// -------------------------------------------------------------

import axios from "axios";

const AVNU_PRICE_URL =
  process.env.AVNU_PRICE_URL || "https://api.avnu.fi/prices/v1";

// These are the working STRK/USDC addresses you were already using.
// If env vars are set, they win; otherwise we fall back to constants.
const STRK_ADDRESS =
  process.env.STRK_ADDRESS ||
  "0x04718f5b6d53dfddc0e6c1a1519b1f34b1ba6c2bda9ded0c77c4a3a0c938d";

const USDC_ADDRESS =
  process.env.USDC_ADDRESS ||
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

// ---- Candle state (in-memory) -----------------------------------------

const MS_PER_MIN = 60_000;
const MAX_CANDLES = 500; // ~8h of 1m candles

let currentCandle = null; // { startTs, open, high, low, close }
let candleHistory = [];   // array of closed candles
let lastKnownPrice = null;

function floorToMinute(tsMs) {
  return Math.floor(tsMs / MS_PER_MIN) * MS_PER_MIN;
}

function updateStrkCandles(tsMs, price) {
  const bucketStart = floorToMinute(tsMs);

  if (!currentCandle || currentCandle.startTs !== bucketStart) {
    // Close previous candle
    if (currentCandle) {
      candleHistory.push(currentCandle);
      if (candleHistory.length > MAX_CANDLES) {
        candleHistory.shift();
      }
    }

    currentCandle = {
      startTs: bucketStart,
      open: price,
      high: price,
      low: price,
      close: price,
    };
  } else {
    if (price > currentCandle.high) currentCandle.high = price;
    if (price < currentCandle.low) currentCandle.low = price;
    currentCandle.close = price;
  }
}

// ---- AVNU fetch with graceful fallback --------------------------------

async function fetchLatestStrkPriceFromAvnu() {
  const ts = Date.now();

  try {
    const res = await axios.get(AVNU_PRICE_URL, {
      params: {
        baseToken: STRK_ADDRESS,
        quoteToken: USDC_ADDRESS,
      },
      timeout: 10_000,
    });

    const data = res.data;

    // Normalise price
    const raw = data?.price ?? data?.[0]?.price ?? data;
    const price =
      typeof raw === "number"
        ? raw
        : parseFloat(raw ?? "0");

    if (!Number.isFinite(price) || price <= 0) {
      console.error(
        "[priceFeed] Invalid STRK price from AVNU:",
        JSON.stringify(data).slice(0, 200),
      );
      // fall back to last known or 0
      return {
        price: lastKnownPrice ?? 0,
        ts,
      };
    }

    lastKnownPrice = price;
    return { price, ts };
  } catch (err) {
    // This is where your ECONNREFUSED is coming from.
    console.error(
      "[priceFeed] AVNU price fetch failed:",
      err?.code || err?.message || err,
    );

    // If we've ever had a good price, reuse it.
    if (lastKnownPrice != null) {
      return { price: lastKnownPrice, ts };
    }

    // Otherwise, return 0 so callers don't explode.
    return { price: 0, ts };
  }
}

// ---- Public API --------------------------------------------------------

/**
 * Fetches the latest STRK/USDC price from AVNU, updates the candle engine,
 * and returns a float price. Never throws.
 */
export async function getLatestStrkPrice() {
  const { price, ts } = await fetchLatestStrkPriceFromAvnu();
  updateStrkCandles(ts, price);
  return price;
}

/**
 * Returns an array of 1-minute candles (oldest → newest) for the requested
 * lookback window. Async to match your original contract.
 *
 * Each item:
 *  {
 *    ts: <candle start ms>,
 *    price: <close>,   // backwards compatible
 *    o: <open>,
 *    h: <high>,
 *    l: <low>,
 *    c: <close>,
 *  }
 */
export async function getStrkPriceHistory({ lookbackMinutes = 240 } = {}) {
  const cutoff = Date.now() - lookbackMinutes * MS_PER_MIN;
  const result = [];

  for (const c of candleHistory) {
    if (c.startTs >= cutoff) {
      result.push({
        ts: c.startTs,
        price: c.close,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
      });
    }
  }

  if (currentCandle && currentCandle.startTs >= cutoff) {
    result.push({
      ts: currentCandle.startTs,
      price: currentCandle.close,
      o: currentCandle.open,
      h: currentCandle.high,
      l: currentCandle.low,
      c: currentCandle.close,
    });
  }

  return result;
}

/**
 * Optional raw accessor if you ever want raw candles for debugging.
 */
export function getStrkCandlesRaw({ lookbackMinutes = 240 } = {}) {
  const cutoff = Date.now() - lookbackMinutes * MS_PER_MIN;
  const result = [];

  for (const c of candleHistory) {
    if (c.startTs >= cutoff) result.push({ ...c });
  }
  if (currentCandle && currentCandle.startTs >= cutoff) {
    result.push({ ...currentCandle });
  }

  return result;
}
