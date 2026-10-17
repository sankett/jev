import { z } from "zod";

export const MAX_JD_LENGTH = 12000;
export const MAX_RESUME_LENGTH = 20000;
export const MAX_REQUIREMENTS = 15;

export const requirementSchema = z.object({
  id: z.string().regex(/^r\d+$/),
  requirement: z.string().trim().min(3).max(500),
  description: z.string().trim().max(800),
  jdSourceQuote: z.string().trim().min(3).max(1000),
  importance: z.enum(["mandatory", "preferred", "unspecified"]),
  evaluationType: z.enum(["noul", "score", "choice"]),
  criteria: z.string().trim().min(3).max(800),
  choiceOptions: z.array(z.string().trim().min(2).max(80)).max(6),
  targetOption: z.string().trim().max(80),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Status = "supported" | "partial" | "not supported" | "uncertain";
export type Evaluation = {
  id: string;
  status: Status;
  evidenceQuote: string | null;
  evidenceConfidence?: number;
  probability?: number;
  score?: number;
  scoreConfidence?: number;
  selectedOption?: string;
  choiceConfidence?: number;
  choiceProbabilities?: Record<string, number>;
  explanation?: string;
};
export type Metrics = {
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  serviceTier?: string | null;
  costSource?: "reported" | "estimated";
  latencyMs: number;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd?: number;
};

export { estimateOpenaiCost } from "./pricing.ts";

export const evaluationRequestSchema = z.object({
  jobDescription: z.string().trim().min(20).max(MAX_JD_LENGTH),
  resume: z.string().trim().min(20).max(MAX_RESUME_LENGTH),
  requirements: z.array(requirementSchema).min(1).max(MAX_REQUIREMENTS),
});

export function validateRequirements(jobDescription: string, requirements: Requirement[]): string | null {
  if (new Set(requirements.map((item) => item.id)).size !== requirements.length) return "Requirement IDs must be unique.";
  for (const item of requirements) {
    if (!jobDescription.includes(item.jdSourceQuote)) return `JD quote for ${item.id} was not found in the job description.`;
    if (item.importance === "unspecified") return `Set the importance of ${item.id} before evaluating.`;
    if (item.evaluationType === "choice") {
      if (item.choiceOptions.length < 2 || new Set(item.choiceOptions.map((option) => option.toLowerCase())).size !== item.choiceOptions.length || !item.choiceOptions.includes(item.targetOption)) {
        return `Set at least two distinct Choice options and a matching target for ${item.id}.`;
      }
    }
  }
  return null;
}

export function validatedQuote(source: string, quote: string | null | undefined): string | null {
  const trimmed = quote?.trim();
  return trimmed && source.includes(trimmed) ? trimmed : null;
}

export type OpenaiResumeItem = { id: string; status: Status; evidenceQuote: string | null; explanation: string };
export function mapOpenaiResumeEvaluations(resume: string, requirements: Requirement[], items: OpenaiResumeItem[]): Evaluation[] {
  const expected = new Set(requirements.map((requirement) => requirement.id));
  const ids = new Set(items.map((item) => item.id));
  if (items.length !== expected.size || ids.size !== items.length || items.some((item) => !expected.has(item.id))) {
    throw new Error("Invalid OpenAI evaluation response: every requirement must appear exactly once");
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  return requirements.map((requirement) => {
    const item = byId.get(requirement.id)!;
    const evidenceQuote = validatedQuote(resume, item.evidenceQuote);
    const status = (item.status === "supported" || item.status === "partial") && !evidenceQuote ? "uncertain" : item.status;
    return { id: requirement.id, status, evidenceQuote, explanation: evidenceQuote || !item.evidenceQuote ? item.explanation : "The cited quote was not found in the resume; result marked uncertain." };
  });
}

// Apply the same limits to extracted requirements that evaluation will enforce.
export function normalizeExtractedRequirement(
  jobDescription: string,
  item: Omit<Requirement, "id">,
  id: string,
): Requirement | null {
  const quote = validatedQuote(jobDescription, item.jdSourceQuote);
  if (!quote) return null;
  const parsed = requirementSchema.safeParse({
    ...item,
    id,
    jdSourceQuote: quote,
    choiceOptions: item.evaluationType === "choice" ? item.choiceOptions : [],
    targetOption: item.evaluationType === "choice" ? item.targetOption : "",
  });
  if (!parsed.success) return null;
  const requirement = parsed.data;
  if (requirement.evaluationType === "choice" && (
    requirement.choiceOptions.length < 2 ||
    new Set(requirement.choiceOptions.map((option) => option.toLowerCase())).size !== requirement.choiceOptions.length ||
    !requirement.choiceOptions.includes(requirement.targetOption)
  )) return null;
  return requirement;
}

export function aggregate(requirements: Requirement[], evaluations: Evaluation[]) {
  const results = new Map(evaluations.map((item) => [item.id, item]));
  let lower = 0;
  let upper = 0;
  let total = 0;
  let missingMandatory = 0;
  let uncertain = 0;
  for (const requirement of requirements) {
    const weight = requirement.importance === "mandatory" ? 2 : 1;
    const status = results.get(requirement.id)?.status ?? "uncertain";
    const credit = status === "supported" ? 1 : status === "partial" ? 0.5 : 0;
    lower += weight * credit;
    upper += weight * (status === "uncertain" ? 1 : credit);
    total += weight;
    if (status === "uncertain") uncertain += 1;
    if (requirement.importance === "mandatory" && status === "not supported") missingMandatory += 1;
  }
  return {
    lowerPercent: total ? Math.round((lower / total) * 100) : 0,
    upperPercent: total ? Math.round((upper / total) * 100) : 0,
    missingMandatory,
    uncertain,
  };
}

export function evidenceCandidates(resume: string, requirement: Requirement): string[] {
  const words = new Set(`${requirement.requirement} ${requirement.criteria}`.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? []);
  const pieces = resume.split(/\n\s*\n|\n|(?<=[.!?])\s+(?=[A-Z])/).flatMap((part) => {
    // Preserve coverage of long paragraphs rather than discarding their tail.
    const chunks: string[] = [];
    for (let start = 0; start < part.length; start += 280) {
      const chunk = part.slice(start, start + 360).trim();
      if (chunk.length >= 15) chunks.push(chunk);
    }
    return chunks;
  });
  return pieces.map((part, index) => ({ part, index, relevance: (part.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? []).filter((word) => words.has(word)).length }))
    .filter(({ relevance }) => relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .slice(0, 7)
    .map(({ part }) => part);
}
