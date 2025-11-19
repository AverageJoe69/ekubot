// src/strategy/strategies/strkGptStrategy.mjs
// -------------------------------------------------------------
// STRK strategy with GPT "Dreams-style" decision layer.
// - Tries to call OpenAI (if available) to analyze recent "candles"
//   and return BUY / SELL / HOLD.
// - If OpenAI or API key is missing, falls back to pure MA-based swing.
// -------------------------------------------------------------

/**
 * ctx: {
 *   chatId,
 *   snapshot,
 *   priceData: [{ t, price }],
 *   latestPrice: number,
 *   position: { usdc, strk, latestPrice },
 *   now,
 *   mode
 * }
 */

// ---------- Helper: build pseudo-candles from price history ----------

function buildPseudoCandles(priceData, latestPrice) {
  const pts = (priceData || [])
    .map((p) => ({
      t: p.t ?? p.ts ?? Date.now(),
      price: p.price,
    }))
    .filter((p) => typeof p.price === "number" && p.price > 0);

  if (!pts.length && latestPrice && latestPrice > 0) {
    pts.push({ t: Date.now(), price: latestPrice });
  }

  const last = pts.slice(-20); // last ~20 points

  const candles = [];
  for (let i = 0; i < last.length; i++) {
    const prev = last[i - 1] || last[i];
    const curr = last[i];

    const open = prev.price;
    const close = curr.price;
    const high = Math.max(open, close);
    const low = Math.min(open, close);

    candles.push({
      time: new Date(curr.t).toISOString(),
      open,
      high,
      low,
      close,
      volume: null, // we don't have real volume yet
    });
  }

  return candles;
}

// ---------- Helper: MA fallback (your old logic, slightly tweaked) ----------

function maFallbackIntent(priceData, latestPrice, position) {
  const prices = (priceData || [])
    .map((p) => p.price)
    .filter((x) => typeof x === "number" && x > 0);

  if (!latestPrice || latestPrice <= 0) return [];

  if (prices.length < 10) return []; // not enough data

  const sma = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const shortWindow = 3;
  const longWindow = 10;

  const shortMA = sma(prices.slice(-shortWindow));
  const longMA = sma(prices.slice(-longWindow));

  const momentum = shortMA - longMA;
  const relDiff = longMA ? momentum / longMA : 0;

  const usdc = Number(position.usdc ?? 0);
  const strk = Number(position.strk ?? 0);
  const strkUsd = strk * latestPrice;

  const baseSizeUsd = 50;
  const minRelDiff = 0.0005; // 0.05%

  // Bootstrap: if we have no STRK but we do have USDC, open initial long
  if (strkUsd < 1 && usdc >= 10) {
    const sizeUsd = Math.min(usdc, baseSizeUsd);
    return [
      {
        strategy: "ma-swing",
        side: "BUY",
        sizeUsd,
        confidence: 0.5,
        reason: "bootstrap: open initial STRK position with no existing holdings",
      },
    ];
  }

  // BUY
  if (relDiff > minRelDiff && usdc >= 10) {
    const strength = Math.min(1, relDiff / 0.005);
    const sizeUsd = Math.min(usdc, baseSizeUsd * (0.5 + strength));
    return [
      {
        strategy: "ma-swing",
        side: "BUY",
        sizeUsd,
        confidence: strength,
        reason: `short MA above long MA by ${(relDiff * 100).toFixed(3)}%`,
      },
    ];
  }

  // SELL
  if (relDiff < -minRelDiff && strkUsd >= 10) {
    const strength = Math.min(1, (-relDiff) / 0.005);
    const sizeUsd = Math.min(strkUsd, baseSizeUsd * (0.5 + strength));
    return [
      {
        strategy: "ma-swing",
        side: "SELL",
        sizeUsd,
        confidence: strength,
        reason: `short MA below long MA by ${(relDiff * 100).toFixed(3)}%`,
      },
    ];
  }

  return [];
}

// ---------- Helper: call OpenAI if available ----------

