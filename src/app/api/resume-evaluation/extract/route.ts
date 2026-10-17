import OpenAI from "openai";
import { EVALUATION_TIMEOUT_MS } from "@/lib/providers";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateOpenaiCost, MAX_JD_LENGTH, MAX_REQUIREMENTS, MAX_RESUME_LENGTH, normalizeExtractedRequirement } from "@/lib/resume-evaluation";

export const runtime = "nodejs";

const extractedSchema = z.object({
  requirements: z.array(z.object({
    requirement: z.string(),
    description: z.string(),
    jdSourceQuote: z.string(),
    importance: z.enum(["mandatory", "preferred", "unspecified"]),
    evaluationType: z.enum(["noul", "score", "choice"]),
    criteria: z.string(),
    choiceOptions: z.array(z.string()),
    targetOption: z.string(),
  })),
});

export async function POST(request: Request) {
  let body: { jobDescription?: unknown; resume?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Enter a valid JSON request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
  const resume = typeof body.resume === "string" ? body.resume.trim() : "";
  if (jobDescription.length < 20 || jobDescription.length > MAX_JD_LENGTH || resume.length < 20 || resume.length > MAX_RESUME_LENGTH) {
    return NextResponse.json({ error: `Enter a JD (20–${MAX_JD_LENGTH} characters) and resume (20–${MAX_RESUME_LENGTH} characters).` }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is missing from .env.local." }, { status: 500 });
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const started = performance.now();
  try {
    const response = await new OpenAI({ timeout: EVALUATION_TIMEOUT_MS, maxRetries: 0 }).responses.parse({
      model,
      store: false,
      service_tier: "default",
      instructions: `Extract distinct, assessable job requirements from the JD only. Do not use the resume to infer requirements. Return at most ${MAX_REQUIREMENTS} requirements in JD order. Include the exact verbatim JD source quote supporting each one. Mandatory only when the JD explicitly requires it; preferred only when explicitly preferred; otherwise unspecified. Choose noul for binary presence/experience, score for graded depth, and choice ONLY when the JD asks for one primary category among mutually exclusive alternatives. For choice, provide 2–6 short distinct choiceOptions and one targetOption that exactly matches an option; use the options named in the JD where possible. For non-choice requirements, return choiceOptions [] and targetOption "". Write specific, observable criteria. Ignore demographic/protected traits and do not make a hiring decision.`,
      input: `JOB DESCRIPTION:\n${jobDescription}`,
      text: { format: zodTextFormat(extractedSchema, "resume_requirements") },
    });
    const parsed = response.output_parsed;
    if (!parsed) throw new Error("No parsed extraction");
    const requirements = parsed.requirements.slice(0, MAX_REQUIREMENTS).flatMap((item, index) => {
      const requirement = normalizeExtractedRequirement(jobDescription, item, `r${index + 1}`);
      return requirement ? [requirement] : [];
    });
    if (!requirements.length) return NextResponse.json({ error: "Could not extract JD requirements with exact source quotes. Please revise the JD and retry." }, { status: 422 });
    return NextResponse.json({
      requirements,
      provider: "OpenAI",
      model: response.model,
      omittedUnverifiable: parsed.requirements.length - requirements.length,
      metrics: { latencyMs: Math.round(performance.now() - started), calls: 1, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null, cacheWriteTokens: response.usage?.input_tokens_details?.cache_write_tokens ?? null, reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null, serviceTier: response.service_tier ?? "default", estimatedCostUsd: estimateOpenaiCost(response.model, response.usage?.input_tokens, response.usage?.input_tokens_details?.cached_tokens, response.usage?.output_tokens, response.usage?.input_tokens_details?.cache_write_tokens, response.service_tier ?? "default") },
    });
  } catch (error) {
    console.error("Resume requirement extraction failed", error instanceof Error ? { name: error.name, message: error.message } : "UnknownError");
    return NextResponse.json({ error: "Requirement extraction failed. Check the OpenAI configuration and try again." }, { status: 502 });
  }
}
