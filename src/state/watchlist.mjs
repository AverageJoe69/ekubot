// src/state/watchlist.mjs

// Simple in-memory universe store keyed by chat id (or any id).
// Shape matches buildUniverseFromText from ekubo.mjs.

const universes = new Map();

/**
 * Get universe for a given chat id.
 * @param {string|number} key
 */
export async function getUniverse(key) {
  return universes.get(String(key)) || null;
}

/**
 * Set universe for a given chat id.
 * @param {string|number} key
 * @param {any} universe
 */
export async function setUniverse(key, universe) {
  universes.set(String(key), universe);
  return universe;
}

/**
 * Clear universe for a given chat id.
 * @param {string|number} key
 */
export async function clearUniverse(key) {
  universes.delete(String(key));
}

/**
 * For debugging: dump all universes.
 */
export function dumpUniverseStore() {
  return Array.from(universes.entries());
}
