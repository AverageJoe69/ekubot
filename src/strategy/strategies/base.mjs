// STRK Swing Strategy Using GPT
import { callGptStrategy } from "../gptStrategy.mjs";

export async function baseStrategy(ctx) {
  const { priceData, position, latestPrice, now } = ctx;
  const intents = [];

  if (!Array.isArray(priceData) || priceData.length < 5) {
    return intents;
  }

  const decision = await callGptStrategy({
    priceData,
    position,
    latestPrice,
    now,
  });

  if (!decision || decision.action === "HOLD") {
    return intents;
  }

  intents.push({
    strategy: "gpt_swing",
    symbol: "STRK",
    side: decision.action,
    sizeUsd: Number(decision.size_usdc || 0),
    reason: decision.reason,
    confidence: Number(decision.confidence || 0),
    meta: decision,
  });

  return intents;
}
