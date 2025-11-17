// src/utils/ekubo.mjs
// -------------------------------------------------------------
// STRK / ETH / EKUBO vs USDC only – no remote Ekubo indexer
// -------------------------------------------------------------

import { getStarknetProvider } from "../wallet/botWallet.mjs";

/**
 * Normalize Starknet addresses:
 * - lowercase
 * - strip 0x
 * - strip leading zeros
 * - add single 0x
 */
export function normalizeAddress(addr) {
  if (!addr) return null;
  let s = String(addr).toLowerCase().trim();
  if (s.startsWith("0x")) s = s.slice(2);
  s = s.replace(/^0+/, "");
  if (s === "") s = "0";
  return "0x" + s;
}

// ------------------------------------------------------------------
// Hard-coded config: we *only* care about STRK, ETH, EKUBO vs USDC.
// ------------------------------------------------------------------

// You *can* still override these via env if you want.
const RAW_USDC_ADDRESS =
  process.env.USDC_ADDRESS ||
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const RAW_STRK_ADDRESS =
  process.env.STRK_ADDRESS ||
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RAW_ETH_ADDRESS =
  process.env.ETH_ADDRESS ||
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// EKUBO token – we *require* EKUBO_ADDRESS to be set if you want EKUBO.
const RAW_EKUBO_ADDRESS = process.env.EKUBO_ADDRESS || "";

export const USDC_ADDRESS = normalizeAddress(RAW_USDC_ADDRESS);
const STRK_ADDRESS = normalizeAddress(RAW_STRK_ADDRESS);
const ETH_ADDRESS = normalizeAddress(RAW_ETH_ADDRESS);
const EKUBO_ADDRESS = RAW_EKUBO_ADDRESS ? normalizeAddress(RAW_EKUBO_ADDRESS) : null;

// Kept only for compatibility – we don’t use the Ekubo HTTP API anymore.
export const EKUBO_API_BASE_URL =
  process.env.EKUBO_API_BASE_URL || "https://starknet-mainnet-api.ekubo.org";

console.log("⚙️ Ekubo static config at load:", {
  RAW_USDC_ADDRESS,
  USDC_ADDRESS,
  RAW_STRK_ADDRESS,
  STRK_ADDRESS,
  RAW_ETH_ADDRESS,
  ETH_ADDRESS,
  RAW_EKUBO_ADDRESS,
  EKUBO_ADDRESS,
});

// -------------------------------------------------------------
// Static token universe
// -------------------------------------------------------------

/**
 * Our entire world: STRK, ETH, EKUBO + USDC meta.
 * All addresses are normalized.
 */
const STATIC_TOKENS = {
  USDC: {
    symbol: "USDC",
    address: USDC_ADDRESS,
    decimals: 6,
  },
  STRK: {
    symbol: "STRK",
    address: STRK_ADDRESS,
    decimals: 18,
  },
  ETH: {
    symbol: "ETH",
    address: ETH_ADDRESS,
    decimals: 18,
  },
  EKUBO: {
    symbol: "EKUBO",
    address: EKUBO_ADDRESS, // may be null if env not set
    decimals: 18,
  },
};

if (!USDC_ADDRESS) {
  console.warn("⚠️ USDC_ADDRESS is not set or invalid – trading universe will be empty.");
}

if (!EKUBO_ADDRESS) {
  console.warn(
    "⚠️ EKUBO_ADDRESS not set – EKUBO will be treated as *unresolved* in the universe.",
  );
}

// ------------------------------------------------------------------
// Starknet connectivity helper (used by test scripts)
// ------------------------------------------------------------------

export async function testStarknetConnection() {
  const provider = getStarknetProvider();
  const chainId = await provider.getChainId();
  console.log("🔗 Starknet chainId:", chainId);
}

// ------------------------------------------------------------------
// Minimal “pools vs USDC” helpers – STATIC ONLY
// ------------------------------------------------------------------

/**
 * Return a fake pool list for STRK/USDC, ETH/USDC, EKUBO/USDC.
 * This is *only* for debug / display (e.g. /show_pairs), not for trading.
 *
 * Structure mimics the old Ekubo shape enough for tracker code to be happy.
 */
