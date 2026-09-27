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
  latencyMs: number;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd?: number;
};

const OPENAI_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

export function estimateOpenaiCost(model: string, input: number | undefined, cached: number | undefined, output: number | undefined): number | undefined {
  const price = OPENAI_PRICING[model.toLowerCase()];
  if (!price || input == null || output == null) return undefined;
  const cachedInput = Math.min(input, cached ?? 0);
  return ((input - cachedInput) * price.input + cachedInput * price.cachedInput + output * price.output) / 1_000_000;
}

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
    lowerPercent: Math.round((lower / total) * 100),
    upperPercent: Math.round((upper / total) * 100),
    missingMandatory,
    uncertain,
  };
}

export function evidenceCandidates(resume: string, requirement: Requirement): string[] {
  const words = new Set(`${requirement.requirement} ${requirement.criteria}`.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? []);
  const pieces = resume.split(/\n\s*\n|\n|(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter((part) => part.length >= 15);
  return pieces.map((part, index) => ({ part: part.slice(0, 360), index, relevance: (part.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? []).filter((word) => words.has(word)).length }))
    .filter(({ relevance }) => relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .slice(0, 7)
    .map(({ part }) => part);
}
