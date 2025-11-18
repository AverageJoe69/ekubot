// src/strategy/positionStore.mjs
// paper-trading balances

import { kv } from "../state/kv.mjs"; // whatever your KV wrapper is

export async function getPosition(chatId) {
  const store = await kv.get(`pos:${chatId}`);

  if (!store) {
    // initial paper state
    const initial = {
      usdc: 1000,
      strk: 0,
      latestPrice: 0,
    };
    await kv.set(`pos:${chatId}`, initial);
    return initial;
  }

  return store;
}

export async function updatePosition(chatId, pos) {
  await kv.set(`pos:${chatId}`, pos);
}
