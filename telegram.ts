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

// Chats that have auto-trading enabled
const autoChats = new Set<number>();

// -------------------------------------------------------------
// Formatting helpers
// -------------------------------------------------------------

function formatTrackingSnapshotMessage(snapshot: any): string {
  if (!snapshot.hasUniverse) {
    return "No universe set yet for this chat.\n\nUse `/set_universe STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM` first.";
  }

  const lines: string[] = [];

  lines.push(
    `📡 Tracking snapshot\n` +
      `Universe updated: ${snapshot.universeUpdatedAt}\n` +
      `Tokens: ${snapshot.tokens.length}`,
  );

  for (const t of snapshot.tokens) {
    lines.push("");
    lines.push(`*${t.symbol}* (\`${t.address}\`)`);
    lines.push(
      `Pools vs USDC: total ${t.totalUsdcPools}, active ${t.activeUsdcPools}`,
    );
    if (!t.bestPool) {
      lines.push("Best pool: _none (no active liquidity)_");
      continue;
    }
    const keyShort = String(t.bestPool.keyHash).slice(0, 10) + "…";
    lines.push(
      `Best pool: \`${keyShort}\`\n` +
        `• fee: \`${t.bestPool.fee}\`\n` +
        `• tickSpacing: \`${t.bestPool.tickSpacing}\`\n` +
        `• liquidity: \`${(t.bestPool.liquidityBigInt ?? 0n).toString()}\``,
    );
  }

  return lines.join("\n");
}

/**
 * Format a human-readable summary of a trading universe/watchlist.
 * This consumes the shape returned by buildUniverseFromText in ekubo.mjs.
 */
