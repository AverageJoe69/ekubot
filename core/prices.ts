// core/prices.ts
// Fetch recent prices from the Ekubo Subgraph (GraphQL), with a safe mock fallback.
// Returns: Array<{ ts:number, price:number }> ascending by time.

type PricePoint = { ts: number; price: number };

const SUBGRAPH = (process.env.EKUBO_SUBGRAPH || "").trim(); // e.g. https://api.sepolia.starknet.io/subgraphs/name/ekubo/protocol
const POOL_ID = (process.env.TWAP_POOL_ID || "").trim();    // subgraph pool ID (address/hash)
const BASE_IS_TOKEN1 = /^true$/i.test(process.env.TWAP_BASE_IS_TOKEN1 || ""); // set true to flip base/quote

// Optional overrides if subgraph doesn't return decimals (strings -> numbers)
const TOKEN0_DEC = Number(process.env.TOKEN0_DECIMALS ?? NaN);
const TOKEN1_DEC = Number(process.env.TOKEN1_DECIMALS ?? NaN);

// -------------------- GraphQL fetch --------------------
async function gql<T>(query: string, variables: Record<string, any>): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(SUBGRAPH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`subgraph HTTP ${r.status}`);
    const json = await r.json();
    if (json.errors?.length) throw new Error(json.errors[0].message || "subgraph error");
    return json.data as T;
  } finally {
    clearTimeout(id);
  }
}

// Try to get recent prices from recent swaps
async function fetchFromSwaps(limit = 60): Promise<PricePoint[] | null> {
  if (!SUBGRAPH || !POOL_ID) return null;

  // Pull a bit more than we need to smooth out any zero-amount/system events
  const take = Math.min(Math.max(limit * 2, 40), 200);

  // NOTE: field names here are common patterns; if your subgraph names differ,
  // tweak the query to match (the rest of the code is tolerant).
  const query = /* GraphQL */ `
    query Prices($pool: ID!, $first: Int!) {
      pool(id: $pool) {
        id
        token0 { symbol decimals }
        token1 { symbol decimals }
      }
      swaps(
        where: { pool: $pool }
        orderBy: timestamp
        orderDirection: desc
        first: $first
      ) {
        timestamp
        amount0
        amount1
      }
    }
  `;

  type Resp = {
    pool: { id: string; token0: { symbol: string; decimals: number | string }; token1: { symbol: string; decimals: number | string } } | null;
    swaps: { timestamp: number | string; amount0: string; amount1: string }[];
  };

  const data = await gql<Resp>(query, { pool: POOL_ID, first: take });
  if (!data?.swaps?.length) return null;

  // Determine decimals (prefer subgraph, else env overrides)
  const dec0 = Number(
    (data.pool?.token0?.decimals as any) ?? (Number.isFinite(TOKEN0_DEC) ? TOKEN0_DEC : NaN)
  );
  const dec1 = Number(
    (data.pool?.token1?.decimals as any) ?? (Number.isFinite(TOKEN1_DEC) ? TOKEN1_DEC : NaN)
  );

  // Convert swaps to prices.
  // Convention: price = quote/base. By default base = token0, quote = token1.
  // If you need base=token1, set TWAP_BASE_IS_TOKEN1=true.
  const points: PricePoint[] = [];
  for (const s of data.swaps) {
    const ts = typeof s.timestamp === "number" ? s.timestamp : Number(s.timestamp);
    // Raw string amounts can be positive/negative; use absolute value.
    const a0 = Math.abs(Number(s.amount0));
    const a1 = Math.abs(Number(s.amount1));
    if (!isFinite(ts) || (!a0 && !a1)) continue;

    // If either decimals missing, we can still compute a simple ratio; decimals improve accuracy.
    const d0 = Number.isFinite(dec0) ? 10 ** dec0 : 1;
    const d1 = Number.isFinite(dec1) ? 10 ** dec1 : 1;

    // Price per trade:
    // If base=token0: price = (amount1/d1) / (amount0/d0) = (a1 * d0) / (a0 * d1)
    // If base=token1: price = (amount0/d0) / (amount1/d1) = (a0 * d1) / (a1 * d0)
    let price: number | null = null;
    if (a0 > 0 && a1 > 0) {
      if (!BASE_IS_TOKEN1) {
        price = (a1 * d0) / (a0 * d1);
      } else {
        price = (a0 * d1) / (a1 * d0);
      }
    }

    if (price && Number.isFinite(price) && price > 0) {
      points.push({ ts: ts * (ts < 10_000_000_000 ? 1000 : 1), price }); // seconds->ms if needed
    }
  }

  if (!points.length) return null;

  // Deduplicate by timestamp and sort ASC
  points.sort((a, b) => a.ts - b.ts);
  const dedup: PricePoint[] = [];
  const seen = new Set<number>();
  for (const p of points) {
    const key = Math.floor(p.ts / 1000); // 1-second buckets
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(p);
  }

  // Trim to requested limit from the end, then re-sort ASC
  const trimmed = dedup.slice(-limit);
  trimmed.sort((a, b) => a.ts - b.ts);

  return trimmed.length ? trimmed : null;
}

// -------------------- MOCK fallback --------------------
let mockPrice = 100;
const mockHistory: PricePoint[] = [];

function getMockPrices(limit = 60): PricePoint[] {
  const drift = (Math.random() - 0.5) * 0.2; // ±0.2%
  mockPrice = mockPrice * (1 + drift / 100);
  mockHistory.push({ ts: Date.now(), price: mockPrice });
  while (mockHistory.length > limit) mockHistory.shift();
  while (mockHistory.length < limit) mockHistory.unshift({ ts: Date.now(), price: mockPrice });
  return [...mockHistory];
}

// -------------------- PUBLIC --------------------
export async function getRecentPrices(limit = 60): Promise<PricePoint[]> {
  try {
    const live = await fetchFromSwaps(limit);
    if (live && live.length >= Math.min(limit, 10)) return live;
  } catch (e) {
    console.warn("[prices] live fetch error -> mock fallback:", (e as Error).message);
  }
  return getMockPrices(limit);
}
