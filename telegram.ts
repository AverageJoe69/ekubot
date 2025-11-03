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

// Safe resolver for Core 0.3.22
function resolveOptional<T>(container: any, key: string): T | undefined {
  try {
    return container.resolve<T>(key);
  } catch {
    return undefined;
  }
}

const telegramService = service({
  register(container) {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      console.warn("[telegram] TELEGRAM_TOKEN not set; extension disabled.");
      return;
    }
    container.singleton("telegraf", () => new Telegraf(token));
  },

  // --- replace your async boot(container) with this ---
async boot(container) {
    const telegraf = resolveOptional<Telegraf>(container, "telegraf");
    if (!telegraf) return;
  
    try {
      telegraf.start((ctx) =>
        ctx.reply("✅ Ekubo agent online.\n\n/goal <text>\n/status\n(or just type)")
      );
      telegraf.help((ctx) => ctx.reply("Commands:\n/goal <text>\n/status"));
  
      console.log("[telegram] starting…");
  
      // DO NOT await launch — run it in the background
      Promise.resolve(
        telegraf.launch({ dropPendingUpdates: true })
      ).then(() => {
        console.log("[telegram] launch() kicked off (polling).");
      }).catch((err) => {
        console.error("[telegram] launch() error (continuing without Telegram):", err);
      });
  
      // Fire-and-forget readiness probe with timeout (non-blocking)
      const getMeWithTimeout = Promise.race([
        telegraf.telegram.getMe(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("getMe timeout")), 7000)),
      ]);
  
      getMeWithTimeout
        .then((info: any) => console.log("[telegram] bot ready:", info))
        .catch((err) => console.warn("[telegram] getMe probe failed:", err));
  
      // graceful shutdown
      process.once("SIGINT", () => telegraf.stop("SIGINT"));
      process.once("SIGTERM", () => telegraf.stop("SIGTERM"));
    } catch (err) {
      console.error("[telegram] boot error (continuing without Telegram):", err);
      // Do not throw — keep the worker alive even if TG is down.
    }
  },
  

    // graceful shutdown
    process.once("SIGINT", () => telegraf.stop("SIGINT"));
    process.once("SIGTERM", () => telegraf.stop("SIGTERM"));
  },
});

const telegramChat = context({
  type: "telegram:chat",
  key: ({ chatId }) => chatId.toString(),
  schema: z.object({ chatId: z.number() }),

  async setup(args, _settings, { container }) {
    const tg = resolveOptional<Telegraf>(container, "telegraf");
    if (!tg) return { chat: undefined as unknown as Chat };
    const chat = (await tg.telegram.getChat(args.chatId)) as Chat;
    return { chat };
  },

  description({ options: { chat } }) {
    if (!chat) return "";
    if (chat.type === "private") {
      return `Private Telegram chat with @${chat.username ?? "user"} (id ${chat.id}).`;
    }
    return "";
  },
});

// Light intent hints to steer the model toward your action
function inferIntent(text: string) {
  const t = text.trim();
  const goalMatch =
    /^\/goal\s+(.+)/i.exec(t) ||
    /^(?:set|update)\s+my\s+goal\s+to\s+['"]?(.+?)['"]?$/i.exec(t);
  if (goalMatch) return { intent: "setGoal", args: { task: goalMatch[1] } };
  if (/^\/status\b/i.test(t) || /what'?s my (current )?goal\??/i.test(t))
    return { intent: "status", args: {} };
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
      format: ({ data }) => {
        const { intent, args } = inferIntent(data.text);
        return {
          tag: "input",
          params: {
            type: "telegram:message",
            userId: String(data.user.id),
            username: data.user.username ?? "user",
            intent,
          },
          children: data.text,
          meta: { args },
        };
      },
      subscribe(send, { container }) {
        const telegraf = resolveOptional<Telegraf>(container, "telegraf");
        if (!telegraf) return () => {};

        telegraf.on("message", (ctx) => {
          if (!("text" in ctx.message)) return;
          const chatId = ctx.chat.id;
          const from = ctx.message.from;

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
      schema: z.object({
        userId: z.string().describe("Telegram chat/user id to send to"),
        content: z.string().describe("Markdown-compatible message"),
      }),
      description: "Send a Telegram message",
      enabled({ context }) {
        return context.type === telegramChat.type;
      },
      async handler(data, _ctx, { container }) {
        const telegraf = resolveOptional<Telegraf>(container, "telegraf");
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
