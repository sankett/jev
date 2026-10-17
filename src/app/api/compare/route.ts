import OpenAI from "openai";
import { estimateOpenaiCost, openaiPricing } from "@/lib/pricing";
import { supportBaseline, parseOpenaiDecision, SUPPORT_PROTOCOL_VERSION } from "@/lib/support-baseline";
import { runBenchmark } from "@/lib/benchmark-runner";
import { decisionCost, providerError, runDecisionProvider } from "@/lib/decision-provider";
import { supportRequest, mapSupportAnswers } from "@/lib/decision-tasks";
import { EVALUATION_TIMEOUT_MS, DEFAULT_JEV_MODEL, MICROSOFT_MODEL, PROVIDERS, PROVIDER_LABELS, TRANSPORTS, type Provider, type DecisionProvider } from "@/lib/providers";
import { NextResponse } from "next/server";
import {
  type BranchResult,
  routeDecision,
  summarizeTrials,
} from "@/lib/comparison";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MODEL = "gpt-5.6-luna";

type RequestBody = {
  message?: unknown;
  runs?: unknown;
  provider?: unknown;
};

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
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

async function runDecision(message: string, provider: DecisionProvider): Promise<BranchResult> {
  const start = performance.now();
  const request = supportRequest(message);
  const metadata = { transport: TRANSPORTS[provider], model: provider === "microsoft" ? MICROSOFT_MODEL : process.env.JEV_MODEL || DEFAULT_JEV_MODEL };
  try {
    const response = await runDecisionProvider(provider, request);
    const { decision, evidence } = mapSupportAnswers(response.answers);
    return {
      status: "success", ...metadata, model: response.model ?? metadata.model,
      decision, evidence, ...(provider === "jev" ? { jevEvidence: evidence } : {}),
      action: routeDecision(decision), inputPrompt: JSON.stringify(request, null, 2),
      outputResponse: JSON.stringify(response.answers, null, 2),
      timing: { totalMs: elapsed(start), ...(provider === "jev" ? { jevMs: elapsed(start) } : {}) },
      usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null,
        ...(provider === "jev" ? { jevInputTokens: response.usage?.input_tokens, jevOutputTokens: response.usage?.output_tokens } : {}) },
      estimatedCostUsd: decisionCost(response.usage), costSource: response.usage?.cost == null ? "estimated" : "reported",
      costPricingLabel: "$0.042 per 1M input tokens; output free",
    };
  } catch (error) {
    logProviderError(PROVIDER_LABELS[provider], error);
    return { status: "error", ...metadata, error: providerError(error, PROVIDER_LABELS[provider]), timing: { totalMs: elapsed(start) } };
  }
}

async function runOpenai(message: string, model: string): Promise<BranchResult> {
  const totalStart = performance.now();

  try {
    const openai = new OpenAI({ timeout: EVALUATION_TIMEOUT_MS, maxRetries: 0 });
    const { instructions, input } = supportBaseline(message);
    const response = await openai.responses.create({
      model,
      store: false,
      instructions,
      input,
      service_tier: "default",
    });

    const outputResponse = response.output_text;
    const decision = parseOpenaiDecision(outputResponse);
    const inputTokens = response.usage?.input_tokens;
    const cachedInputTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens;
    const cacheWriteTokens = response.usage?.input_tokens_details?.cache_write_tokens ?? 0;
    const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens ?? null;
    const estimatedCostUsd = estimateOpenaiCost(response.model, inputTokens, cachedInputTokens, outputTokens, cacheWriteTokens, response.service_tier ?? "default");
    const modelPricing = openaiPricing(response.model);
    const costPricingLabel = modelPricing
      ? `Input $${modelPricing.input}/1M, cached input ${modelPricing.cachedInput}/1M, cache writes ${modelPricing.input * 1.25}/1M, output $${modelPricing.output}/1M`
      : undefined;
    if (!decision) {
      return {
        status: "error", model: response.model, serviceTier: response.service_tier ?? "default", transport: TRANSPORTS.openai, costSource: "estimated",
        error: "OpenAI's free-form response did not include all three decision labels, so agreement could not be calculated.",
        inputPrompt: `Instructions:\n${instructions}\n\nInput:\n${input}`,
        outputResponse,
        timing: { totalMs: elapsed(totalStart) },
        usage: {
          inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null,
          cachedInputTokens, cacheWriteTokens, reasoningTokens,
          openaiInputTokens: inputTokens,
          openaiOutputTokens: outputTokens,
        },
        estimatedCostUsd,
        costPricingLabel,
      };
    }
    return {
      status: "success", model: response.model, serviceTier: response.service_tier ?? "default", transport: TRANSPORTS.openai, costSource: "estimated",
      decision,
      action: routeDecision(decision),
      inputPrompt: `Instructions:\n${instructions}\n\nInput:\n${input}`,
      outputResponse,
      timing: { totalMs: elapsed(totalStart) },
      usage: {
        inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null,
          cachedInputTokens, cacheWriteTokens, reasoningTokens,
          openaiInputTokens: inputTokens,
        openaiOutputTokens: outputTokens,
      },
      estimatedCostUsd,
      costPricingLabel,
    };
  } catch (error) {
    logProviderError("OpenAI", error);
    return { status: "error", model, transport: TRANSPORTS.openai, error: providerError(error, "OpenAI"), timing: { totalMs: elapsed(totalStart) } };
  }
}

async function runProvider(message: string, model: string, provider: Provider) {
  return provider === "openai" ? runOpenai(message, model) : runDecision(message, provider);
}

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
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

  const provider = PROVIDERS.includes(body.provider as Provider) ? body.provider as Provider : null;
  if (body.provider !== undefined && (!provider || runs !== 1)) {
    return NextResponse.json({ error: "provider must be jev, openai, or microsoft with one run." }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  if (provider) {
    return NextResponse.json({ provider, model, branch: await runProvider(message, model, provider) });
  }

  const startedAt = new Date().toISOString();
  const trials = await runBenchmark(runs, (provider) => runProvider(message, model, provider));

  return NextResponse.json({
    model,
    requestedRuns: runs,
    benchmark: { protocolVersion: SUPPORT_PROTOCOL_VERSION, startedAt, measurement: "server branch wall-clock including network, SDK, and validation", warmupRuns: 0, launchPolicy: "concurrent providers, sequential trials, rotating launch order", retries: 0, timeoutMs: EVALUATION_TIMEOUT_MS },
    trials,
    summary: summarizeTrials(trials),
  });
}
