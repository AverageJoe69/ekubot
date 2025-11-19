// src/strategy/trading.mjs
// -------------------------------------------------------------
// STRK-only trading loop (paper + future live)
// -------------------------------------------------------------

import { strkGptStrategy } from "./strategies/strkGptStrategy.mjs";
import {
  getStrkPriceHistory,
  getLatestStrkPrice,
} from "./priceFeed.mjs";

// In-memory per-chat state (paper positions & config)
// NOTE: this resets on process restart – fine for now.
const positions = new Map(); // chatId -> { usdc, strk }
const configs = new Map();   // chatId -> { mode: "paper"|"live", enabled: boolean }

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
      mode: "paper",
      enabled: false,
    };
    configs.set(key, cfg);
  }
  return cfg;
}

// -------------------------------------------------------------
// Core tick
// -------------------------------------------------------------

export async function tradeTick(chatId, { mode = "paper" } = {}) {
    const now = new Date().toISOString();
  
    const cfg = ensureConfig(chatId);
    const pos = ensurePosition(chatId);
  
    // 1. Price data
    const priceData = await getStrkPriceHistory();
    const latestPrice = await getLatestStrkPrice();
  
    // 2. Build a minimal snapshot compatible with baseStrategy
    const snapshot = {
      tokens: [
        {
          symbol: "STRK",
          address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
          bestPool: {
            keyHash: "STRK/USDC",
            fee: "0x0",
            tickSpacing: "0x0",
            liquidityBigInt: 1000000000000000000n, // pretend 1e18
          },
        },
      ],
    };
  
    // 3. Ask strategy
    const intents = await strkGptStrategy({
        chatId,
      snapshot,       // ← FIXED: strategy now works again
      priceData,
      latestPrice,
      position: { ...pos, latestPrice },
      now,
      mode,
    });
  
    // 4. No intent → HOLD
    if (!intents.length) {
      return {
        updatedAt: now,
        mode,
        price: latestPrice,
        intents: [],
        position: { ...pos },
        notes: "GPT decided to HOLD",
      };
    }
  
    // 5. Apply paper mode
    const intent = intents[0];
    if (mode === "paper") {
      applyPaperTrade(pos, intent, latestPrice);
      positions.set(chatKey(chatId), pos);
      return {
        updatedAt: now,
        mode,
        price: latestPrice,
        intents: [intent],
        position: { ...pos },
      };
    }
  
    // 6. Live (future)
    if (mode === "live") {
      return {
        updatedAt: now,
        mode,
        price: latestPrice,
        intents: [intent],
        position: { ...pos },
        liveWarning: "live execution not implemented yet",
      };
    }
  
    return {
      updatedAt: now,
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

  if (sizeUsd <= 0 || latestPrice <= 0) return;

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
  const now = new Date().toISOString();
  const cfg = ensureConfig(chatId);
  const pos = ensurePosition(chatId);
  const latestPrice = await getLatestStrkPrice();

  const equity =
    pos.usdc + pos.strk * (latestPrice || 0);

  return {
    chatId: chatKey(chatId),
    updatedAt: now,
    mode: cfg.mode,
    enabled: cfg.enabled,
    price: latestPrice,
    position: { ...pos },
    equity,
  };
}

export function setLiveMode(chatId, live) {
  const cfg = ensureConfig(chatId);
  cfg.mode = live ? "live" : "paper";
  cfg.enabled = live;
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

  cfg.mode = "paper";
  cfg.enabled = false;

  positions.set(chatKey(chatId), pos);
  configs.set(chatKey(chatId), cfg);

  return {
    chatId: chatKey(chatId),
    price: latestPrice,
    realizedUsd,
    position: { ...pos },
    mode: cfg.mode,
    enabled: cfg.enabled,
    updatedAt: new Date().toISOString(),
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
    `STRK/USDC price: ${result.price?.toFixed?.(4) ?? result.price}`,
    `Trade intents this tick: ${result.intents.length}`,
    "",
  );

  const pos = result.position || { usdc: 0, strk: 0 };
  lines.push(
    `Balance:`,
    `• USDC: ${pos.usdc.toFixed(2)}`,
    `• STRK: ${pos.strk.toFixed(6)} (≈ $${(pos.strk * result.price).toFixed(
      2,
    )})`,
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
  const { mode, enabled, price, position, equity, updatedAt } = status;
  const usdc = position.usdc.toFixed(2);
  const strk = position.strk.toFixed(6);
  const strkUsd = (position.strk * (price || 0)).toFixed(2);

  return [
    "📊 STRK Trading Status",
    `Time: ${updatedAt}`,
    "",
    `Mode: ${mode.toUpperCase()}`,
    `Auto trading enabled: ${enabled ? "YES" : "NO"}`,
    "",
    `STRK/USDC price: ${price?.toFixed?.(4) ?? price}`,
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
    `Auto trading enabled: ${cfg.enabled ? "YES" : "NO"}`,
  ].join("\n");
}

export function formatStopAndFlattenMessage(res) {
  const { price, realizedUsd, position, mode, enabled, updatedAt } = res;

  return [
    "🛑 Trading halted and position flattened.",
    `Time: ${updatedAt}`,
    "",
    `Sold all STRK to USDC at price: ${price?.toFixed?.(4) ?? price}`,
    `USDC realized from STRK: $${realizedUsd.toFixed(2)}`,
    "",
    "New balances:",
    `• USDC: ${position.usdc.toFixed(2)}`,
    `• STRK: ${position.strk.toFixed(6)}`,
    "",
    `Mode: ${mode.toUpperCase()}`,
    `Auto trading enabled: ${enabled ? "YES" : "NO"}`,
  ].join("\n");
}
