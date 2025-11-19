// src/strategy/priceFeed.mjs
import axios from "axios";

const AVNU_PRICE_URL =
  process.env.AVNU_PRICE_URL ||
  "https://api.avnu.fi/prices/v1"; // adjust to your real endpoint

// STRK + USDC addresses on Starknet (you already have these somewhere)
const STRK_ADDRESS =
  process.env.STRK_ADDRESS ||
  "0x04718f5b6d53dfddc0e6c1a1519b1f34b1ba6c2bda9ded0c77c4a3a0c938d"; // example
const USDC_ADDRESS =
  process.env.USDC_ADDRESS ||
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

// --- Candle state (in-memory) ---------------------------------------------

const MS_PER_MIN = 60_000;
const MAX_CANDLES = 500; // ~8 hours of 1m candles

let currentCandle = null; // { startTs, open, high, low, close }
let candleHistory = [];   // array of closed candles

function floorToMinute(tsMs) {
  return Math.floor(tsMs / MS_PER_MIN) * MS_PER_MIN;
}

/**
 * Update / create the 1-minute candle for this tick.
 */
function updateStrkCandles(tsMs, price) {
  const bucketStart = floorToMinute(tsMs);

  if (!currentCandle || currentCandle.startTs !== bucketStart) {
    // Close previous candle if present
    if (currentCandle) {
      candleHistory.push(currentCandle);
      if (candleHistory.length > MAX_CANDLES) {
        candleHistory.shift();
      }
    }

    // Start a new candle
    currentCandle = {
      startTs: bucketStart,
      open: price,
      high: price,
      low: price,
      close: price,
    };
  } else {
    // Update running candle
    if (price > currentCandle.high) currentCandle.high = price;
    if (price < currentCandle.low) currentCandle.low = price;
    currentCandle.close = price;
  }
}

/**
 * Returns an array of candles (oldest → newest) for the requested lookback.
 * Each element:
 * { ts, price, o, h, l, c }
 *
 * - ts: candle start timestamp (ms)
 * - price: alias for close (backwards compatible)
 * - o/h/l/c: OHLC
 */
export function getStrkPriceHistory({ lookbackMinutes = 120 } = {}) {
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

// --- AVNU fetch + latest price --------------------------------------------

async function fetchLatestStrkPriceFromAvnu() {
  // Adjust to match your real AVNU call signature.
  // This is deliberately generic; you likely already have something similar.
  const res = await axios.get(AVNU_PRICE_URL, {
    params: {
      // Example query; replace with your real params
      // e.g. base=STRK, quote=USDC, or tokenAddress, etc.
      baseToken: STRK_ADDRESS,
      quoteToken: USDC_ADDRESS,
    },
    timeout: 10_000,
  });

  const data = res.data;

  // Normalise to a float STRK/USDC price
  // If your API returns something else, just tweak this mapping.
  const price =
    typeof data.price === "number"
      ? data.price
      : parseFloat(data.price ?? "0");

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid STRK price from AVNU: ${JSON.stringify(data)}`);
  }

  return {
    price,
    ts: Date.now(),
  };
}

/**
 * Main entry point used by the rest of the bot.
 *
 * - Fetches latest STRK/USDC price from AVNU.
 * - Updates the in-memory candle engine.
 * - Returns a simple float price (backwards compatible).
 */
export async function getLatestStrkPrice() {
  const { price, ts } = await fetchLatestStrkPriceFromAvnu();
  updateStrkCandles(ts, price);
  return price;
}

/**
 * Optional helper if you ever want raw candle objects (not just mapped history).
 * Not used by existing code, but handy for debugging / plotting later.
 */
export function getStrkCandlesRaw({ lookbackMinutes = 120 } = {}) {
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
