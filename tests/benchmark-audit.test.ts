import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateOpenaiCost } from "../src/lib/pricing.ts";
import { supportBaseline, parseOpenaiDecision } from "../src/lib/support-baseline.ts";
import { supportRequest, resumeRequest, mapResumeAnswers } from "../src/lib/decision-tasks.ts";
import { validateDecisionResponse, type DecisionAnswers } from "../src/lib/decision-provider.ts";
import { runBenchmark } from "../src/lib/benchmark-runner.ts";
import { summarizeTrials, routeDecision, type BranchResult, type Trial } from "../src/lib/comparison.ts";
import { mapOpenaiResumeEvaluations, type Requirement, type OpenaiResumeItem } from "../src/lib/resume-evaluation.ts";

test("OpenAI cost accounts for ordinary input, cache reads, cache writes, and all output", () => {
  // 800 ordinary, 100 cached, 100 written, 50 output. Cache writes cost 1.25x.
  const expected = (800 * 0.2 + 100 * 0.02 + 100 * 0.25 + 50 * 1.2) / 1_000_000;
  assert.equal(estimateOpenaiCost("gpt-5.6-luna", 1000, 100, 50, 100), expected);
  assert.equal(estimateOpenaiCost("gpt-5.6-luna-2026-10-01", 1000, 100, 50, 100), expected);
  assert.equal(estimateOpenaiCost("unknown-model", 1000, 0, 50), undefined);
  assert.equal(estimateOpenaiCost("gpt-5.6-luna", undefined, 0, 50), undefined);
  assert.equal(estimateOpenaiCost("gpt-5.6-luna", 1000, 900, 50, 200), undefined);
  assert.equal(estimateOpenaiCost("gpt-5.6-luna", 1000, -1, 50), undefined);
  assert.equal(estimateOpenaiCost("gpt-5.6-luna", 1000, 0, 50, 0, "fast"), undefined);
  assert.equal(estimateOpenaiCost("gpt-5.6-luna", 300_000, 0, 50), (300_000 * 0.4 + 50 * 1.8) / 1_000_000);
});

test("OpenAI explanation baseline receives all shared question instructions and rubrics", () => {
  const task = supportRequest("Please refund this duplicate charge");
  const baseline = supportBaseline(task.state.supportTicket);
  assert.deepEqual(JSON.parse(baseline.input), task.state);
  const rubric = JSON.parse(baseline.instructions.split("Shared decision rubric:\n")[1]);
  assert.deepEqual(rubric, task.questions);
  assert.match(baseline.instructions, /concise explanation/);
});

test("OpenAI parser rejects fractional or duplicate labels rather than miscounting success", () => {
  const valid = "Category: billing\nUrgency: 2\nHuman review: Yes\n\nA duplicate charge needs review.";
  assert.deepEqual(parseOpenaiDecision(valid), { category: "billing", urgency: 2, needsHuman: true });
  assert.ok(parseOpenaiDecision(valid.replace("Category:", "**Category:**")));
  for (const invalid of [
    valid.replace("Urgency: 2", "Urgency: 2.5"),
    valid.replace("Urgency: 2", "Urgency: 4"),
    valid + "\nCategory: technical", valid + "\nCategory: billing",
    valid.replace("Category: billing", "The category: billing"),
    valid.replace("Human review: Yes", "Human review: maybe"),
  ]) assert.equal(parseOpenaiDecision(invalid), undefined);
});

test("screenshot-like trial timings produce the displayed means and medians", () => {
  const decision = { category: "billing" as const, urgency: 2, needsHuman: true };
  const branch = (time: number, cost: number): BranchResult => ({ status: "success", decision, action: routeDecision(decision), timing: { totalMs: time }, estimatedCostUsd: cost });
  const times = { jev: [300, 314, 379], openai: [1300, 1399, 1639], microsoft: [500, 693, 1939] };
  const trials: Trial[] = times.jev.map((_, index) => ({ jev: branch(times.jev[index], 0.000022), openai: branch(times.openai[index], 0.000257 / 3), microsoft: branch(times.microsoft[index], 0.000026 / 3) }));
  const summary = summarizeTrials(trials);
  assert.deepEqual(summary.averageLatencyMs, { jev: 331, openai: 1446, microsoft: 1044 });
  assert.deepEqual(summary.medianLatencyMs, { jev: 314, openai: 1399, microsoft: 693 });
  assert.deepEqual(summary.latencyRangeMs.microsoft, { min: 500, max: 1939 });
  assert.equal(summary.decisionStability.jev, 1);
  assert.ok(Math.abs(summary.averageCostUsd.jev! - 0.000022) < 1e-15);
  assert.equal(summarizeTrials([trials[0]]).decisionStability.jev, null);
});

test("benchmark launches concurrently, rotates launch order, isolates errors, and waits between trials", async () => {
  const launched: string[] = [];
  let active = 0;
  let maximum = 0;
  const trials = await runBenchmark(3, async (provider) => {
    if (launched.length % 3 === 0) assert.equal(active, 0);
    launched.push(provider);
    active++; maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    if (provider === "microsoft") throw new Error("do not expose upstream details");
    return { status: "success", model: provider };
  });
  assert.equal(maximum, 3);
  assert.deepEqual(launched, ["jev", "openai", "microsoft", "openai", "microsoft", "jev", "microsoft", "jev", "openai"]);
  assert.equal(trials.length, 3);
  assert.ok(trials.every((trial) => trial.jev.model === "jev" && trial.openai.model === "openai" && trial.microsoft?.status === "error"));
  assert.deepEqual(summarizeTrials(trials).failureCount, { jev: 0, openai: 0, microsoft: 3 });
});

const requirement: Requirement = { id: "r1", requirement: "TypeScript experience", description: "", jdSourceQuote: "Required TypeScript experience", importance: "mandatory", evaluationType: "noul", criteria: "Explicit TypeScript evidence", choiceOptions: [], targetOption: "" };

test("resume evidence with low selection confidence cannot establish positive support", () => {
  const resume = "Built TypeScript services for five years.";
  const { candidateMap } = resumeRequest(requirement.jdSourceQuote, resume, [requirement]);
  const answers: DecisionAnswers = {
    assessment_r1: { type: "noul", noul: 0.99 },
    evidence_r1: { type: "choice", choice: "e1", confidence: 0.3, probabilities: { none: 0.4, e1: 0.6 } },
  };
  assert.equal(mapResumeAnswers(answers, resume, [requirement], candidateMap)[0].status, "uncertain");
});

test("OpenAI resume evaluation must return each reviewed requirement exactly once", () => {
  const item: OpenaiResumeItem = { id: "r1", status: "supported", evidenceQuote: "Built TypeScript services.", explanation: "Explicit experience." };
  assert.equal(mapOpenaiResumeEvaluations(item.evidenceQuote!, [requirement], [item])[0].status, "supported");
  for (const items of [[], [item, item], [{ ...item, id: "r99" }]]) assert.throws(() => mapOpenaiResumeEvaluations("resume", [requirement], items), /exactly once/);
  assert.equal(mapOpenaiResumeEvaluations("A different resume.", [requirement], [item])[0].status, "uncertain");
});

test("a score inconsistent with its probability distribution is rejected", () => {
  assert.throws(() => validateDecisionResponse({ answers: { urgency: { type: "score", score: 0, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 0, "3": 1 } } } }, { urgency: supportRequest("ticket").questions.urgency }), /Invalid decision response/);
});
