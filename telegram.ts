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

// ⬇️ Trader (TWAP) strategy controls
import * as trader from "./strategies/twap";

const telegramService = service({
  register(container) {
    // Uses process.env.TELEGRAM_TOKEN (set by validateEnv in index.ts)
    container.singleton(
      "telegraf",
      () => new Telegraf(process.env.TELEGRAM_TOKEN!)
    );
  },
  async boot(container) {
    const telegraf = container.resolve<Telegraf>("telegraf");

    // --- COMMANDS: register BEFORE launch ---
    telegraf.start((ctx) =>
      ctx.reply(
        "Ekubot online. Commands: /status /start_trader /stop_trader /set <key> <value> /tick"
      )
    );

    telegraf.command("status", async (ctx) => {
      try {
        const s = await trader.status();
        // Send as plain text to avoid Markdown escaping issues
        await ctx.reply(JSON.stringify(s, null, 2));
      } catch (e: any) {
        await ctx.reply(`status error: ${e?.message ?? e}`);
      }
    });

    telegraf.command("start_trader", (ctx) => {
      const ok = trader.start(20_000);
      ctx.reply(ok ? "Trader started (20s loop)." : "Trader already running.");
    });

    telegraf.command("stop_trader", (ctx) => {
      trader.stop();
      ctx.reply("Trader stopped.");
    });

    telegraf.command("set", (ctx) => {
      const txt =
        "text" in ctx.message ? ((ctx.message as any).text as string) : "";
      const [, key, value] = txt.split(" ");
      if (!key || value === undefined)
        return ctx.reply("Usage: /set <key> <value>");
      trader.setConfig(key, value);
      ctx.reply(`Set ${key}=${value}`);
    });

    // Manual single evaluation tick (useful for debugging)
    telegraf.command("tick", async (ctx) => {
      try {
        await trader.runOnce();
        ctx.reply("Ticked.");
      } catch (e: any) {
        ctx.reply(`tick error: ${e?.message ?? e}`);
      }
    });

    // --- LAUNCH after handlers are registered ---
    console.log("starting..");
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
    const telegraf = container.resolve<Telegraf>("telegraf");
    const chat = (await telegraf.telegram.getChat(args.chatId)) as Chat;
    return { chat };
  },

  description({ options: { chat } }) {
    if (chat.type === "private") {
      return `You are in private telegram chat with ${chat.username} id: ${chat.id}`;
    }
    return "";
  },
});

export const telegramExtension = extension({
  name: "telegram",
  services: [telegramService],
  contexts: { chat: telegramChat },

  inputs: {
    "telegram:message": input({
      schema: z.object({
        user: z
          .object({ id: z.number(), username: z.string().optional().default("user") }),
        text: z.string(),
      }),
      // Produce a Daydreams input that carries the text and userId
      format: ({ data }) => ({
        tag: "input",
        params: {
          type: "telegram:message",
          userId: String(data.user.id),
          username: data.user.username ?? "user",
        },
        children: data.text,
      }),
      subscribe(send, { container }) {
        const telegraf = container.resolve<Telegraf>("telegraf");

        telegraf.on("message", (ctx) => {
          if (!("text" in ctx.message)) return;

          const chatId = ctx.chat.id;
          const from = ctx.message.from;

          send(telegramChat, { chatId }, {
            user: { id: from.id, username: from.username ?? "user" },
            text: ctx.message.text,
          });
        });

        return () => {};
      },
    }),
  },

  outputs: {
    "telegram:message": output({
      // Model should emit:
      // <output type="telegram:message">{"userId":"<id>","content":"hello"}</output>
      schema: z.object({
        userId: z.string().describe("Telegram user/chat id to send to"),
        content: z.string().describe("Message text (Markdown supported)"),
      }),
      description: "Send a Telegram message",
      enabled({ context }) {
        return context.type === telegramChat.type;
      },
      async handler(data, _ctx, { container }) {
        const tg = container.resolve<Telegraf>("telegraf").telegram;
        const chunks = splitTextIntoChunks(data.content, { maxChunkSize: 4096 });
        for (const chunk of chunks) {
          await tg.sendMessage(data.userId, chunk, { parse_mode: "Markdown" });
        }
        return { ok: true, at: Date.now() };
      },
    }),
  },
});
