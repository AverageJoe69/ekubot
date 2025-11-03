// src/wallet/testBotWallet.mjs
import { getBotAccount } from './botWallet.mjs';

async function main() {
  try {
    const account = await getBotAccount();

    console.log('✅ Account object created');
    console.log('   address:', account.address);

    try {
      const nonce = await account.getNonce();
      console.log('   current nonce:', nonce);
    } catch (err) {
      console.warn(
        '⚠️ getNonce failed (likely undeployed account):',
        err?.baseError?.message || err.message,
      );
    }
  } catch (err) {
    console.error('❌ testBotWallet failed:', err);
  }
}

main();
