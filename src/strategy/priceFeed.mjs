// src/strategy/priceFeed.mjs
// -------------------------------------------------------------
// STRK price feed via Braavos OHLC API (skeleton).
// -------------------------------------------------------------
//
// This module exposes two functions:
//
//   getStrkPriceHistory() -> Promise<Candle[]>
//   getLatestStrkPrice()  -> Promise<number>
//
// where each Candle is:
//   { open, high, low, close, volume, timestamp }
//
// You ONLY need to fix the BRAAVOS_ENDPOINT and the mapping from
// Braavos' response shape into the internal Candle type.
//

const HISTORY_LENGTH = 60; // number of candles to keep in memory

let cachedCandles = [];
let lastFetchTs = 0;
const CACHE_TTL_MS = 15_000; // 15s – no need to hammer

// 🔧 TODO: replace this with the real Braavos OHLC endpoint for STRK/USDC.
// It should return an array of candles with fields similar to:
//   time, open, high, low, close, volume.
const BRAAVOS_ENDPOINT =
  process.env.BRAAVOS_STRK_USDC_OHLC_URL ||
  "https://api.braavos.app/markets/strk-usdc/ohlc?interval=1m&limit=60";

// Basic fetch wrapper using global fetch (Node 18+ / Railway)
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Braavos fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Map Braavos OHLC rows into our internal candle structure.
 * Adjust this mapping to match the real response shape.
 *
 * EXPECTED-ish input shape (you will confirm/adjust):
 * [
 *   {
 *     "time": 1731927600,      // unix seconds
 *     "open": "1.23",
 *     "high": "1.25",
 *     "low": "1.20",
 *     "close": "1.24",
 *     "volume": "1234.56"
 *   },
 *   ...
 * ]
 */
function mapBraavosToCandles(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => {
      const open = Number(r.open ?? r.o ?? 0);
      const high = Number(r.high ?? r.h ?? 0);
      const low = Number(r.low ?? r.l ?? 0);
      const close = Number(r.close ?? r.c ?? 0);
      const volume = Number(r.volume ?? r.v ?? 0);
      const tsRaw = r.time ?? r.t ?? r.timestamp;
      const timestamp =
        typeof tsRaw === "number"
          ? tsRaw * 1000
          : Date.parse(String(tsRaw)) || Date.now();

      if (!open || !close) return null;

      return { open, high, low, close, volume, timestamp };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-HISTORY_LENGTH);
}

/**
 * Fetch or return cached candles.
 */
async function loadStrkCandles() {
  const now = Date.now();
  if (cachedCandles.length && now - lastFetchTs < CACHE_TTL_MS) {
    return cachedCandles;
  }

  const raw = await fetchJson(BRAAVOS_ENDPOINT);
  const rows = Array.isArray(raw) ? raw : raw.data || raw.candles || raw.items || [];
  const candles = mapBraavosToCandles(rows);

  if (!candles.length) {
    throw new Error("No STRK candles from Braavos");
  }

  cachedCandles = candles;
  lastFetchTs = now;
  return candles;
}

// -------------------------------------------------------------
// Public API
// -------------------------------------------------------------

export async function getStrkPriceHistory() {
  const candles = await loadStrkCandles();
  return candles;
}

export async function getLatestStrkPrice() {
  const candles = await loadStrkCandles();
  const last = candles[candles.length - 1];
  return last ? last.close : 0;
}
