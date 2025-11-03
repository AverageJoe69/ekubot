// telegram.ts
import * as z from "zod";
import {
  context,
  service,
  extension,
  input,
  output,
  splitTextIntoChunks,
} from "@daydreamsai/core";
import { Telegraf } from "telegraf";
import type { Chat } from "@telegraf/types";

const telegramService = service({
  register(container) {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      console.warn("[telegram] TELEGRAM_TOKEN not set; extension disabled.");
      return;
    }
    container.singleton("telegraf", () => new Telegraf(token));
  },

  async boot(container) {
    const telegraf = container.maybeResolve<Telegraf>("telegraf");
    if (!telegraf) return;

    // Minimal built-in fallback so users always get *something*.
    telegraf.start((ctx) =>
      ctx.reply(
        "✅ Ekubo agent online.\n\nTry:\n• /goal <text>\n• /status\n• or just type your request."
      )
    );
    telegraf.help((ctx) =>
      ctx.reply("Commands:\n/goal <text>\n/status\n(Free text also works.)")
    );

    console.log("[telegram] starting…");
    telegraf.launch({ dropPendingUpdates: true });
    const info = await telegraf.telegram.getMe();
    console.log(info);
  },
});

const telegramChat = context({
  type: "telegram:chat",
  key: ({ chatId }) => chatId.toString(),
  schema: z.object({ chatId: z.number() }),

  async setup(args, _settings, { container }) {
    const tg = container.maybeResolve<Telegraf>("telegraf");
    if (!tg) return { chat: undefined as unknown as Chat }; // disabled
    const chat = (await tg.telegram.getChat(args.chatId)) as Chat;
    return { chat };
  },

  description({ options: { chat } }) {
    if (!chat) return "";
    if (chat.type === "private") {
      // Keep this concise; it becomes model context.
      return `Private Telegram chat with @${chat.username ?? "user"} (id ${chat.id}).`;
    }
    return "";
  },
});

/**
 * Helper: parse raw text for light intent hints to steer the model.
 * We do NOT execute actions here—just annotate the input so the LLM reliably tool-calls.
 */
function inferIntent(text: string) {
  const t = text.trim();
  const goalMatch =
    /^\/goal\s+(.+)/i.exec(t) ||
    /^(?:set|update)\s+my\s+goal\s+to\s+['"]?(.+?)['"]?$/i.exec(t);
  if (goalMatch) {
    return { intent: "setGoal", args: { task: goalMatch[1] } as Record<string, unknown> };
  }
  if (/^\/status\b/i.test(t) || /what'?s my (current )?goal\??/i.test(t)) {
    return { intent: "status", args: {} };
  }
  return { intent: "message", args: {} };
}

export const telegramExtension = extension({
  name: "telegram",
  services: [telegramService],
  contexts: { chat: telegramChat },

  inputs: {
    "telegram:message": input({
      schema: z.object({
        user: z.object({
          id: z.number(),
          username: z.string().optional().default("user"),
        }),
        text: z.string(),
      }),

      // Produce a Daydreams input that carries text + intent hints
      format: ({ data }) => {
        const { intent, args } = inferIntent(data.text);
        return {
          tag: "input",
          params: {
            type: "telegram:message",
            userId: String(data.user.id),
            username: data.user.username ?? "user",
            intent, // "setGoal" | "status" | "message"
          },
          // Child content is the *original* text for the model
          children: data.text,
          // Extra payload the model can read from the input node
          meta: { args },
        };
      },

      subscribe(send, { container }) {
        const telegraf = container.maybeResolve<Telegraf>("telegraf");
        if (!telegraf) return () => {};

        telegraf.on("message", (ctx) => {
          if (!("text" in ctx.message)) return;
          const chatId = ctx.chat.id;
          const from = ctx.message.from;

          // Always forward to Daydreams; the model decides outputs/actions.
          send(
            telegramChat,
            { chatId },
            {
              user: { id: from.id, username: from.username ?? "user" },
              text: ctx.message.text,
            }
          );
        });

        return () => {};
      },
    }),
  },

  outputs: {
    "telegram:message": output({
      // Model must emit:
      // <output type="telegram:message">{"userId":"<id>","content":"..."}"</output>
      schema: z.object({
        userId: z.string().describe("Telegram chat/user id to send to"),
        content: z.string().describe("Markdown-compatible message"),
      }),
      description: "Send a Telegram message",
      enabled({ context }) {
        return context.type === telegramChat.type;
      },
      async handler(data, _ctx, { container }) {
        const telegraf = container.maybeResolve<Telegraf>("telegraf");
        if (!telegraf) return { ok: false, error: "telegram disabled" };

        const chunks = splitTextIntoChunks(data.content, { maxChunkSize: 4096 });
        for (const chunk of chunks) {
          await telegraf.telegram.sendMessage(data.userId, chunk, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          });
        }
        return { ok: true, at: Date.now() };
      },
    }),
  },
});