async function getGptDecision({ candles, latestPrice, position }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // No key → no GPT
    return null;
  }

  let OpenAI;
  try {
    // Dynamic import so Telegram doesn't crash if package isn't installed
    const mod = await import("openai");
    OpenAI = mod.default || mod.OpenAI || mod;
  } catch (err) {
    console.warn(
      "[strkGptStrategy] openai package not available, falling back to MA:",
      err?.message || err,
    );
    return null;
  }

  const client = new OpenAI({ apiKey });

  const prompt = `
You are a professional crypto swing trader specializing in STRK/USDC.

You are given:
- A list of recent STRK/USDC candles (approximate, but ordered oldest → newest).
- The current price.
- The current position (USDC balance and STRK balance).

Your job:
1. Identify the current trend (up, down, or choppy).
2. Describe the market structure (higher highs/lows, lower highs/lows, or sideways).
3. Comment on momentum strength (weak, medium, strong).
4. Identify any notable recent candle patterns (engulfing, hammer, doji, exhaustion, etc.), even approximately.
5. Decide whether to BUY, SELL, or HOLD **right now**.

Trading rules:
- Prefer BUY if trend is up, structure is higher lows, and momentum is medium or strong.
- Prefer SELL if trend is down, structure is lower highs, and momentum is medium or strong, and we hold STRK.
- Prefer HOLD in choppy or unclear conditions, or if price is in the middle of a range.
- Do not overtrade small random noise.
- Assume we can trade in small sizes relative to our balance.

Your output MUST be a single JSON object only, with this shape:

{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": number,           // 0 to 1
  "reason": "short explanation",
  "trend": "up|down|choppy|unclear",
  "structure": "text",
  "momentum": "weak|medium|strong",
  "pattern": "text"
}

Do not include any extra text outside the JSON.
`;

  const candlesPayload = JSON.stringify(candles.slice(-20));

  const messages = [
    {
      role: "system",
      content: "You are a cautious but opportunistic STRK/USDC swing trader.",
    },
    {
      role: "user",
      content:
        prompt +
        "\n\nRecent candles (JSON array):\n" +
        candlesPayload +
        "\n\nCurrent state (JSON object):\n" +
        JSON.stringify(
          {
            latestPrice,
            position: {
              usdc: position.usdc,
              strk: position.strk,
            },
          },
        ),
    },
  ];

  let content;
  try {
    const completion = await client.chat.completions.create({
      model: process.env.TRADER_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      messages,
    });

    content = completion.choices?.[0]?.message?.content?.trim();
  } catch (err) {
    console.error(
      "[strkGptStrategy] OpenAI call failed, falling back to MA:",
      err?.message || err,
    );
    return null;
  }

  if (!content) return null;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error(
      "[strkGptStrategy] Failed to parse GPT JSON, content was:",
      content,
    );
    return null;
  }

  const action = String(parsed.action || "").toUpperCase();
  if (!["BUY", "SELL", "HOLD"].includes(action)) {
    return null;
  }

  const confidence = Number(parsed.confidence ?? 0.5) || 0.5;
  const reason = String(parsed.reason || "no reason provided");

  return {
    action,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
  };
}

// ---------- Main exported strategy ----------

export async function strkGptStrategy(ctx) {
  const { priceData, latestPrice, position } = ctx;

  if (!latestPrice || latestPrice <= 0) {
    return [];
  }

  // 1) Build pseudo-candles for GPT
  const candles = buildPseudoCandles(priceData, latestPrice);

  // 2) Try GPT-driven decision first
  const gptDecision = await getGptDecision({
    candles,
    latestPrice,
    position,
  });

  const usdc = Number(position.usdc ?? 0);
  const strk = Number(position.strk ?? 0);
  const strkUsd = strk * latestPrice;
  const baseSizeUsd = 50;

  if (gptDecision) {
    const { action, confidence, reason } = gptDecision;

    if (action === "HOLD") {
      return [];
    }

    if (action === "BUY" && usdc >= 10) {
      const sizeUsd = Math.min(usdc, baseSizeUsd * (0.5 + confidence));
      return [
        {
          strategy: "gpt-swing",
          side: "BUY",
          sizeUsd,
          confidence,
          reason,
        },
      ];
    }

    if (action === "SELL" && strkUsd >= 10) {
      const sizeUsd = Math.min(strkUsd, baseSizeUsd * (0.5 + confidence));
      return [
        {
          strategy: "gpt-swing",
          side: "SELL",
          sizeUsd,
          confidence,
          reason,
        },
      ];
    }

    // If GPT says BUY/SELL but we can't (no balance), fall through to MA fallback.
  }

  // 3) Fallback: MA-based swing logic (no GPT / invalid response)
  return maFallbackIntent(priceData, latestPrice, position);
}