export async function getUsdcPools() {
  if (!USDC_ADDRESS) return [];

  const pools = [];

  function pushIfValid(baseTokenKey) {
    const base = STATIC_TOKENS[baseTokenKey];
    const usdc = STATIC_TOKENS.USDC;
    if (!base || !base.address || !usdc.address) return;

    pools.push({
      keyHash: `${base.symbol}/USDC`, // fake id
      token0: base.address,
      token1: usdc.address,
      fee: "0x0",
      tickSpacing: "0x0",
      extension: "0x0",
      sqrtRatio: "0x0",
      tick: "0x0",
      liquidity: "0", // we *don’t* know real liq; this is just a stub
      liquidityBigInt: 0n,
      lastUpdate: null,
      baseToken: {
        address: base.address,
        symbol: base.symbol,
        decimals: base.decimals,
        raw: base,
      },
      usdcToken: {
        address: usdc.address,
        symbol: usdc.symbol,
        decimals: usdc.decimals,
        raw: usdc,
      },
      raw: {},
    });
  }

  pushIfValid("STRK");
  pushIfValid("ETH");
  pushIfValid("EKUBO");

  return pools;
}

/**
 * Convenience debug logger – now just prints our static “pools”.
 */
export async function logUsdcPoolsSample(limit = 10) {
  const pools = await getUsdcPools();
  if (!pools.length) {
    console.log("⚠️ No static USDC pools (check USDC/STRK/ETH/EKUBO addresses).");
    return;
  }

  const sample = pools.slice(0, limit);
  console.log(`🏦 Static USDC pools sample (up to ${sample.length}):`);
  for (const p of sample) {
    const baseSym = p.baseToken.symbol;
    console.log(`• ${baseSym}/USDC  (key: ${p.keyHash})`);
  }
}

// ------------------------------------------------------------------
// Token resolution & universe building – STRK / ETH / EKUBO only
// ------------------------------------------------------------------

/**
 * Fake fetchTokens to keep old test scripts happy.
 * Returns STRK, ETH, EKUBO, USDC meta as an array.
 */
export async function fetchTokens() {
  return Object.values(STATIC_TOKENS).filter((t) => !!t.address);
}

/**
 * Fake fetchPools to keep old test scripts happy.
 * Delegates to getUsdcPools (which already returns a pool-like structure).
 */
export async function fetchPools() {
  const usdcPools = await getUsdcPools();
  // Strip meta to look more like raw pools if needed
  return usdcPools.map((p) => ({
    key_hash: p.keyHash,
    token0: p.token0,
    token1: p.token1,
    fee: p.fee,
    tick_spacing: p.tickSpacing,
    extension: p.extension,
    sqrt_ratio: p.sqrtRatio,
    tick: p.tick,
    liquidity: p.liquidity,
  }));
}

/**
 * Build a map: normalizedAddress -> { address, symbol, decimals, raw }
 * from our static tokens.
 */
export async function buildTokenMap() {
  const tokens = await fetchTokens();
  const map = new Map();
  for (const t of tokens) {
    const addr = normalizeAddress(t.address);
    if (!addr) continue;
    map.set(addr, {
      address: addr,
      symbol: t.symbol,
      decimals: t.decimals,
      raw: t,
    });
  }
  console.log(`🧩 Static token map built with ${map.size} entries.`);
  return map;
}

// Internal cached index used by resolveSymbolsToTokens
let tokenSymbolIndexPromise = null;

/**
 * Build a symbol -> [token] index from our static map.
 */
async function getTokenSymbolIndex() {
  if (!tokenSymbolIndexPromise) {
    tokenSymbolIndexPromise = (async () => {
      const tokenMap = await buildTokenMap();
      const bySymbol = new Map();

      for (const token of tokenMap.values()) {
        const symbol = String(token.symbol || "").toUpperCase().trim();
        if (!symbol) continue;
        const list = bySymbol.get(symbol) || [];
        list.push(token);
        bySymbol.set(symbol, list);
      }

      console.log(
        `🧭 Static token symbol index built for ${bySymbol.size} unique symbols.`,
      );
      return { bySymbol };
    })();
  }

  return tokenSymbolIndexPromise;
}

