import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateOpenaiCost, MAX_JD_LENGTH, MAX_REQUIREMENTS, MAX_RESUME_LENGTH, type Requirement, validatedQuote } from "@/lib/resume-evaluation";

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
  const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
  const resume = typeof body.resume === "string" ? body.resume.trim() : "";
  if (jobDescription.length < 20 || jobDescription.length > MAX_JD_LENGTH || resume.length < 20 || resume.length > MAX_RESUME_LENGTH) {
    return NextResponse.json({ error: `Enter a JD (20–${MAX_JD_LENGTH} characters) and resume (20–${MAX_RESUME_LENGTH} characters).` }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is missing from .env.local." }, { status: 500 });
  const model = process.env.OPENAI_MODEL || "gpt-5.6-Luna";
  const started = performance.now();
  try {
    const response = await new OpenAI().responses.parse({
      model,
      store: false,
      instructions: `Extract distinct, assessable job requirements from the JD only. Do not use the resume to infer requirements. Return at most ${MAX_REQUIREMENTS} requirements in JD order. Include the exact verbatim JD source quote supporting each one. Mandatory only when the JD explicitly requires it; preferred only when explicitly preferred; otherwise unspecified. Choose noul for binary presence/experience, score for graded depth, and choice ONLY when the JD asks for one primary category among mutually exclusive alternatives. For choice, provide 2–6 short distinct choiceOptions and one targetOption that exactly matches an option; use the options named in the JD where possible. For non-choice requirements, return choiceOptions [] and targetOption "". Write specific, observable criteria. Ignore demographic/protected traits and do not make a hiring decision.`,
      input: `JOB DESCRIPTION:\n${jobDescription}`,
      text: { format: zodTextFormat(extractedSchema, "resume_requirements") },
    });
    const parsed = response.output_parsed;
    if (!parsed) throw new Error("No parsed extraction");
    const requirements: Requirement[] = parsed.requirements.slice(0, MAX_REQUIREMENTS).flatMap((item, index) => {
      const quote = validatedQuote(jobDescription, item.jdSourceQuote);
      const choiceOptions = item.choiceOptions.map((option) => option.trim()).filter(Boolean);
      if (!quote || !item.requirement.trim() || !item.criteria.trim()) return [];
      if (item.evaluationType === "choice" && (choiceOptions.length < 2 || choiceOptions.length > 6 || !choiceOptions.includes(item.targetOption.trim()))) return [];
      return [{
        id: `r${index + 1}`,
        requirement: item.requirement.trim().slice(0, 500),
        description: item.description.trim().slice(0, 800),
        jdSourceQuote: quote,
        importance: item.importance,
        evaluationType: item.evaluationType,
        criteria: item.criteria.trim().slice(0, 800),
        choiceOptions: item.evaluationType === "choice" ? choiceOptions.map((option) => option.slice(0, 80)) : [],
        targetOption: item.evaluationType === "choice" ? item.targetOption.trim().slice(0, 80) : "",
      }];
    });
    if (!requirements.length) return NextResponse.json({ error: "Could not extract JD requirements with exact source quotes. Please revise the JD and retry." }, { status: 422 });
    return NextResponse.json({
      requirements,
      provider: "OpenAI",
      model,
      omittedUnverifiable: parsed.requirements.length - requirements.length,
      metrics: { latencyMs: Math.round(performance.now() - started), calls: 1, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, estimatedCostUsd: estimateOpenaiCost(model, response.usage?.input_tokens, response.usage?.input_tokens_details?.cached_tokens, response.usage?.output_tokens) },
    });
  } catch (error) {
    console.error("Resume requirement extraction failed", error instanceof Error ? { name: error.name, message: error.message } : "UnknownError");
    return NextResponse.json({ error: "Requirement extraction failed. Check the OpenAI configuration and try again." }, { status: 502 });
  }
}
