import { PROVIDERS, type Provider, type ProviderMetadata } from "./providers.ts";
export const CATEGORIES = [
  "billing",
  "technical",
  "cancellation",
  "general",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type NormalizedDecision = {
  category: Category;
  urgency: number;
  needsHuman: boolean;
};

export type DecisionEvidence = {
  categoryConfidence: number;
  categoryProbabilities: Record<string, number>;
  urgencyRaw: number;
  urgencyConfidence: number;
  urgencyProbabilities: Record<string, number>;
  needsHumanProbability: number;
};

// Retained for existing API consumers.
export type JevEvidence = DecisionEvidence;

export type Timing = {
  totalMs: number;
  jevMs?: number;
};

export type Usage = {
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  jevInputTokens?: number;
  jevOutputTokens?: number;
  openaiInputTokens?: number;
  openaiOutputTokens?: number;
};

export type BranchResult = ProviderMetadata & {
  serviceTier?: string;
  evidence?: DecisionEvidence;
  costSource?: "reported" | "estimated";
  status: "success" | "error";
  decision?: NormalizedDecision;
  jevEvidence?: JevEvidence;
  action?: string;
  inputPrompt?: string;
  outputResponse?: string;
  estimatedCostUsd?: number;
  costPricingLabel?: string;
  timing?: Timing;
  usage?: Usage;
  error?: string;
};

export type Agreement = {
  category: boolean;
  urgency: boolean;
  needsHuman: boolean;
  action: boolean;
};

export type Trial = {
  executionOrder?: Provider[];
  jev: BranchResult;
  openai: BranchResult;
  microsoft?: BranchResult;
  pairwiseAgreement?: Partial<Record<Pair, Agreement>>;
  agreement?: Agreement;
};

export const PAIRS = ["jev-openai", "jev-microsoft", "openai-microsoft"] as const;
export type Pair = (typeof PAIRS)[number];
export const PAIR_PROVIDERS: Record<Pair, readonly [Provider, Provider]> = {
  "jev-openai": ["jev", "openai"], "jev-microsoft": ["jev", "microsoft"], "openai-microsoft": ["openai", "microsoft"],
};
export type ComparisonSummary = {
  latencyRangeMs: Record<Provider, { min: number; max: number } | null>;
  averageCostUsd: Record<Provider, number | null>;
  averageLatencyMs: Record<Provider, number | null>;
  medianLatencyMs: Record<Provider, number | null>;
  decisionStability: Record<Provider, number | null>;
  successCount: Record<Provider, number>;
  failureCount: Record<Provider, number>;
  totalCostUsd: Record<Provider, number | null>;
  pairwiseAgreement: Record<Pair, number | null>;
  crossApproachAgreement: number | null;
};

export function trialAgreements(trial: Trial): Partial<Record<Pair, Agreement>> {
  const result: Partial<Record<Pair, Agreement>> = {};
  for (const pair of PAIRS) {
    const [left, right] = PAIR_PROVIDERS[pair].map((provider) => trial[provider]);
    if (left?.status === "success" && right?.status === "success" && left.decision && right.decision && left.action && right.action) {
      result[pair] = compareDecisions(left.decision, left.action, right.decision, right.action);
    }
  }
  return result;
}

export function routeDecision(decision: NormalizedDecision): string {
  if (decision.urgency >= 2.5) {
    return `Route to the ${decision.category} team for priority human review.`;
  }

  if (decision.needsHuman) {
    return `Add to the ${decision.category} queue for human review.`;
  }

  return `Route to the automated ${decision.category} workflow.`;
}

export function compareDecisions(
  left: NormalizedDecision,
  leftAction: string,
  right: NormalizedDecision,
  rightAction: string,
): Agreement {
  return {
    category: left.category === right.category,
    urgency: Math.round(left.urgency) === Math.round(right.urgency),
    needsHuman: left.needsHuman === right.needsHuman,
    action: leftAction === rightAction,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stability(results: BranchResult[]): number | null {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (!result.decision) continue;
    const d = result.decision;
    const key = JSON.stringify([d.category, Math.round(d.urgency), d.needsHuman]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return total >= 2 ? Math.max(...counts.values()) / total : null;
}

export function summarizeTrials(trials: Trial[]): ComparisonSummary {
  const summary: ComparisonSummary = {
    latencyRangeMs: { jev: null, openai: null, microsoft: null },
    averageCostUsd: { jev: null, openai: null, microsoft: null },
    averageLatencyMs: { jev: null, openai: null, microsoft: null },
    medianLatencyMs: { jev: null, openai: null, microsoft: null },
    decisionStability: { jev: null, openai: null, microsoft: null },
    successCount: { jev: 0, openai: 0, microsoft: 0 },
    failureCount: { jev: 0, openai: 0, microsoft: 0 },
    totalCostUsd: { jev: null, openai: null, microsoft: null },
    pairwiseAgreement: { "jev-openai": null, "jev-microsoft": null, "openai-microsoft": null },
    crossApproachAgreement: null,
  };
  for (const provider of PROVIDERS) {
    const attempted = trials.flatMap((trial) => trial[provider] ? [trial[provider]!] : []);
    const successes = attempted.filter((branch) => branch.status === "success");
    const times = successes.flatMap((branch) => branch.timing ? [branch.timing.totalMs] : []);
    summary.successCount[provider] = successes.length;
    summary.failureCount[provider] = attempted.length - successes.length;
    summary.averageLatencyMs[provider] = times.length ? Math.round(average(times)) : null;
    summary.medianLatencyMs[provider] = times.length ? Math.round(median(times)) : null;
    summary.latencyRangeMs[provider] = times.length ? { min: Math.min(...times), max: Math.max(...times) } : null;
    summary.decisionStability[provider] = stability(successes);
    // Unknown costs must not appear as zero or as a complete subtotal.
    summary.totalCostUsd[provider] = attempted.length && attempted.every((branch) => branch.estimatedCostUsd != null)
      ? attempted.reduce((sum, branch) => sum + branch.estimatedCostUsd!, 0) : null;
    summary.averageCostUsd[provider] = summary.totalCostUsd[provider] == null ? null : summary.totalCostUsd[provider]! / attempted.length;
  }
  for (const pair of PAIRS) {
    const values = trials.flatMap((trial) => {
      const agreement = trialAgreements(trial)[pair];
      return agreement ? Object.values(agreement) : [];
    });
    summary.pairwiseAgreement[pair] = values.length ? values.filter(Boolean).length / values.length : null;
  }
  summary.crossApproachAgreement = summary.pairwiseAgreement["jev-openai"];
  return summary;
}