function formatUniverseMessage(universe: any | null | undefined): string {
  if (!universe || !universe.tradable) {
    return "No universe set yet.\n\nUse:\n`/set_universe STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM`\n\nSymbols can be comma or space separated.";
  }

  const lines: string[] = [];

  lines.push(
    `📈 Current trading universe (${universe.tradable.length} token(s))\n` +
      `Last updated: ${universe.updatedAt}`,
  );

  if (universe.tradable.length) {
    lines.push("");
    lines.push("✅ Tradable vs USDC:");
    for (const t of universe.tradable) {
      const addr = String(t.address ?? "");
      const addrShort =
        addr && addr.startsWith("0x") && addr.length > 12
          ? `${addr.slice(0, 8)}…${addr.slice(-4)}`
          : addr || "unknown";
      const poolsCount = (t.usdcPools?.length ?? 0) as number;
      lines.push(`- ${t.symbol} (${addrShort}) – ${poolsCount} USDC pool(s)`);
    }
  }

  if (universe.unresolved?.length) {
    const uniq = Array.from(new Set(universe.unresolved));
    if (uniq.length) {
      lines.push("");
      lines.push("⚠️ Not tradable / not found:");
      lines.push(`- ${uniq.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// -------------------------------------------------------------
// Command registration: tracking (/show_pairs)
// -------------------------------------------------------------

async function registerTrackingCommands(telegraf: Telegraf) {
  const { buildTrackingSnapshot } = await import(
    "./src/strategy/tracker.mjs"
  );

  telegraf.command("show_pairs", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const snapshot = await buildTrackingSnapshot(chatId);
      const msg = formatTrackingSnapshotMessage(snapshot);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/show_pairs] error:", err);
      await ctx.reply("❌ Failed to build tracking snapshot. Check logs.");
    }
  });
}

// -------------------------------------------------------------
// Command registration: STRK trading
// -------------------------------------------------------------

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
    setAutoMode,
    autoTradeTick,
  } = await import("./src/strategy/trading.mjs");

  // /paper_tick → run one paper trade tick and show what the bot *would* do.
  telegraf.command("paper_tick", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      await ctx.reply("⏳ Running paper trade tick for current universe…");
      const result = await tradeTick(chatId, { mode: "paper" });
      const msg = formatPaperTickMessage(result);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/paper_tick] error:", err);
      await ctx.reply("❌ Paper trade tick failed. Check logs for details.");
    }
  });

  // /strk_status → show current mode, price and balances
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

  // /live_on → switch mode to LIVE (execution still stubbed)
  telegraf.command("live_on", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const cfg = setLiveMode(chatId, true);
      const msg = formatModeChangeMessage(cfg);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/live_on] error:", err);
      await ctx.reply("❌ Failed to switch to LIVE mode. Check logs.");
    }
  });

  // /live_off → switch mode back to PAPER
  telegraf.command("live_off", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const cfg = setLiveMode(chatId, false);
      const msg = formatModeChangeMessage(cfg);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/live_off] error:", err);
      await ctx.reply("❌ Failed to switch to PAPER mode. Check logs.");
    }
  });

  // /stop_and_flatten → sell all STRK → USDC (paper) and disable auto
  telegraf.command("stop_and_flatten", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      autoChats.delete(chatId);
      const res = await stopAndFlatten(chatId);
      const msg = formatStopAndFlattenMessage(res);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/stop_and_flatten] error:", err);
      await ctx.reply("❌ Failed to stop and flatten. Check logs.");
    }
  });

  // /auto_on → enable 1-minute auto trading
telegraf.command("auto_on", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      autoChats.add(chatId);
      const cfg = setAutoMode(chatId, true);
      await ctx.reply(
        [
          "🔁 Auto trading enabled for this chat.",
          "",
          `Mode: ${cfg.mode.toUpperCase()}`,
          "The bot will run one tick each minute while auto mode is ON.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (err: any) {
      console.error("[telegram:/auto_on] error:", err);
      await ctx.reply("❌ Failed to enable auto trading. Check logs.");
    }
  });
  
  // /auto_off → disable 1-minute auto trading
  telegraf.command("auto_off", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      autoChats.delete(chatId);
      const cfg = setAutoMode(chatId, false);
      await ctx.reply(
        [
          "⏹ Auto trading disabled for this chat.",
          "",
          `Mode: ${cfg.mode.toUpperCase()}`,
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (err: any) {
      console.error("[telegram:/auto_off] error:", err);
      await ctx.reply("❌ Failed to disable auto trading. Check logs.");
    }
  });
  
  // 🔁 Auto loop: once per minute, at most one tick per minute per chat
  setInterval(async () => {
    try {
      for (const chatId of autoChats) {
        try {
          const { autoRan, message } = await autoTradeTick(chatId);
          if (autoRan && message) {
            await telegraf.telegram.sendMessage(chatId, message, {
              parse_mode: "Markdown",
            });
          }
        } catch (err: any) {
          console.error("[telegram:auto-loop] per-chat error:", err);
        }
      }
    } catch (err: any) {
      console.error("[telegram:auto-loop] error:", err);
    }
  }, 60_000);
}  
// -------------------------------------------------------------
// Command registration: universe / watchlist
// -------------------------------------------------------------

async function registerUniverseCommands(telegraf: Telegraf) {
  // Dynamic imports to avoid TS/ESM pain with .mjs from a .ts file.
  const { buildUniverseFromText } = await import(
    "./src/utils/ekubo.mjs"
  );
  const { getUniverse, setUniverse } = await import(
    "./src/state/watchlist.mjs"
  );

  // /set_universe STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM
  telegraf.command("set_universe", async (ctx) => {
    try {
      const text = (ctx.message as any).text as string;
      const raw = text.split(" ").slice(1).join(" ").trim();

      if (!raw) {
        return ctx.reply(
          "Usage:\n" +
            "`/set_universe STRK, EKUBO, DOG, ETH, BONK, PUMP, MIM`\n\n" +
            "Symbols can be comma or space separated.",
          { parse_mode: "Markdown" },
        );
      }

      await ctx.reply(
        "⏳ Building trading universe from Ekubo tokens and USDC pools…",
      );

      const universe = await buildUniverseFromText(raw);
      await setUniverse(ctx.chat.id, universe);

      const msg =
        "✅ Universe updated.\n\n" + formatUniverseMessage(universe);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/set_universe] error:", err);
      await ctx.reply(
        "❌ Failed to build universe. Check logs and make sure Ekubo API is reachable.",
      );
    }
  });

  // /show_universe
  telegraf.command("show_universe", async (ctx) => {
    try {
      const universe = await getUniverse(ctx.chat.id);
      const msg = formatUniverseMessage(universe);
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      console.error("[telegram:/show_universe] error:", err);
      await ctx.reply("❌ Failed to load universe. Check logs.");
    }
  });
}

// -------------------------------------------------------------
// Daydreams service + boot
// -------------------------------------------------------------

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
            "✅ Ekubo agent online.",
            "",
            "/goal <text>",
            "/status",
            "/set_universe <symbols>",
            "/show_universe",
            "/show_pairs",
            "/paper_tick",
            "/strk_status",
            "/live_on",
            "/live_off",
            "/auto_on",
            "/auto_off",
            "/stop_and_flatten",
            "",
            "(or just type)",
          ].join("\n"),
        ),
      );

      telegraf.help((ctx) =>
        ctx.reply(
          [
            "Commands:",
            "/goal <text>",
            "/status",
            "/set_universe <symbols>",
            "/show_universe",
            "/show_pairs",
            "/paper_tick",
            "/strk_status",
            "/live_on",
            "/live_off",
            "/auto_on",
            "/auto_off",
            "/stop_and_flatten",
          ].join("\n"),
        ),
      );

      // 🔧 Register /set_universe and /show_universe
      await registerUniverseCommands(telegraf);

      // 🔧 Register /show_pairs tracking debug command
      await registerTrackingCommands(telegraf);

      // 🔧 Register trading commands (paper tick + STRK things)
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

// -------------------------------------------------------------
// Daydreams context + I/O wiring
// -------------------------------------------------------------

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
