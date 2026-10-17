import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { z } from "zod";
import { EVALUATION_TIMEOUT_MS, DEFAULT_JEV_MODEL, MICROSOFT_MODEL, type DecisionProvider } from "./providers.ts";

export type DecisionRequest = { state: Record<string, string>; questions: Questions };
const probability = z.number().finite().min(0).max(1);
const distribution = z.record(z.string(), probability);
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: probability, probabilities: distribution }),
  z.object({ type: z.literal("score"), score: z.number().finite().min(0), confidence: probability, probabilities: distribution }),
]);
const responseSchema = z.object({
  model: z.string().min(1).optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cost: z.number().finite().nonnegative().optional(),
  }).optional(),
});
export type DecisionAnswers = Record<string, z.infer<typeof answerSchema>>;

export function validateDecisionResponse(raw: unknown, questions: Questions) {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid decision response");
  const response = parsed.data;
  for (const [id, question] of Object.entries(questions)) {
    const answer = response.answers[id];
    if (!answer || answer.type !== question.type) throw new Error("Invalid decision response");
    if (answer.type === "noul") continue;
    const keys = Object.keys(answer.probabilities);
    const expected = question.type === "score"
      ? question.criteria.map((_, index) => String(index))
      : Object.keys(question.criteria ?? {});
    const sum = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
    if (keys.length !== expected.length || expected.some((key) => !keys.includes(key)) || Math.abs(sum - 1) > 0.01) throw new Error("Invalid decision response");
    if (answer.type === "choice" && (!expected.includes(answer.choice) || answer.probabilities[answer.choice] + 0.00001 < Math.max(...Object.values(answer.probabilities)))) throw new Error("Invalid decision response");
    if (answer.type === "score" && answer.score > expected.length - 1) throw new Error("Invalid decision response");
    if (answer.type === "score") {
      const expectedScore = Object.entries(answer.probabilities).reduce((total, [level, p]) => total + Number(level) * p, 0);
      // Jev reports rounded distributions and scores; allow their rounding error.
      if (Math.abs(answer.score - expectedScore) > 0.03) throw new Error("Invalid decision response");
    }
  }
  return response;
}

export function decisionCost(usage?: { input_tokens?: number; cost?: number }) {
  return usage?.cost ?? (usage?.input_tokens == null ? undefined : usage.input_tokens * 0.042 / 1_000_000);
}

export function providerError(error: unknown, name: string): string {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  const message = error instanceof Error ? error.message : "";
  const missingKey = message.match(/\b(TYPESAFE_API_KEY|OPENROUTER_API_KEY|OPENAI_API_KEY)\b/);
  if (missingKey && /missing|credentials/i.test(message)) return `${missingKey[1]} is missing from .env.local.`;
  if (status === 401 || status === 403) return `${name} authentication failed. Check its server API key.`;
  if (status === 429) return `${name} rate limit reached. Try again shortly.`;
  if (/context|token.limit|too many tokens|maximum.*tokens/i.test(message)) return `${name} input exceeds the model context limit${name.startsWith("Microsoft") ? " (32,768 tokens)" : ""}. Shorten the input; no evidence was truncated.`;
  if (/timeout|timed out|abort/i.test(message) || (error instanceof Error && /Timeout|Abort/.test(error.name))) return `${name} request timed out after 60 seconds.`;
  if (/Invalid decision response/.test(message)) return `${name} returned an invalid or incomplete decision response.`;
  return `${name} request failed. Check the server configuration and try again.`;
}

export async function runDecisionProvider(provider: DecisionProvider, request: DecisionRequest) {
  let raw: unknown;
  if (provider === "jev") {
    if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY missing");
    raw = await new TypeSafeClient({ defaultModel: process.env.JEV_MODEL || DEFAULT_JEV_MODEL, timeout: EVALUATION_TIMEOUT_MS, retry: { maxRetries: 0 } }).systemOne(request);
  } else {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, model: MICROSOFT_MODEL }),
      signal: AbortSignal.timeout(EVALUATION_TIMEOUT_MS),
    });
    // Read the body within the timeout; upstream details are never returned to the browser.
    const body = await response.text();
    if (!response.ok) throw Object.assign(new Error(body), { status: response.status });
    try { raw = JSON.parse(body); } catch { throw new Error("Invalid decision response"); }
  }
  return validateDecisionResponse(raw, request.questions);
}
