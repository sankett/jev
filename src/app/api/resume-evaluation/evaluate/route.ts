import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { decisionCost, providerError, runDecisionProvider } from "@/lib/decision-provider";
import { resumeRequest, mapResumeAnswers } from "@/lib/decision-tasks";
import { EVALUATION_TIMEOUT_MS, DEFAULT_JEV_MODEL, MICROSOFT_MODEL, PROVIDER_LABELS, TRANSPORTS, type DecisionProvider, type ProviderMetadata } from "@/lib/providers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { aggregate, estimateOpenaiCost, evaluationRequestSchema, type Evaluation, type Metrics, type Requirement, mapOpenaiResumeEvaluations, validateRequirements } from "@/lib/resume-evaluation";

export const runtime = "nodejs";

const llmSchema = z.object({
  evaluations: z.array(z.object({
    id: z.string(),
    status: z.enum(["supported", "partial", "not supported", "uncertain"]),
    evidenceQuote: z.string().nullable(),
    explanation: z.string(),
  })),
  overview: z.string(),
});

type Branch = ProviderMetadata & ({ status: "success"; evaluations: Evaluation[]; summary: ReturnType<typeof aggregate>; metrics: Metrics; overview?: string } | { status: "error"; error: string });

async function runDecision(jobDescription: string, resume: string, requirements: Requirement[], provider: DecisionProvider): Promise<Branch> {
  const started = performance.now();
  const metadata = { model: provider === "microsoft" ? MICROSOFT_MODEL : process.env.JEV_MODEL || DEFAULT_JEV_MODEL, transport: TRANSPORTS[provider] };
  try {
    const { request, candidateMap } = resumeRequest(jobDescription, resume, requirements);
    const response = await runDecisionProvider(provider, request);
    const evaluations = mapResumeAnswers(response.answers, resume, requirements, candidateMap);
    return { status: "success", ...metadata, model: response.model ?? metadata.model,
      evaluations, summary: aggregate(requirements, evaluations),
      metrics: { latencyMs: Math.round(performance.now() - started), calls: 1,
        inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null,
        estimatedCostUsd: decisionCost(response.usage), costSource: response.usage?.cost == null ? "estimated" : "reported" } };
  } catch (error) {
    console.error(PROVIDER_LABELS[provider] + " resume evaluation failed", error instanceof Error ? error.name : "UnknownError");
    return { status: "error", ...metadata, error: providerError(error, PROVIDER_LABELS[provider]) };
  }
}

async function runOpenAI(jobDescription: string, resume: string, requirements: Requirement[]): Promise<Branch> {
  const started = performance.now();
  try {
    const response = await new OpenAI({ timeout: EVALUATION_TIMEOUT_MS, maxRetries: 0 }).responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      store: false,
      service_tier: "default",
      instructions: "Evaluate each supplied job requirement against the resume. Return exactly one result for every supplied ID. Use only explicit resume evidence, with an exact verbatim quote or null. Supported means clear evidence meets the criterion; partial means some evidence but incomplete depth; not supported means no documented evidence; uncertain means ambiguous or insufficient information. Do not infer protected traits or give a hiring/rejection recommendation. Give a concise qualitative overview. For Choice requirements, supported means the documented primary category matches targetOption; a different documented category is not supported, and no established primary category is uncertain. For Score requirements, use the ordered rubric: no documented evidence, limited or indirect evidence, explicit evidence meets the criterion, explicit evidence exceeds the criterion. Noul asks whether explicit evidence meets the criterion. The application computes all aggregate scores.",
      input: JSON.stringify({ jobDescription, resume, requirements }),
      text: { format: zodTextFormat(llmSchema, "resume_evaluation") },
    });
    if (!response.output_parsed) throw new Error("No parsed evaluation");
    const evaluations = mapOpenaiResumeEvaluations(resume, requirements, response.output_parsed.evaluations);
    return { status: "success", model: response.model, transport: TRANSPORTS.openai, evaluations, summary: aggregate(requirements, evaluations), overview: response.output_parsed.overview, metrics: { latencyMs: Math.round(performance.now() - started), calls: 1, costSource: "estimated", inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null, cacheWriteTokens: response.usage?.input_tokens_details?.cache_write_tokens ?? null, reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null, serviceTier: response.service_tier ?? "default", estimatedCostUsd: estimateOpenaiCost(response.model, response.usage?.input_tokens, response.usage?.input_tokens_details?.cached_tokens, response.usage?.output_tokens, response.usage?.input_tokens_details?.cache_write_tokens, response.service_tier ?? "default") } };
  } catch (error) {
    console.error("OpenAI resume evaluation failed", error instanceof Error ? error.name : "UnknownError");
    return { status: "error", model: process.env.OPENAI_MODEL || "gpt-5.6-luna", transport: TRANSPORTS.openai, error: providerError(error, "OpenAI") };
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Enter a valid JSON request." }, { status: 400 }); }
  const parsed = evaluationRequestSchema.extend({ provider: z.enum(["jev", "openai", "microsoft"]) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid JD, resume, or requirements. Check lengths and required fields." }, { status: 400 });
  const { jobDescription, resume, requirements, provider } = parsed.data;
  const invalid = validateRequirements(jobDescription, requirements);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const result = provider === "openai"
    ? await runOpenAI(jobDescription, resume, requirements)
    : await runDecision(jobDescription, resume, requirements, provider);
  return NextResponse.json({ provider, result, model: process.env.OPENAI_MODEL || "gpt-5.6-luna" });
}
