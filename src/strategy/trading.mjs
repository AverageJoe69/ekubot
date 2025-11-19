// src/strategy/trading.mjs
// -------------------------------------------------------------
// STRK-only trading loop (paper + future live) with 1-minute
// auto-trading support.
// -------------------------------------------------------------

import { strkGptStrategy } from "./strategies/strkGptStrategy.mjs";
import {
  getStrkPriceHistory,
  getLatestStrkPrice,
} from "./priceFeed.mjs";

// In-memory per-chat state (paper positions & config)
// NOTE: this resets on process restart – fine for now.
const positions = new Map(); // chatId -> { usdc, strk }
const configs = new Map();   // chatId -> { mode, liveEnabled, autoEnabled }
const lastAutoRun = new Map(); // chatId -> "YYYY-MM-DDTHH:MM"

function chatKey(chatId) {
  return String(chatId);
}

function ensurePosition(chatId) {
  const key = chatKey(chatId);
  let pos = positions.get(key);
  if (!pos) {
    pos = {
      usdc: 1000, // starting paper balance
      strk: 0,
    };
    positions.set(key, pos);
  }
  return pos;
}

function ensureConfig(chatId) {
  const key = chatKey(chatId);
  let cfg = configs.get(key);
  if (!cfg) {
    cfg = {
      mode: "paper",    // "paper" | "live"
      liveEnabled: false,
      autoEnabled: false,
    };
    configs.set(key, cfg);
  }
  return cfg;
}

// -------------------------------------------------------------
// Core tick
// -------------------------------------------------------------

/**
 * tradeTick(chatId, { mode })
 * mode = "paper" | "live"
 */
export async function tradeTick(chatId, { mode = "paper" } = {}) {
  const nowIso = new Date().toISOString();

  const cfg = ensureConfig(chatId);
  const pos = ensurePosition(chatId);

  // Keep config mode in sync with explicit mode argument
  cfg.mode = mode;
  configs.set(chatKey(chatId), cfg);

  // 1. Price data (keeps original async contract)
  const priceData = await getStrkPriceHistory();
  const latestPrice = await getLatestStrkPrice();

  // 2. Ask strategy what to do
  const intents = await strkGptStrategy({
    chatId,
    priceData,
    latestPrice,
    position: { ...pos, latestPrice },
    now: nowIso,
    mode,
  });

  // 3. No intent → HOLD
  if (!intents || !intents.length) {
    return {
      updatedAt: nowIso,
      mode,
      price: latestPrice,
      intents: [],
      position: { ...pos },
      notes: "GPT decided to HOLD",
    };
  }

  const intent = intents[0];

  // 4. Apply paper mode
  if (mode === "paper") {
    applyPaperTrade(pos, intent, latestPrice);
    positions.set(chatKey(chatId), pos);
    return {
      updatedAt: nowIso,
      mode,
      price: latestPrice,
      intents: [intent],
      position: { ...pos },
    };
  }

  // 5. Live (future)
  if (mode === "live") {
    // TODO: wire real Ekubo swap via AVNU later
    return {
      updatedAt: nowIso,
      mode,
      price: latestPrice,
      intents: [intent],
      position: { ...pos },
      liveWarning: "live execution not implemented yet",
    };
  }

  // Fallback
  return {
    updatedAt: nowIso,
    mode,
    price: latestPrice,
    intents: [],
    position: { ...pos },
    notes: "Unknown mode",
  };
}

function applyPaperTrade(position, intent, latestPrice) {
  const side = intent.side;
  const sizeUsd = Number(intent.sizeUsd || 0);

  if (!latestPrice || latestPrice <= 0) return;
  if (sizeUsd <= 0) return;

  if (side === "BUY") {
    if (position.usdc >= sizeUsd) {
      const strkAmount = sizeUsd / latestPrice;
      position.usdc -= sizeUsd;
      position.strk += strkAmount;
    }
  }

  if (side === "SELL") {
    const maxSellUsd = position.strk * latestPrice;
    if (maxSellUsd <= 0) return;
    const sellUsd = Math.min(sizeUsd, maxSellUsd);
    const strkToSell = sellUsd / latestPrice;
    position.strk -= strkToSell;
    position.usdc += sellUsd;
  }
}

// -------------------------------------------------------------
// Status / config helpers
// -------------------------------------------------------------

export async function getTradingStatus(chatId) {
  const nowIso = new Date().toISOString();
  const cfg = ensureConfig(chatId);
  const pos = ensurePosition(chatId);
  const latestPrice = await getLatestStrkPrice();

  const equity = pos.usdc + pos.strk * (latestPrice || 0);

  return {
    chatId: chatKey(chatId),
    updatedAt: nowIso,
    mode: cfg.mode,
    autoEnabled: cfg.autoEnabled,
    liveEnabled: cfg.liveEnabled,
    price: latestPrice,
    position: { ...pos },
    equity,
  };
}

export function setLiveMode(chatId, live) {
  const cfg = ensureConfig(chatId);
  cfg.mode = live ? "live" : "paper";
  cfg.liveEnabled = live;
  configs.set(chatKey(chatId), cfg);
  return cfg;
}

export function setAutoMode(chatId, auto) {
  const cfg = ensureConfig(chatId);
  cfg.autoEnabled = auto;
  configs.set(chatKey(chatId), cfg);
  return cfg;
}

