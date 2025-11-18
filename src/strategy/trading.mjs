// src/strategy/trading.mjs
import { buildTrackingSnapshot } from "./tracker.mjs";
import { baseStrategy } from "./strategies/base.mjs";

function pickPrimaryIntent(intents) {
  if (!Array.isArray(intents) || !intents.length) return null;

  // For now: first BUY intent from baseStrategy.
  const buy = intents.find((i) => i.side === "BUY");
  return buy || intents[0];
}

/**
 * Orchestrates one "trading tick".
 *
 * mode: "paper"  -> just return intents (no execution)
 *       "live"   -> also pick a primary intent you can execute
 */
export async function tradeTick(chatId, options) {
  const opts = options || {};
  const mode = opts.mode || "paper"; // "paper" | "live"

  const snapshot = await buildTrackingSnapshot(chatId);

  if (!snapshot.hasUniverse || !snapshot.tokens.length) {
    return {
      chatId: String(chatId),
      mode,
      ok: false,
      reason: "no-universe",
      message: "No universe set for this chat. Use /set_universe first.",
      snapshot,
      intents: [],
      primaryIntent: null,
    };
  }

  const ctx = {
    chatId,
    mode,
    snapshot,
    now: new Date(),
    options: opts,
  };

  const intents = [];

  const baseIntents = await baseStrategy(ctx);
  if (Array.isArray(baseIntents)) {
    for (const intent of baseIntents) intents.push(intent);
  }

  const primaryIntent = mode === "live" ? pickPrimaryIntent(intents) : null;

  return {
    chatId: String(chatId),
    mode,
    ok: true,
    reason: "ok",
    snapshot,
    intents,
    primaryIntent,
  };
}

export function formatPaperTickMessage(result) {
  if (!result.ok) {
    return (
      "❌ Trade tick aborted.\n\n" +
      (result.message || "Unknown error.")
    );
  }

  const lines = [];

  lines.push("🤖 *Paper trade tick* (mode: `" + result.mode + "`)");
  lines.push(
    "Universe updated: " + result.snapshot.universeUpdatedAt,
  );
  lines.push(
    "Tokens in universe: " + result.snapshot.tokens.length,
  );
  lines.push(
    "Trade intents this tick: " + result.intents.length,
  );

  if (!result.intents.length) {
    lines.push("");
    lines.push(
      "_No trade intents produced (likely low liquidity or no signals)._",
    );
    return lines.join("\n");
  }

  for (const intent of result.intents) {
    const liqStr = intent.liquidityBigInt
      ? intent.liquidityBigInt.toString()
      : "0";

    const keyShort =
      String(intent.poolKeyHash).slice(0, 10) + "…";

    const sizeLine =
      typeof intent.sizeUsd === "number"
        ? intent.sizeUsd.toString() + " USDC"
        : "unknown";

    lines.push("");
    lines.push(
      "*" + intent.symbol + "* (`" + intent.tokenAddress + "`)",
    );
    lines.push(
      "Strategy: `" + (intent.strategy || "unknown") + "`",
    );
    lines.push(
      "Side: `" +
        intent.side +
        "`  |  Size: `" +
        sizeLine +
        "`",
    );
    lines.push(
      "Pool: `" +
        keyShort +
        "` | fee: `" +
        intent.fee +
        "` | tickSpacing: `" +
        intent.tickSpacing +
        "`",
    );
    lines.push("Liquidity: `" + liqStr + "`");
    lines.push(
      "Reason: `" + (intent.reason || "n/a") + "`",
    );
  }

  return lines.join("\n");
}
