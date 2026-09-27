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

export type JevEvidence = {
  categoryConfidence: number;
  categoryProbabilities: Record<string, number>;
  urgencyRaw: number;
  urgencyConfidence: number;
  urgencyProbabilities: Record<string, number>;
  needsHumanProbability: number;
};

export type Timing = {
  totalMs: number;
  jevMs?: number;
};

export type Usage = {
  jevInputTokens?: number;
  jevOutputTokens?: number;
  openaiInputTokens?: number;
  openaiOutputTokens?: number;
};

export type BranchResult = {
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
  jev: BranchResult;
  openai: BranchResult;
  agreement?: Agreement;
};

export type ComparisonSummary = {
  averageLatencyMs: { jev: number; openai: number };
  medianLatencyMs: { jev: number; openai: number };
  decisionStability: { jev: number; openai: number };
  crossApproachAgreement: number;
};

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

function successful<T extends BranchResult>(
  trials: Trial[],
  branch: "jev" | "openai",
): T[] {
  return trials
    .map((trial) => trial[branch])
    .filter((result): result is T => result.status === "success");
}

function stability(results: BranchResult[]): number {
  const decisions = results
    .filter(
      (result): result is BranchResult & { decision: NormalizedDecision } =>
        result.status === "success" && Boolean(result.decision),
    )
    .map((result) => result.decision);

  if (decisions.length < 2) return decisions.length === 1 ? 1 : 0;

  const first = decisions[0];
  const matches = decisions.filter(
    (decision) =>
      decision.category === first.category &&
      Math.round(decision.urgency) === Math.round(first.urgency) &&
      decision.needsHuman === first.needsHuman,
  ).length;

  return matches / decisions.length;
}

export function summarizeTrials(trials: Trial[]): ComparisonSummary {
  const jev = successful(trials, "jev");
  const llm = successful(trials, "openai");
  const jevTimes = jev.flatMap((result) => (result.timing ? [result.timing.totalMs] : []));
  const llmTimes = llm.flatMap((result) => (result.timing ? [result.timing.totalMs] : []));
  const agreements = trials.flatMap((trial) => (trial.agreement ? [trial.agreement] : []));
  const agreementValues = agreements.flatMap((agreement) => [
    agreement.category,
    agreement.urgency,
    agreement.needsHuman,
    agreement.action,
  ]);

  return {
    averageLatencyMs: {
      jev: Math.round(average(jevTimes)),
      openai: Math.round(average(llmTimes)),
    },
    medianLatencyMs: {
      jev: Math.round(median(jevTimes)),
      openai: Math.round(median(llmTimes)),
    },
    decisionStability: {
      jev: stability(jev),
      openai: stability(llm),
    },
    crossApproachAgreement: agreementValues.length
      ? agreementValues.filter(Boolean).length / agreementValues.length
      : 0,
  };
}
