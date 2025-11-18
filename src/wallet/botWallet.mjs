// src/wallet/botWallet.mjs
import "dotenv/config";
import { RpcProvider, Account } from "starknet";

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------

const STARKNET_RPC_URL =
  process.env.STARKNET_RPC_URL ||
  "https://starknet-mainnet.infura.io/v3/your-infura-key";

const BOT_WALLET_ADDRESS = process.env.BOT_WALLET_ADDRESS;
const BOT_WALLET_PRIVATE_KEY = process.env.BOT_WALLET_PRIVATE_KEY;

// Shared provider instance
const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });

// Cache the Account to avoid recreating it
let cachedAccount = null;

// -----------------------------------------------------------------------------
// LEGACY EXPORT (telegram.ts requires this)
// -----------------------------------------------------------------------------
export function getStarknetProvider() {
  return provider;
}

// -----------------------------------------------------------------------------
// MAIN EXPORT — BOT ACCOUNT
// -----------------------------------------------------------------------------
export function getBotAccount() {
  if (cachedAccount) return cachedAccount;

  if (!BOT_WALLET_ADDRESS || !BOT_WALLET_PRIVATE_KEY) {
    throw new Error(
      "Missing BOT_WALLET_ADDRESS or BOT_WALLET_PRIVATE_KEY in .env"
    );
  }

  console.log("🤖 Bot wallet address:", BOT_WALLET_ADDRESS);
  console.log("🔑 Bot private key prefix:", BOT_WALLET_PRIVATE_KEY.slice(0, 6));
  console.log("🌐 RPC URL:", STARKNET_RPC_URL);

  // Correct Starknet.js constructor:
  // new Account(provider, address, privateKey)
  cachedAccount = new Account(
    provider,
    BOT_WALLET_ADDRESS,
    BOT_WALLET_PRIVATE_KEY
  );

  return cachedAccount;
}
