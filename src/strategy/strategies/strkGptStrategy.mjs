// src/strategy/strategies/strkGptStrategy.mjs
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Build a compact prompt
function buildPrompt(priceData, latestPrice, position) {
  const series = priceData.map(p => p.price.toFixed(4)).join(", ");

  return `
You are an automated crypto swing-trader.

Asset: STRK/USDC
Latest price: ${latestPrice}
Current position:
- USDC: ${position.usdc}
- STRK: ${position.strk}

Last 60 minutes price series:
${series}

Goal: maximise profit by swing trading. Use strict discipline:
- BUY only if a bullish reversal is likely.
- SELL only if a bearish reversal is likely.
- HOLD if uncertain.

Answer ONLY with JSON in this format:

{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0.0–1.0,
  "reason": "short explanation"
}
`;
}

export async function strkGptStrategy(ctx) {
  const { priceData, latestPrice, position } = ctx;

  const prompt = buildPrompt(priceData, latestPrice, position);

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a disciplined crypto swing trader." },
      { role: "user", content: prompt },
    ],
  });

  const data = response.choices[0].message.parsed;

  if (!data || !data.action) {
    return []; // Default HOLD
  }

  const action = data.action.toUpperCase();

  if (action === "HOLD") return [];

  const sizeUsd = 50; // fixed for now, configurable later

  return [
    {
      strategy: "gpt-swing",
      side: action,
      sizeUsd,
      reason: data.reason,
      confidence: data.confidence ?? 0,
    },
  ];
}
