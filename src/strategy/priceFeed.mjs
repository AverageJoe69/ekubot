// src/strategy/priceFeed.mjs
// -------------------------------------------------------------
// STRK price feed with Braavos OHLC (if available) + safe fallback.
// -------------------------------------------------------------
//
// Public API:
//
//   getStrkPriceHistory() -> Promise<Candle[]>
//   getLatestStrkPrice()  -> Promise<number>
//
// Candle = { open, high, low, close, volume, timestamp }
//
// Behaviour:
// - If BRAAVOS_STRK_USDC_OHLC_URL is set and works, use it.
// - If it fails or is not set, fall back to synthetic candles
//   (so the bot NEVER crashes Telegram commands).
// -------------------------------------------------------------

const HISTORY_LENGTH = 60; // number of candles to keep
const CACHE_TTL_MS = 15_000; // 15s cache

const BRAAVOS_ENDPOINT = process.env.BRAAVOS_STRK_USDC_OHLC_URL || "";

// In-memory cache
let cachedCandles = [];
let lastFetchTs = 0;

// Synthetic fallback state
let syntheticPrice = 1.2;

// -----------------------------
// Helpers
// -----------------------------

async function fetchJson(url) {
  // Railway / Node 18+ should have global fetch
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Braavos fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Map Braavos OHLC rows into our internal candle structure.
 * Adjust mapping if needed once you know the exact response shape.
 *
 * Expected-ish input:
 * [
 *   { time: 1731927600, open: "1.23", high: "1.25", low: "1.20", close: "1.24", volume: "1234.56" },
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
 * Synthetic fallback: simple random walk candles.
 */
function generateSyntheticCandles() {
  const candles = [];
  let p = syntheticPrice;
  const now = Date.now();
  const stepMs = 60_000; // 1m candles

  for (let i = HISTORY_LENGTH - 1; i >= 0; i--) {
    const ts = now - i * stepMs;
    const open = p;
    const close = p + (Math.random() - 0.5) * 0.02;
    const high = Math.max(open, close) + Math.random() * 0.01;
    const low = Math.min(open, close) - Math.random() * 0.01;
    const volume = 100 + Math.random() * 50;

    candles.push({ open, high, low, close, volume, timestamp: ts });
    p = close;
  }

  syntheticPrice = p;
  return candles;
}

// -----------------------------
// Core loader
// -----------------------------

async function loadStrkCandles() {
  const now = Date.now();

  // Cache
  if (cachedCandles.length && now - lastFetchTs < CACHE_TTL_MS) {
    return cachedCandles;
  }

  // Try Braavos if configured
  if (BRAAVOS_ENDPOINT) {
    try {
      const raw = await fetchJson(BRAAVOS_ENDPOINT);
      const rows = Array.isArray(raw)
        ? raw
        : raw.data || raw.candles || raw.items || [];

      const candles = mapBraavosToCandles(rows);

      if (candles.length) {
        cachedCandles = candles;
        lastFetchTs = now;
        return candles;
      } else {
        console.warn(
          "[priceFeed] Braavos returned no candles, falling back to synthetic.",
        );
      }
    } catch (err) {
      console.warn(
        "[priceFeed] Braavos fetch failed, falling back to synthetic:",
        err,
      );
    }
  } else {
    // No endpoint configured
    console.warn(
      "[priceFeed] BRAAVOS_STRK_USDC_OHLC_URL not set, using synthetic prices.",
    );
  }

  // Fallback: synthetic candles (never throws)
  const synthetic = generateSyntheticCandles();
  cachedCandles = synthetic;
  lastFetchTs = now;
  return synthetic;
}

// -----------------------------
// Public API
// -----------------------------

export async function getStrkPriceHistory() {
  return loadStrkCandles();
}

export async function getLatestStrkPrice() {
  const candles = await loadStrkCandles();
  const last = candles[candles.length - 1];
  return last ? last.close : syntheticPrice;
}
