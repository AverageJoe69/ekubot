import { openai } from "@daydreamsai/openai";

export async function callGptStrategy({ priceData, position, latestPrice, now }) {
  const prompt = `
You are an expert swing trader. You trade STRK/USDC only.

Time: ${now}
Latest price: ${latestPrice}

Analyze the recent STRK price data and current position.
Return STRICT JSON with BUY / SELL / HOLD.

Format EXACTLY:

{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0.0 - 1.0,
  "size_usdc": number,
  "reason": "text"
}

Candle data (oldest → newest):
${JSON.stringify(priceData)}

Position:
${JSON.stringify(position)}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  const raw = res.choices[0].message.content.trim();

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("[gptStrategy] Failed to parse GPT output:", raw);
    return {
      action: "HOLD",
      confidence: 0,
      size_usdc: 0,
      reason: "parse_error",
    };
  }
}
