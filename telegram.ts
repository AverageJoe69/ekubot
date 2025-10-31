// telegram.ts
import * as z from "zod";
import { context, service, extension, input, output, splitTextIntoChunks } from "@daydreamsai/core";
import { Telegraf } from "telegraf";
import type { Chat } from "@telegraf/types";

const telegramService = service({
  register(container) {
    // Uses process.env.TELEGRAM_TOKEN (set by validateEnv in index.ts)
    container.singleton("telegraf", () => new Telegraf(process.env.TELEGRAM_TOKEN!));
  },
  async boot(container) {
    const telegraf = container.resolve<Telegraf>("telegraf");
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
        user: z.object({ id: z.number(), username: z.string().optional().default("user") }),
        text: z.string(),
      }),
      // Produce a Daydreams input that carries the text and userId
      format: ({ data }) => ({
        tag: "input",
        params: { type: "telegram:message", userId: String(data.user.id), username: data.user.username ?? "user" },
        children: data.text,
      }),
      subscribe(send, { container }) {
        const telegraf = container.resolve<Telegraf>("telegraf");

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
      // NOTE: Your model must emit JSON like:
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
