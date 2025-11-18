// Simple fake STRK price feed for now – swap to real API later

let price = 1.20;

export async function getStrkPriceHistory() {
  const candles = [];
  let p = price;

  for (let i = 0; i < 30; i++) {
    const open = p;
    const close = p + (Math.random() - 0.5) * 0.02;
    const high = Math.max(open, close) + Math.random() * 0.01;
    const low = Math.min(open, close) - Math.random() * 0.01;
    const volume = 100 + Math.random() * 50;
    candles.push({ open, high, low, close, volume });
    p = close;
  }

  price = p;
  return candles;
}

export async function getLatestStrkPrice() {
  return price;
}
