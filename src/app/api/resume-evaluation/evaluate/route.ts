import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { choice, noul, score, TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { aggregate, estimateOpenaiCost, evaluationRequestSchema, evidenceCandidates, type Evaluation, type Metrics, type Requirement, validatedQuote, validateRequirements } from "@/lib/resume-evaluation";

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

type Branch = { status: "success"; evaluations: Evaluation[]; summary: ReturnType<typeof aggregate>; metrics: Metrics; overview?: string } | { status: "error"; error: string };

function providerError(error: unknown, name: string): string {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  if (status === 401) return `${name} authentication failed.`;
  if (status === 429) return `${name} rate limit reached.`;
  return `${name} evaluation failed. Check its server configuration and retry.`;
}

async function runJev(jobDescription: string, resume: string, requirements: Requirement[]): Promise<Branch> {
  const started = performance.now();
  try {
    const questions: Questions = {};
    const candidateMap = new Map<string, string[]>();
    for (const requirement of requirements) {
      const instruction = `Evaluate ONLY this job requirement against the resume. Requirement: ${requirement.requirement}. Criteria: ${requirement.criteria}. Do not infer qualifications from protected traits. Missing information is uncertainty, not proof of absence.`;
      if (requirement.evaluationType === "noul") {
        questions[`assessment_${requirement.id}`] = noul(`${instruction} Does the resume provide explicit evidence that the criterion is met?`, { true: "Explicit resume evidence satisfies the criterion", false: "No explicit resume evidence satisfies the criterion" });
      } else if (requirement.evaluationType === "score") {
        questions[`assessment_${requirement.id}`] = score(`${instruction} Rate the documented depth of evidence.`, ["No documented evidence", "Limited or indirect evidence", "Explicit evidence meets the criterion", "Explicit evidence exceeds the criterion"]);
      } else {
        const options: Record<string, string> = { none: "The resume does not document one primary category" };
        requirement.choiceOptions.forEach((option, index) => { options[`o${index + 1}`] = option; });
        questions[`assessment_${requirement.id}`] = choice(`${instruction} Which ONE category is the candidate's primary documented category? Choose none if the resume does not establish a primary category.`, options);
      }
      const candidates = evidenceCandidates(resume, requirement);
      candidateMap.set(requirement.id, candidates);
      if (candidates.length) {
        const options: Record<string, string> = { none: "No candidate excerpt directly supports this requirement" };
        candidates.forEach((excerpt, index) => { options[`e${index + 1}`] = excerpt; });
        questions[`evidence_${requirement.id}`] = choice(requirement.evaluationType === "choice"
          ? `Which exact resume excerpt best documents the candidate's primary category for ${requirement.requirement}? Select none if no excerpt documents a primary category.`
          : `Which exact resume excerpt best supports this requirement: ${requirement.requirement}? Select none if none directly supports it.`, options);
      }
    }
    const response = await new TypeSafeClient().systemOne({
      state: { jobDescription, resume },
      questions,
    });
    const evaluations: Evaluation[] = requirements.map((requirement) => {
      const answer = response.answers[`assessment_${requirement.id}`];
      const evidence = response.answers[`evidence_${requirement.id}`];
      const candidates = candidateMap.get(requirement.id) ?? [];
      const chosen = evidence?.type === "choice" && /^e\d+$/.test(evidence.choice)
        ? candidates[Number(evidence.choice.slice(1)) - 1]
        : null;
      const evidenceQuote = validatedQuote(resume, chosen);
      let status: Evaluation["status"] = "uncertain";
      let probability: number | undefined;
      let scoreValue: number | undefined;
      let scoreConfidence: number | undefined;
      let selectedOption: string | undefined;
      let choiceConfidence: number | undefined;
      let choiceProbabilities: Record<string, number> | undefined;
      if (answer?.type === "noul") {
        probability = answer.noul;
        if (probability >= 0.8 && evidenceQuote) status = "supported";
        else if (probability <= 0.2) status = "not supported";
      } else if (answer?.type === "score") {
        scoreValue = answer.score;
        scoreConfidence = answer.confidence;
        if (scoreConfidence >= 0.55) {
          if (scoreValue >= 1.75 && evidenceQuote) status = "supported";
          else if (scoreValue >= 0.75 && evidenceQuote) status = "partial";
          else if (scoreValue < 0.75) status = "not supported";
        }
      } else if (answer?.type === "choice") {
        selectedOption = /^o\d+$/.test(answer.choice) ? requirement.choiceOptions[Number(answer.choice.slice(1)) - 1] : undefined;
        choiceConfidence = answer.confidence;
        choiceProbabilities = Object.fromEntries(Object.entries(answer.probabilities).map(([key, value]) => [key === "none" ? "No documented primary category" : requirement.choiceOptions[Number(key.slice(1)) - 1] ?? key, value]));
        if (choiceConfidence >= 0.55) {
          if (selectedOption === requirement.targetOption && evidenceQuote) status = "supported";
          else if (selectedOption && selectedOption !== requirement.targetOption) status = "not supported";
        }
      }
      return { id: requirement.id, status, evidenceQuote, evidenceConfidence: evidence?.type === "choice" ? evidence.confidence : undefined, probability, score: scoreValue, scoreConfidence, selectedOption, choiceConfidence, choiceProbabilities };
    });
    return { status: "success", evaluations, summary: aggregate(requirements, evaluations), metrics: { latencyMs: Math.round(performance.now() - started), calls: 1, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, estimatedCostUsd: response.usage.input_tokens * 0.042 / 1_000_000 } };
  } catch (error) {
    console.error("JEV resume evaluation failed", error instanceof Error ? error.name : "UnknownError");
    return { status: "error", error: providerError(error, "JEV") };
  }
}

async function runOpenAI(jobDescription: string, resume: string, requirements: Requirement[]): Promise<Branch> {
  const started = performance.now();
  try {
    const response = await new OpenAI().responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-5.6-Luna",
      store: false,
      instructions: "Evaluate each supplied job requirement against the resume. Return exactly one result for every supplied ID. Use only explicit resume evidence, with an exact verbatim quote or null. Supported means clear evidence meets the criterion; partial means some evidence but incomplete depth; not supported means no documented evidence; uncertain means ambiguous or insufficient information. Do not infer protected traits or give a hiring/rejection recommendation. Give a concise qualitative overview. The application computes all aggregate scores.",
      input: JSON.stringify({ jobDescription, resume, requirements }),
      text: { format: zodTextFormat(llmSchema, "resume_evaluation") },
    });
    if (!response.output_parsed) throw new Error("No parsed evaluation");
    const byId = new Map(response.output_parsed.evaluations.map((item) => [item.id, item]));
    const evaluations: Evaluation[] = requirements.map((requirement) => {
      const item = byId.get(requirement.id);
      if (!item) return { id: requirement.id, status: "uncertain", evidenceQuote: null, explanation: "No result returned for this requirement." };
      const evidenceQuote = validatedQuote(resume, item.evidenceQuote);
      const status = (item.status === "supported" || item.status === "partial") && !evidenceQuote ? "uncertain" : item.status;
      return { id: requirement.id, status, evidenceQuote, explanation: evidenceQuote || !item.evidenceQuote ? item.explanation : "The cited quote was not found in the resume; result marked uncertain." };
    });
    return { status: "success", evaluations, summary: aggregate(requirements, evaluations), overview: response.output_parsed.overview, metrics: { latencyMs: Math.round(performance.now() - started), calls: 1, inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null, estimatedCostUsd: estimateOpenaiCost(process.env.OPENAI_MODEL || "gpt-5.6-Luna", response.usage?.input_tokens, response.usage?.input_tokens_details?.cached_tokens, response.usage?.output_tokens) } };
  } catch (error) {
    console.error("OpenAI resume evaluation failed", error instanceof Error ? error.name : "UnknownError");
    return { status: "error", error: providerError(error, "OpenAI") };
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Enter a valid JSON request." }, { status: 400 }); }
  const parsed = evaluationRequestSchema.extend({ provider: z.enum(["jev", "openai"]) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid JD, resume, or requirements. Check lengths and required fields." }, { status: 400 });
  const { jobDescription, resume, requirements, provider } = parsed.data;
  const invalid = validateRequirements(jobDescription, requirements);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (provider === "jev" && !process.env.TYPESAFE_API_KEY) return NextResponse.json({ error: "TYPESAFE_API_KEY is missing from .env.local." }, { status: 500 });
  if (provider === "openai" && !process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is missing from .env.local." }, { status: 500 });
  const result = provider === "jev"
    ? await runJev(jobDescription, resume, requirements)
    : await runOpenAI(jobDescription, resume, requirements);
  return NextResponse.json({ provider, result, model: process.env.OPENAI_MODEL || "gpt-5.6-Luna" });
}
