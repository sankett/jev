import OpenAI from "openai";
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { NextResponse } from "next/server";
import {
  compareDecisions,
  type BranchResult,
  type Category,
  type NormalizedDecision,
  routeDecision,
  summarizeTrials,
  type Trial,
} from "@/lib/comparison";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MODEL = "gpt-5.6-Luna";
const JEV_INPUT_PRICE_PER_MILLION = 0.042;
const OPENAI_TOKEN_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

function estimateOpenaiCost(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = OPENAI_TOKEN_PRICING[model.toLowerCase()];
  if (!pricing) return undefined;

  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return (
    uncachedInputTokens * pricing.input +
    cachedInputTokens * pricing.cachedInput +
    outputTokens * pricing.output
  ) / 1_000_000;
}

type RequestBody = {
  message?: unknown;
  runs?: unknown;
};

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

function safeProviderError(error: unknown, provider: string): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;

  if (status === 401) return `${provider} authentication failed.`;
  if (status === 429) return `${provider} rate limit reached. Try again shortly.`;
  return `${provider} request failed. Check the server configuration and try again.`;
}

function providerStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
}

function logProviderError(provider: string, error: unknown) {
  console.error(`${provider} comparison branch failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
    status: providerStatus(error),
  });
}

function parseOpenaiDecision(text: string): NormalizedDecision | undefined {
  const category = text.match(/\bcategory\s*:\s*(billing|technical|cancellation|general)\b/i)?.[1]?.toLowerCase();
  const urgency = text.match(/\burgency\s*:\s*([0-3])\b/i)?.[1];
  const needsHuman = text.match(/\bhuman\s+review\s*:\s*(yes|no)\b/i)?.[1]?.toLowerCase();

  if (!category || urgency === undefined || !needsHuman) return undefined;

  return {
    category: category as Category,
    urgency: Number(urgency),
    needsHuman: needsHuman === "yes",
  };
}

async function runJev(message: string): Promise<BranchResult> {
  const totalStart = performance.now();
  const jevStart = performance.now();

  try {
    const jevClient = new TypeSafeClient();
    const jevRequest = {
      state: { supportTicket: message },
      questions: {
        category: choice("Which support category best matches this ticket?", {
          billing: "Payments, invoices, charges, or refunds",
          technical: "A product defect, error, outage, or access problem",
          cancellation: "A request to cancel or close an account",
          general: "Anything that does not fit the other categories",
        }),
        urgency: score("How urgent is this support ticket?", [
          "Low: informational or no time pressure",
          "Normal: should be handled in the usual support queue",
          "High: materially affecting the customer and needs prompt attention",
          "Critical: severe impact, security risk, or immediate deadline",
        ]),
        needsHuman: noul("Does this ticket need a human support agent?", {
          true: "A person should review or act on this ticket",
          false: "The ticket can be handled safely by an automated workflow",
        }),
      },
    };
    const jev = await jevClient.systemOne(jevRequest);

    const jevMs = elapsed(jevStart);
    const urgencyRaw = jev.answers.urgency.score;
    const decision: NormalizedDecision = {
      category: jev.answers.category.choice as Category,
      urgency: urgencyRaw,
      needsHuman: jev.answers.needsHuman.noul >= 0.5,
    };
    const action = routeDecision(decision);
    return {
      status: "success",
      decision,
      jevEvidence: {
        categoryConfidence: jev.answers.category.confidence,
        categoryProbabilities: jev.answers.category.probabilities,
        urgencyRaw,
        urgencyConfidence: jev.answers.urgency.confidence,
        urgencyProbabilities: jev.answers.urgency.probabilities,
        needsHumanProbability: jev.answers.needsHuman.noul,
      },
      action,
      inputPrompt: JSON.stringify(jevRequest, null, 2),
      outputResponse: JSON.stringify(jev.answers, null, 2),
      timing: {
        jevMs,
        totalMs: elapsed(totalStart),
      },
      usage: {
        jevInputTokens: jev.usage.input_tokens,
        jevOutputTokens: jev.usage.output_tokens,
      },
      estimatedCostUsd: (jev.usage.input_tokens * JEV_INPUT_PRICE_PER_MILLION) / 1_000_000,
      costPricingLabel: "$0.042 per 1M input tokens; output free",
    };
  } catch (error) {
    logProviderError("JEV", error);
    return { status: "error", error: safeProviderError(error, "JEV") };
  }
}

async function runOpenai(message: string, model: string): Promise<BranchResult> {
  const totalStart = performance.now();

  try {
    const openai = new OpenAI();
    const instructions =
      "You are a support-ticket classifier. Respond in natural language with a concise explanation. Include these three explicit labels on their own lines so the decision can be compared: Category: <billing|technical|cancellation|general>; Urgency: <0|1|2|3>; Human review: <Yes|No>. Then briefly explain your classification.\n\nCategories: billing = payments, invoices, charges, or refunds; technical = product defect, error, outage, or access problem; cancellation = cancel or close an account; general = anything else.\nUrgency: 0 low, 1 normal, 2 high, 3 critical.";
    const response = await openai.responses.create({
      model,
      store: false,
      instructions,
      input: message,
    });

    const outputResponse = response.output_text;
    const decision = parseOpenaiDecision(outputResponse);
    const inputTokens = response.usage?.input_tokens ?? 0;
    const cachedInputTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const estimatedCostUsd = estimateOpenaiCost(model, inputTokens, cachedInputTokens, outputTokens);
    const modelPricing = OPENAI_TOKEN_PRICING[model.toLowerCase()];
    const costPricingLabel = modelPricing
      ? `Input $${modelPricing.input}/1M, cached input $${modelPricing.cachedInput}/1M, output $${modelPricing.output}/1M`
      : undefined;
    if (!decision) {
      return {
        status: "error",
        error: "OpenAI's free-form response did not include all three decision labels, so agreement could not be calculated.",
        inputPrompt: `Instructions:\n${instructions}\n\nInput:\n${message}`,
        outputResponse,
        timing: { totalMs: elapsed(totalStart) },
        usage: {
          openaiInputTokens: inputTokens,
          openaiOutputTokens: outputTokens,
        },
        estimatedCostUsd,
        costPricingLabel,
      };
    }
    return {
      status: "success",
      decision,
      action: routeDecision(decision),
      inputPrompt: `Instructions:\n${instructions}\n\nInput:\n${message}`,
      outputResponse,
      timing: { totalMs: elapsed(totalStart) },
      usage: {
        openaiInputTokens: inputTokens,
        openaiOutputTokens: outputTokens,
      },
      estimatedCostUsd,
      costPricingLabel,
    };
  } catch (error) {
    logProviderError("OpenAI", error);
    return { status: "error", error: safeProviderError(error, "OpenAI") };
  }
}

async function runTrial(message: string, model: string): Promise<Trial> {
  const [jevResult, llmResult] = await Promise.all([
    runJev(message),
    runOpenai(message, model),
  ]);

  return {
    jev: jevResult,
    openai: llmResult,
    agreement:
      jevResult.status === "success" &&
      llmResult.status === "success" &&
      jevResult.decision &&
      llmResult.decision &&
      jevResult.action &&
      llmResult.action
        ? compareDecisions(
            jevResult.decision,
            jevResult.action,
            llmResult.decision,
            llmResult.action,
          )
        : undefined,
  };
}

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const runs = body.runs === 3 ? 3 : body.runs === 1 || body.runs === undefined ? 1 : null;

  if (!message) {
    return NextResponse.json({ error: "Enter a support message before comparing." }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `The support message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 400 });
  }

  if (!runs) {
    return NextResponse.json({ error: "runs must be either 1 or 3." }, { status: 400 });
  }

  if (!process.env.TYPESAFE_API_KEY) {
    return NextResponse.json({ error: "TYPESAFE_API_KEY is missing from .env.local." }, { status: 500 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is missing from .env.local." }, { status: 500 });
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const trials: Trial[] = [];

  for (let index = 0; index < runs; index += 1) {
    trials.push(await runTrial(message, model));
  }

  return NextResponse.json({
    model,
    requestedRuns: runs,
    trials,
    summary: summarizeTrials(trials),
  });
}
