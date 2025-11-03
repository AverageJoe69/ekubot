/**
 * Daydreams agent running on Railway (Node)
 * CLI + Telegram extensions + OpenAI model.
 */

import "dotenv/config";
import { cliExtension } from "@daydreamsai/cli";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createDreams,
  context,
  action,
  render,
  validateEnv,
} from "@daydreamsai/core";
import * as z from "zod";
import { telegramExtension } from "./telegram";
import { ekuboTraderContext } from "./ekuboTrader"; // ⟵ include your trader

// --- ENV ---
const env = validateEnv(
  z.object({
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    TELEGRAM_TOKEN: z.string().optional(),
    NETWORK: z.string().optional().default("sepolia"),
  })
);

// quick sanity print in logs
console.log("[env-check]", {
  OPENAI: typeof process.env.OPENAI_API_KEY,
  TELEGRAM: typeof process.env.TELEGRAM_TOKEN,
  NETWORK: env.NETWORK,
});

// --- MODEL ---
const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY! });

// --- GOAL CONTEXT TEMPLATE ---
const template = `Goal: {{goal}}`;

// --- MEMORY SHAPE ---
type GoalMemory = { goal: string };

// --- GOAL CONTEXT ---
export const goalContext = context<GoalMemory>({
  type: "goal",
  schema: z.object({
    id: z.string().describe("Unique identifier for the goal session"),
  }),
  key({ id }) {
    return id;
  },
  create() {
    return { goal: "" };
  },
  render({ memory }) {
    return render(template, { goal: memory.goal || "(none set yet)" });
  },
  // Stronger instructions so the model *always* tool-calls and replies to Telegram
  instructions: `
You have one action available:
- addTask({ task: string }): stores/updates the current goal text.

Rules:
1) When the input intends to set or update a goal (e.g. "/goal …", "set my goal to …",
   or the input param intent=="setGoal"), ALWAYS call addTask with the goal text.
2) When responding to a Telegram message input (<input type="telegram:message" userId="...">),
   ALWAYS reply using:
   <output type="telegram:message">{"userId":"<same userId>","content":"<reply text>"}</output>

Examples:

<input type="telegram:message" userId="123" intent="setGoal">Set my goal to 'auto-trade ETH/USDC safely'</input>
# tool: addTask {"task":"auto-trade ETH/USDC safely"}
<output type="telegram:message">{"userId":"123","content":"✅ Goal set to: auto-trade ETH/USDC safely"}</output>

<input type="telegram:message" userId="123">What's my current goal?</input>
<output type="telegram:message">{"userId":"123","content":"Your current goal is: auto-trade ETH/USDC safely"}</output>
`.trim(),
});

// --- ACTIONS ---
goalContext.setActions([
  action({
    name: "addTask",
    description: "Add a task (sets the goal text)",
    schema: z.object({ task: z.string() }),
    async handler({ task }, ctx) {
      ctx.memory.goal = task;
      return { ok: true, goal: ctx.memory.goal };
    },
  }),
]);

// --- EXTENSIONS ---
const extensions = [cliExtension];
if (env.TELEGRAM_TOKEN) {
  extensions.push(telegramExtension);
} else {
  console.warn("[telegram] TELEGRAM_TOKEN not set; running CLI only.");
}

// --- AGENT ---
const agent = createDreams({
  model: openai("gpt-4o"),
  extensions,
  // Register BOTH contexts so the agent can use either
  contexts: [goalContext, ekuboTraderContext],
});

// --- STARTUP ---
async function main() {
  await agent.start();

  console.log("🚀 my-agent running (Railway / local mode)");
  console.log("   - Telegram:", env.TELEGRAM_TOKEN ? "✅" : "❌");
  console.log("   - CLI: available (type in terminal)");
  console.log("   - Network:", env.NETWORK);

  // Start the trader context as the default running session
  await agent.run({
    context: ekuboTraderContext,
    args: { userId: "default", network: env.NETWORK },
  });

  // Also keep a goal session available for /goal and /status
  await agent.run({
    context: goalContext,
    args: { id: "default" },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
