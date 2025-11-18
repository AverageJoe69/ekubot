// src/strategy/avnuClient.mjs
import { fetchQuotes, executeSwap } from '@avnu/avnu-sdk';
import { getBotAccount } from '../wallet/botWallet.mjs';

// Map human symbols -> Starknet token addresses
const TOKEN_ADDRESSES = {
  USDC: process.env.USDC_ADDRESS,
  ETH: process.env.ETH_ADDRESS,
  STRK: process.env.STRK_ADDRESS,
  // add more as you go (DOG, EKUBO, etc)
};

// VERY small helper: decimal string -> base units string (no BigNumber lib needed yet)
function toBaseUnits(amountDecimal, decimals) {
  const asString = amountDecimal.toString();
  const [whole, fracRaw = ''] = asString.split('.');

  const fracPadded = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${fracPadded || ''.padEnd(decimals, '0')}`;

  // strip leading zeros but keep at least "0"
  const trimmed = combined.replace(/^0+/, '') || '0';
  return trimmed;
}

/**
 * Low-level AVNU swap helper.
 *
 * sellAmountDecimal: human-readable (e.g. "10" USDC)
 */
export async function avnuSwap({
  sellSymbol,
  buySymbol,
  sellAmountDecimal,
  sellTokenDecimals = 18, // 6 for USDC, 18 for ETH/STRK etc
}) {
  const account = getBotAccount();

  const sellTokenAddress = TOKEN_ADDRESSES[sellSymbol];
  const buyTokenAddress = TOKEN_ADDRESSES[buySymbol];

  if (!sellTokenAddress || !buyTokenAddress) {
    throw new Error(`Missing token address for ${sellSymbol} or ${buySymbol}`);
  }

  // AVNU REST API expects sellAmount in base units (like wei) as a string. 
  const sellAmount = toBaseUnits(sellAmountDecimal, sellTokenDecimals);

  const params = {
    sellTokenAddress,
    buyTokenAddress,
    sellAmount,
    takerAddress: account.address,
    // SDK also supports extra fields (sources, referrer, etc) but we keep it minimal
  };

  console.log('[AVNU] Fetching quotes with params:', params);

  const quotes = await fetchQuotes(params);

  if (!quotes || !quotes.length) {
    throw new Error('No AVNU quotes returned');
  }

  const bestQuote = quotes[0];

  console.log('[AVNU] Best quote summary:', {
    sellToken: sellSymbol,
    buyToken: buySymbol,
    sellAmount,
    effectivePrice: bestQuote?.price,
    dexes: bestQuote?.route?.map((r) => r.exchange),
  });

  // ⚠️ Safety hook – you can add your own checks here:
  // - min expected out
  // - max gas cost
  // - allowed DEX list, etc.
  //
  // if (Number(bestQuote.priceImpactBps) > 100) throw new Error('Price impact too big');

  const txHash = await executeSwap(account, bestQuote);
  console.log('[AVNU] Swap tx sent:', txHash);

  return { txHash, quote: bestQuote };
}
