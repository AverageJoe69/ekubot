import pkg from "@avnu/avnu-sdk";
const { fetchQuotes, executeSwap } = pkg;

import { getBotAccount } from "../wallet/botWallet.mjs";

// ------------------------------
// Config
// ------------------------------
const TOKEN_ADDRESSES = {
  USDC:
    process.env.USDC_ADDRESS ??
    "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  STRK:
    process.env.STRK_ADDRESS ??
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  ETH:
    process.env.ETH_ADDRESS ??
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
};

// 💵 fixed USD trade size for testing
const DEFAULT_TRADE_SIZE_USD = 10;

// 🧮 temporary hard-coded STRK price (1 STRK ≈ $0.209)
const STRK_PRICE_USD = 0.209;

function toBaseUnits(amountDecimal, decimals) {
  const s = amountDecimal.toString();
  const [whole, fracRaw = ""] = s.split(".");

  const fracPadded = fracRaw.padEnd(decimals, "0").slice(0, decimals);
  const combined = `${whole}${fracPadded || "".padEnd(decimals, "0")}`;

  const trimmed = combined.replace(/^0+/, "") || "0";
  return trimmed;
}

// Interpret your primaryIntent into AVNU params
function interpretIntent(intent) {
  const side = (intent.side || "BUY").toUpperCase();
  const baseSymbol = (intent.symbol || "STRK").toUpperCase();

  let sellSymbol;
  let buySymbol;

  if (side === "SELL") {
    // sell base for USDC
    sellSymbol = baseSymbol;
    buySymbol = "USDC";
  } else {
    // BUY: sell USDC to buy base
    sellSymbol = "USDC";
    buySymbol = baseSymbol;
  }

  // We treat this as a USD notional size, NOT "10 tokens"
  const sizeUsd =
    typeof intent.sizeUsd === "number"
      ? intent.sizeUsd
      : intent.sizeUsd
      ? Number(intent.sizeUsd)
      : DEFAULT_TRADE_SIZE_USD;

  return { side, sellSymbol, buySymbol, sizeUsd };
}

/**
 * Execute a single trade via AVNU.
 *
 * @param {object} intent  primaryIntent from tradeTick
 * @param {object} opts    { dryRun: boolean }
 */
export async function executeSingleTrade(intent, { dryRun = true } = {}) {
  console.log("[singleTradeExecutor] Received intent:");
  console.dir(intent, { depth: null });

  const account = await getBotAccount();

  const { side, sellSymbol, buySymbol, sizeUsd } = interpretIntent(intent);

  console.log("[singleTradeExecutor] Interpreted intent →", {
    side,
    sellSymbol,
    buySymbol,
    sizeUsdUsd: sizeUsd,
  });

  const sellTokenAddress = TOKEN_ADDRESSES[sellSymbol];
  const buyTokenAddress = TOKEN_ADDRESSES[buySymbol];

  if (!sellTokenAddress || !buyTokenAddress) {
    throw new Error(
      `Missing token address for ${sellSymbol} or ${buySymbol}. Check TOKEN_ADDRESSES / .env`,
    );
  }

  // -------------------------------------------------
  // 🔢 Convert $sizeUsd → token amount for sell token
  // -------------------------------------------------
  let sellAmountDecimalTokens;

  if (sellSymbol === "USDC") {
    // 1 USDC ≈ 1 USD → $10 = 10 USDC
    sellAmountDecimalTokens = sizeUsd;
  } else if (sellSymbol === "STRK") {
    // $10 / $0.209 ≈ 47.8 STRK
    sellAmountDecimalTokens = sizeUsd / STRK_PRICE_USD;
  } else {
    // Safety: only USDC/STRK sells are USD-sized for now
    throw new Error(
      `USD-sized trades are only implemented when selling USDC or STRK. Got sellSymbol=${sellSymbol}`,
    );
  }

  const sellTokenDecimals = sellSymbol === "USDC" ? 6 : 18;
  const sellAmount = toBaseUnits(sellAmountDecimalTokens, sellTokenDecimals);

  console.log("[singleTradeExecutor] Notional sizing:", {
    sizeUsd,
    sellSymbol,
    approxSellAmountTokens: sellAmountDecimalTokens,
    sellAmountBaseUnits: sellAmount,
  });

  const params = {
    sellTokenAddress,
    buyTokenAddress,
    sellAmount,
    takerAddress: account.address,
  };

  console.log("[AVNU] Fetching quotes with params:", params);

  const quotes = await fetchQuotes(params);

  if (!quotes || !quotes.length) {
    console.log("[AVNU] No quotes returned.");
    return {
      ok: false,
      reason: "no_quotes",
      params,
    };
  }

  const bestQuote = quotes[0];

  console.log("[AVNU] Best quote summary:", {
    sellToken: sellSymbol,
    buyToken: buySymbol,
    sellAmount,
    price: bestQuote.price,
    buyAmount: bestQuote.buyAmount,
    route: bestQuote.route?.map((r) => ({
      exchange: r.exchange,
      share: r.sharePercentage,
    })),
  });

  if (dryRun) {
    console.log("[singleTradeExecutor] DRY RUN – not sending transaction.");
    return {
      ok: true,
      dryRun: true,
      params,
      quote: bestQuote,
    };
  }

  console.log("[singleTradeExecutor] LIVE MODE – sending swap via AVNU…");

  const txHash = await executeSwap(account, bestQuote);

  console.log("[singleTradeExecutor] Swap tx sent:", txHash);

  return {
    ok: true,
    dryRun: false,
    txHash,
    quote: bestQuote,
  };
}
