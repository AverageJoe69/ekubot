/**
 * Daydreams agent with cliExtension extension(s)
 * Using OpenAI as the model provider
 */
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

// 👉 Telegram extension (from your local ./telegram file)
import { telegramExtension } from "./telegram";

// --- ENV ---
const env = validateEnv(
  z.object({
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    TELEGRAM_TOKEN: z.string().optional(), // optional so CLI-only still works
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
type GoalMemory = {
  goal: string;
};

// --- CONTEXT (Daydreams style) ---
export const goalContext = context<GoalMemory>({
  type: "goal",
  schema: z.object({
    id: z.string().describe("Unique identifier for the goal session"),
  }),

  // (optional) a stable key for this context instance
  key({ id }) {
    return id;
  },

  // initialize memory for a new instance
  create() {
    return {
      goal: "",
    };
  },

  // what the model sees
  render({ memory }) {
    return render(template, {
      goal: memory.goal || "(none set yet)",
    });
  },

  // Nudge the model: if input came from Telegram, respond via Telegram.
  // NOTE: the telegram output expects a JSON body { "userId": "...", "content": "..." }
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

// Only attach Telegram if the token is present
if (env.TELEGRAM_TOKEN) {
  extensions.push(telegramExtension);
} else {
  console.warn(
    "[telegram] TELEGRAM_TOKEN not set; running CLI only (no Telegram)."
  );
}

// --- AGENT ---
const agent = createDreams({
  model: openai("gpt-4o"),
  extensions,
  contexts: [goalContext], // <-- IMPORTANT: register contexts here
});

// --- START ---
async function main() {
  await agent.start();

  // Run the agent against our context, providing required args (CLI path)
  await agent.run({
    context: goalContext,
    args: { id: "test" },
  });
}

main().catch(console.error);
