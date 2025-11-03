// src/wallet/botWallet.mjs
import 'dotenv/config';
import { RpcProvider, Account } from 'starknet';

const STARKNET_RPC_URL =
  process.env.STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/mainnet';

const BOT_WALLET_ADDRESS = process.env.BOT_WALLET_ADDRESS;
const BOT_WALLET_PRIVATE_KEY = process.env.BOT_WALLET_PRIVATE_KEY;

// Reusable provider for the bot
const provider = new RpcProvider({
  nodeUrl: STARKNET_RPC_URL,
});

/**
 * Returns a Starknet.js Account instance for the bot wallet.
 * Works with Starknet.js v8 (options-style constructor).
 */
export async function getBotAccount() {
  if (!BOT_WALLET_ADDRESS) {
    throw new Error('BOT_WALLET_ADDRESS is not set in .env');
  }
  if (!BOT_WALLET_PRIVATE_KEY) {
    throw new Error('BOT_WALLET_PRIVATE_KEY is not set in .env');
  }

  const chainId = await provider.getChainId();
  console.log('🤖 Bot wallet address:', BOT_WALLET_ADDRESS);
  console.log('🔗 Connected chainId:', chainId);

  // 👇 NEW v8-style constructor: pass an options object
  const account = new Account({
    provider,
    address: BOT_WALLET_ADDRESS,
    privateKey: BOT_WALLET_PRIVATE_KEY,
    cairoVersion: '1', // Ready/Argent-style account is almost certainly Cairo 1
  });

  return account;
}
