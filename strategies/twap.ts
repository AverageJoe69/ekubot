import { getRecentPrices } from "../core/prices";
import { mockSwap, dryRunSwap, getLedger } from "../core/executor";

type Mode = "mock" | "dry" | "live";

const cfg = {
  pool: "ETH/USDC (mock)",
  thresholdBps: 25,  // trigger if |short-long| > 0.25%
  sizeUsd: 25,
  mode: "mock" as Mode,
};

let running = false;
let timer: NodeJS.Timeout | null = null;

function avg(a: number[]) { return a.reduce((x, y) => x + y, 0) / a.length; }

export async function runOnce() {
  const prices = getRecentPrices(60);
  const last = prices.at(-1)!.price;
  const short = avg(prices.slice(-10).map(p => p.price));
  const long  = avg(prices.slice(-60).map(p => p.price));
  const drift = (short - long) / long;
  const driftBps = Math.abs(drift) * 10_000;

  if (driftBps < cfg.thresholdBps) return;

  const side = drift > 0 ? "LONG" : "SHORT";
  if (cfg.mode === "mock") mockSwap(side, cfg.sizeUsd, last);
  else if (cfg.mode === "dry") dryRunSwap(side, cfg.sizeUsd, last, 50);
  else if (cfg.mode === "live") {
    // TODO: call real on-chain swap here
  }
}

export function start(intervalMs = 20_000) {
  if (running) return false;
  running = true;
  timer = setInterval(runOnce, intervalMs);
  return true;
}

export function stop() {
  running = false;
  if (timer) clearInterval(timer as NodeJS.Timeout);
  timer = null;
}

export async function status() {
  const prices = getRecentPrices(60);
  const last = prices.at(-1)!.price;
  const short = avg(prices.slice(-10).map(p => p.price));
  const long  = avg(prices.slice(-60).map(p => p.price));
  const driftBps = ((short - long) / long) * 10_000;
  return {
    running, cfg,
    last: +last.toFixed(6),
    short: +short.toFixed(6),
    long: +long.toFixed(6),
    driftBps: +driftBps.toFixed(2),
    trades: getLedger().length,
  };
}

export function setConfig(key: string, val: string) {
  const num = Number(val);
  (cfg as any)[key] = Number.isFinite(num) ? num : val;
}