/**
 * Parse a raw string like:
 *   "STRK, EKUBO DOG ETH, BONK  PUMP MIM"
 * into ["STRK","EKUBO","DOG","ETH","BONK","PUMP","MIM"]
 */
export function parseSymbolsFromText(rawText) {
  if (!rawText) return [];
  return rawText
    .toUpperCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve an array of symbol strings to our static tokens.
 * Returns { resolved: Token[], unresolved: string[] }
 *
 * Only STRK, ETH, EKUBO will resolve. Everything else is “unresolved”.
 */
export async function resolveSymbolsToTokens(symbols) {
  const { bySymbol } = await getTokenSymbolIndex();

  const resolved = [];
  const unresolved = [];

  for (const rawSym of symbols) {
    const symbol = String(rawSym).toUpperCase().trim();
    if (!symbol) continue;

    const candidates = bySymbol.get(symbol);

    if (!candidates || candidates.length === 0) {
      unresolved.push(symbol);
      continue;
    }

    // Only ever one in our static universe, but we’ll just take the first.
    const token = candidates[0];
    resolved.push(token);
  }

  return { resolved, unresolved };
}

// Internal cached index: baseTokenAddress -> [USDC pools]
let usdcPoolsIndexPromise = null;

async function getUsdcPoolsIndex() {
  if (!usdcPoolsIndexPromise) {
    usdcPoolsIndexPromise = (async () => {
      const usdcPools = await getUsdcPools();
      const index = new Map();

      for (const p of usdcPools) {
        const baseAddr = p.baseToken?.address;
        if (!baseAddr) continue;
        const list = index.get(baseAddr) || [];
        list.push(p);
        index.set(baseAddr, list);
      }

      console.log(
        `🗺️  Static USDC pools index built for ${index.size} base tokens.`,
      );
      return index;
    })();
  }

  return usdcPoolsIndexPromise;
}

/**
 * Attach static USDC pool info to resolved tokens.
 *
 * Returns:
 * [
 *   {
 *     symbol,
 *     address,
 *     decimals,
 *     raw,
 *     usdcPools: [...],
 *     hasUsdcPool: boolean,
 *   },
 *   ...
 * ]
 */
export async function attachUsdcPoolsToTokens(resolvedTokens) {
  if (!resolvedTokens || !resolvedTokens.length) return [];

  const index = await getUsdcPoolsIndex();

  return resolvedTokens.map((t) => {
    const addr = normalizeAddress(t.address);
    const pools = index.get(addr) || [];
    return {
      ...t,
      address: addr,
      usdcPools: pools,
      hasUsdcPool: pools.length > 0,
    };
  });
}

/**
 * High-level helper: raw text --> trading universe object.
 * We *ignore* anything that isn’t STRK, ETH or EKUBO.
 *
 * Example:
 *   buildUniverseFromText("STRK, EKUBO, DOG, ETH")
 *
 * → DOG goes into `unresolved`.
 */
export async function buildUniverseFromText(rawText) {
  const symbols = parseSymbolsFromText(rawText);

  if (!symbols.length) {
    return {
      rawInput: rawText,
      symbols: [],
      tradable: [],
      unresolved: [],
      updatedAt: new Date().toISOString(),
    };
  }

  console.log("🌌 Building STATIC universe from symbols:", symbols.join(", "));

  const { resolved, unresolved } = await resolveSymbolsToTokens(symbols);
  const enriched = await attachUsdcPoolsToTokens(resolved);

  // Only mark as tradable if we have at least one (fake) USDC pool.
  const tradable = enriched.filter((t) => t.hasUsdcPool);
  const noUsdcPool = enriched
    .filter((t) => !t.hasUsdcPool)
    .map((t) => t.symbol);

  const unresolvedAll = Array.from(
    new Set([...(unresolved || []), ...noUsdcPool]),
  );

  const universe = {
    rawInput: rawText,
    symbols,
    tradable,
    unresolved: unresolvedAll,
    updatedAt: new Date().toISOString(),
  };

  console.log(
    `🌠 Static universe built: ${tradable.length} tradable, ${unresolvedAll.length} unresolved.`,
  );

  return universe;
}