// -------------------------------------------------------------
// Stop trading & flatten to USDC
// -------------------------------------------------------------

export async function stopAndFlatten(chatId) {
  const cfg = ensureConfig(chatId);
  const pos = ensurePosition(chatId);
  const latestPrice = await getLatestStrkPrice();

  const realizedUsd = pos.strk * (latestPrice || 0);

  pos.usdc += realizedUsd;
  pos.strk = 0;

  // Always fall back to paper + auto off + live off
  cfg.mode = "paper";
  cfg.liveEnabled = false;
  cfg.autoEnabled = false;

  positions.set(chatKey(chatId), pos);
  configs.set(chatKey(chatId), cfg);

  return {
    chatId: chatKey(chatId),
    price: latestPrice,
    realizedUsd,
    position: { ...pos },
    mode: cfg.mode,
    autoEnabled: cfg.autoEnabled,
    liveEnabled: cfg.liveEnabled,
    updatedAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------
// Auto-trading: 1-minute logic
// -------------------------------------------------------------

/**
 * autoTradeTick(chatId)
 *
 * Called from telegram.ts once per minute.
 * - Respects /auto_on and /auto_off via setAutoMode
 * - Ensures at most one tick per *minute* per chat
 */
export async function autoTradeTick(chatId) {
  const cfg = ensureConfig(chatId);

  if (!cfg.autoEnabled) {
    return { autoRan: false, reason: "auto-disabled" };
  }

  const key = chatKey(chatId);
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"

  const lastKey = lastAutoRun.get(key);
  if (lastKey === minuteKey) {
    // Already ran for this chat in this minute
    return { autoRan: false, reason: "already-ran-this-minute" };
  }

  lastAutoRun.set(key, minuteKey);

  // Use current mode (paper/live) from config
  const mode = cfg.mode || "paper";
  const result = await tradeTick(chatId, { mode });
  const message = formatPaperTickMessage(result);

  return {
    autoRan: true,
    mode,
    minuteKey,
    result,
    message,
  };
}

// -------------------------------------------------------------
// Telegram formatting helpers
// -------------------------------------------------------------

export function formatPaperTickMessage(result) {
  const lines = [];

  lines.push(
    `🤖 Paper trade tick (mode: ${result.mode})`,
    `Time: ${result.updatedAt}`,
    `STRK/USDC price: ${
      result.price?.toFixed?.(4) ?? (result.price ?? "n/a")
    }`,
    `Trade intents this tick: ${result.intents.length}`,
    "",
  );

  const pos = result.position || { usdc: 0, strk: 0 };
  const price = result.price || 0;
  lines.push(
    `Balance:`,
    `• USDC: ${pos.usdc.toFixed(2)}`,
    `• STRK: ${pos.strk.toFixed(6)} (≈ $${(pos.strk * price).toFixed(2)})`,
    "",
  );

  for (const intent of result.intents) {
    lines.push(
      `STRK trade intent:`,
      `• Strategy: ${intent.strategy}`,
      `• Side: ${intent.side} | Size: ${intent.sizeUsd} USDC`,
      `• Confidence: ${(intent.confidence ?? 0).toFixed(2)}`,
      `• Reason: ${intent.reason}`,
      "",
    );
  }

  if (!result.intents.length && result.notes) {
    lines.push(result.notes);
  }

  return lines.join("\n");
}

export function formatStatusMessage(status) {
  const {
    mode,
    autoEnabled,
    price,
    position,
    equity,
    updatedAt,
  } = status;
  const usdc = position.usdc.toFixed(2);
  const strk = position.strk.toFixed(6);
  const strkUsd = (position.strk * (price || 0)).toFixed(2);

  return [
    "📊 STRK Trading Status",
    `Time: ${updatedAt}`,
    "",
    `Mode: ${mode.toUpperCase()}`,
    `Auto trading enabled: ${autoEnabled ? "YES" : "NO"}`,
    "",
    `STRK/USDC price: ${price?.toFixed?.(4) ?? (price ?? "n/a")}`,
    "",
    "Balances:",
    `• USDC: ${usdc}`,
    `• STRK: ${strk} (≈ $${strkUsd})`,
    "",
    `Total paper equity: $${equity.toFixed(2)}`,
  ].join("\n");
}

export function formatModeChangeMessage(cfg) {
  return [
    "⚙️ Trading mode updated",
    "",
    `Mode: ${cfg.mode.toUpperCase()}`,
    `Auto trading enabled: ${cfg.autoEnabled ? "YES" : "NO"}`,
  ].join("\n");
}

export function formatStopAndFlattenMessage(res) {
  const { price, realizedUsd, position, mode, autoEnabled, updatedAt } = res;

  return [
    "🛑 Trading halted and position flattened.",
    `Time: ${updatedAt}`,
    "",
    `Sold all STRK to USDC at price: ${
      price?.toFixed?.(4) ?? (price ?? "n/a")
    }`,
    `USDC realized from STRK: $${realizedUsd.toFixed(2)}`,
    "",
    "New balances:",
    `• USDC: ${position.usdc.toFixed(2)}`,
    `• STRK: ${position.strk.toFixed(6)}`,
    "",
    `Mode: ${mode.toUpperCase()}`,
    `Auto trading enabled: ${autoEnabled ? "YES" : "NO"}`,
  ].join("\n");
}
