// assistantContext.ts
import { context, action } from "@daydreamsai/core";
import * as z from "zod";

export const assistantContext = context({
  type: "personal-assistant",
  schema: z.object({
    userId: z.string().describe("Unique identifier for the user"),
  }),
  create: () => ({
    userName: "",
    lastTopic: "",
    preferences: {} as Record<string, unknown>,
    conversationCount: 0,
  }),
  render: (state) => {
    const { userName, conversationCount, lastTopic, preferences } = state.memory;
    return `
Personal Assistant for User: ${state.args.userId}
${userName ? `Name: ${userName}` : "Name: Unknown (ask for their name!)"}
Conversations: ${conversationCount}
${lastTopic ? `Last topic: ${lastTopic}` : ""}
${
  Object.keys(preferences).length > 0
    ? `Preferences: ${JSON.stringify(preferences, null, 2)}`
    : "No preferences saved yet"
}
    `.trim();
  },
  instructions: `You are a personal assistant with memory. You should:
- Remember information about the user across conversations
- Ask for their name if you don't know it
- Learn their preferences over time
- Reference previous conversations when relevant
- Be helpful and personalized based on what you know`,
  onRun: async (ctx) => {
    ctx.memory.conversationCount++;
  },
});

assistantContext.setActions([
  action({
    name: "remember-name",
    description: "Remember the user's name",
    schema: z.object({ name: z.string().describe("The user's name") }),
    handler: async ({ name }, ctx) => {
      ctx.memory.userName = name;
      return { remembered: true, message: `I'll remember your name is ${name}` };
    },
  }),
  action({
    name: "update-topic",
    description: "Remember what we're discussing",
    schema: z.object({ topic: z.string().describe("Current conversation topic") }),
    handler: async ({ topic }, ctx) => {
      ctx.memory.lastTopic = topic;
      return { updated: true };
    },
  }),
]);
