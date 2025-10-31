// ekuboTrader.ts
import { context, action } from "@daydreamsai/core";
import * as z from "zod";

export const ekuboTraderContext = context({
  type: "ekubo-trader",
  schema: z.object({
    userId: z.string(),
    network: z.string().default("sepolia"),
  }),
  create: () => ({
    wallet: "",
    lastAction: "",
    budgetUSDC: 0,
  }),
  render: (state) => `
Ekubo Trader Agent
Network: ${state.args.network}
Wallet: ${state.memory.wallet || "Not connected"}
Budget: ${state.memory.budgetUSDC} USDC
Last action: ${state.memory.lastAction || "None"}
`,
  instructions: `
You are an Ekubo trading assistant on Starknet.
For now: never execute real on-chain swaps; only simulate and respond clearly.
`,
});

ekuboTraderContext.setActions([
  action({
    name: "set-wallet",
    description: "Store the user's wallet address",
    schema: z.object({ address: z.string() }),
    handler: async ({ address }, ctx) => {
      ctx.memory.wallet = address;
      ctx.memory.lastAction = "set-wallet";
      return { ok: true, wallet: address };
    },
  }),
  action({
    name: "set-budget",
    description: "Set simulated USDC budget",
    schema: z.object({ amount: z.number().nonnegative() }),
    handler: async ({ amount }, ctx) => {
      ctx.memory.budgetUSDC = amount;
      ctx.memory.lastAction = "set-budget";
      return { ok: true, budgetUSDC: amount };
    },
  }),
]);
