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

/**
 * Register STRK trading commands:
 * - /paper_tick         → run one STRK paper trade tick
 * - /strk_status        → show mode + balances + equity
 * - /live_on / /live_off → toggle live vs paper mode (execution still TODO)
 * - /stop_and_flatten   → halt trading and sell all STRK to USDC (paper)
 */
async function registerTradingCommands(telegraf: Telegraf) {
  const {
    tradeTick,
    formatPaperTickMessage,
    getTradingStatus,
    formatStatusMessage,
    setLiveMode,
    formatModeChangeMessage,
    stopAndFlatten,
    formatStopAndFlattenMessage,
  } = await import("./src/strategy/trading.mjs");

  // /paper_tick → run one STRK paper trade tick
  telegraf.command("paper_tick", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      await ctx.reply("⏳ Running STRK paper trade tick…");

      const result = await tradeTick(chatId, { mode: "paper" });
      const msg = formatPaperTickMessage(result);

      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/paper_tick] error:", err);
      await ctx.reply("❌ Paper trade tick failed. Check logs for details.");
    }
  });

  // /strk_status → show balances + mode + equity
  telegraf.command("strk_status", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const status = await getTradingStatus(chatId);
      const msg = formatStatusMessage(status);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/strk_status] error:", err);
      await ctx.reply("❌ Failed to load STRK status. Check logs.");
    }
  });

  // /live_on → set mode to live + enable auto (future scheduler)
  telegraf.command("live_on", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const cfg = setLiveMode(chatId, true);
      const msg = formatModeChangeMessage(cfg);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/live_on] error:", err);
      await ctx.reply("❌ Failed to enable live mode.");
    }
  });

  // /live_off → set mode to paper + disable auto
  telegraf.command("live_off", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const cfg = setLiveMode(chatId, false);
      const msg = formatModeChangeMessage(cfg);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/live_off] error:", err);
      await ctx.reply("❌ Failed to disable live mode.");
    }
  });

  // /stop_and_flatten → stop trading & sell all STRK to USDC (paper)
  telegraf.command("stop_and_flatten", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      await ctx.reply("🛑 Stopping trading and selling all STRK to USDC…");
      const res = await stopAndFlatten(chatId);
      const msg = formatStopAndFlattenMessage(res);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/stop_and_flatten] error:", err);
      await ctx.reply("❌ Failed to stop and flatten. Check logs.");
    }
  });
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

  async boot(container) {
    const telegraf = resolveOptional<Telegraf>(container, "telegraf");
    if (!telegraf) return;

    try {
      telegraf.start((ctx) =>
        ctx.reply(
          [
            "✅ STRK swing trader online.",
            "",
            "Core commands:",
            "/paper_tick – run one STRK paper tick",
            "/strk_status – show balances & mode",
            "/live_on – switch to LIVE mode (execution TBD)",
            "/live_off – back to PAPER mode",
            "/stop_and_flatten – halt & sell all STRK to USDC (paper)",
            "",
            "General agent commands:",
            "/goal <text>",
            "/status",
            "",
            "(or just type)",
          ].join("\n"),
        ),
      );

      telegraf.help((ctx) =>
        ctx.reply(
          [
            "Commands:",
            "/paper_tick – run one STRK paper tick",
            "/strk_status – show STRK balances & mode",
            "/live_on – enable live mode (no swaps yet)",
            "/live_off – disable live mode (paper only)",
            "/stop_and_flatten – halt & sell all STRK to USDC (paper)",
            "",
            "/goal <text> – set agent goal",
            "/status – show current goal/status",
          ].join("\n"),
        ),
      );

      // Register STRK trading commands
      await registerTradingCommands(telegraf);

      console.log("[telegram] starting…");

      // Non-blocking launch
      Promise.resolve(telegraf.launch({ dropPendingUpdates: true }))
        .then(() => {
          console.log("[telegram] launch() kicked off (polling).");
        })
        .catch((err) => {
          console.error(
            "[telegram] launch() error (continuing without Telegram):",
            err,
          );
        });

      // Fire-and-forget readiness probe with timeout
      const getMeWithTimeout = Promise.race([
        telegraf.telegram.getMe(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("getMe timeout")), 7000),
        ),
      ]);

      (getMeWithTimeout as Promise<any>)
        .then((info: any) => console.log("[telegram] bot ready:", info))
        .catch((err) =>
          console.warn("[telegram] getMe probe failed:", err),
        );

      // graceful shutdown
      process.once("SIGINT", () => telegraf.stop("SIGINT"));
      process.once("SIGTERM", () => telegraf.stop("SIGTERM"));
    } catch (err) {
      console.error(
        "[telegram] boot error (continuing without Telegram):",
        err,
      );
      // Do not throw — keep the worker alive even if Telegram fails to start.
    }
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
      return `Private Telegram chat with @${
        (chat as any).username ?? "user"
      } (id ${chat.id}).`;
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
  if (
    /^\/status\b/i.test(t) ||
    /what'?s my (current )?goal\??/i.test(t)
  )
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
          if (!("text" in (ctx.message as any))) return;
          const chatId = ctx.chat.id;
          const from = (ctx.message as any).from;

          send(
            telegramChat,
            { chatId },
            {
              user: { id: from.id, username: from.username ?? "user" },
              text: (ctx.message as any).text,
            },
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

        const chunks = splitTextIntoChunks(data.content, {
          maxChunkSize: 4096,
        });
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
