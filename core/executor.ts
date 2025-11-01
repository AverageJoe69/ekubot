export type Trade = { side: "LONG" | "SHORT"; sizeUsd: number; at: number; price: number };
const ledger: Trade[] = [];

export function mockSwap(side: "LONG" | "SHORT", sizeUsd: number, price: number) {
  const t: Trade = { side, sizeUsd, at: Date.now(), price };
  ledger.push(t);
  console.log("🟢 MOCK TRADE", t);
  return t;
}

export function dryRunSwap(side: "LONG" | "SHORT", sizeUsd: number, price: number, slippageBps = 50) {
  const amountQuoteIn = sizeUsd;                     // spend quote (e.g., USDC)
  const expectedBaseOut = amountQuoteIn / price;     // receive base (e.g., ETH)
  const minBaseOut = expectedBaseOut * (1 - slippageBps / 10_000);
  const plan = { side, amountQuoteIn, expectedBaseOut, minBaseOut };
  console.log("🧪 DRY RUN", plan);
  return plan;
}

export function getLedger() { return ledger; }
