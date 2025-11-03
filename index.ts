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

// --- ENV ---
const env = validateEnv(
  z.object({
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    TELEGRAM_TOKEN: z.string().optional(),
  })
);

// --- MODEL ---
const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY!,
});

// --- CONTEXT TEMPLATE ---
const template = `
Goal: {{goal}}
`;

// --- MEMORY SHAPE ---
type GoalMemory = { goal: string };

// --- CONTEXT ---
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
  instructions: `
If the current input is <input type="telegram:message" userId="...">,
reply using:
<output type="telegram:message">{"userId":"<same userId>","content":"<your reply>"}</output>
Otherwise, you may reply with CLI output.
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
  contexts: [goalContext],
});

// --- STARTUP ---
async function main() {
  await agent.start();

  console.log("🚀 my-agent running (Railway / local mode)");
  console.log("   - Telegram: active" + (env.TELEGRAM_TOKEN ? " ✅" : " ❌"));
  console.log("   - CLI: available (type in terminal)");

  await agent.run({
    context: goalContext,
    args: { id: "default" },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
