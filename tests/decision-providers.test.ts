import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDecisionResponse, runDecisionProvider, decisionCost, providerError, type DecisionAnswers } from "../src/lib/decision-provider.ts";
import { supportRequest, mapSupportAnswers, resumeRequest, mapResumeAnswers } from "../src/lib/decision-tasks.ts";
import { summarizeTrials, trialAgreements, routeDecision, type BranchResult, type Trial } from "../src/lib/comparison.ts";
import { MICROSOFT_MODEL } from "../src/lib/providers.ts";
import type { Requirement } from "../src/lib/resume-evaluation.ts";

const ticketAnswers: DecisionAnswers = {
  category: { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.05, cancellation: 0.03, general: 0.02 } },
  urgency: { type: "score", score: 1.2, confidence: 0.7, probabilities: { "0": 0.1, "1": 0.6, "2": 0.3, "3": 0 } },
  needsHuman: { type: "noul", noul: 0.8 },
};

test("all support primitives validate and map to shared application decisions", () => {
  const response = validateDecisionResponse({ answers: ticketAnswers }, supportRequest("Duplicate charge").questions);
  const { decision, evidence } = mapSupportAnswers(response.answers);
  assert.deepEqual(decision, { category: "billing", urgency: 1.2, needsHuman: true });
  assert.equal(evidence.needsHumanProbability, 0.8);
});

test("missing, malformed, out-of-range, and invalid-option answers are rejected", () => {
  const questions = supportRequest("Duplicate charge").questions;
  const invalid = [
    {}, { ...ticketAnswers, urgency: undefined },
    { ...ticketAnswers, needsHuman: { type: "noul", noul: 1.01 } },
    { ...ticketAnswers, urgency: { ...ticketAnswers.urgency, score: 4 } },
    { ...ticketAnswers, urgency: { ...ticketAnswers.urgency, score: NaN } },
    { ...ticketAnswers, category: { ...ticketAnswers.category, choice: "invented" } },
    { ...ticketAnswers, category: { ...ticketAnswers.category, choice: "technical" } },
    { ...ticketAnswers, category: { ...ticketAnswers.category, probabilities: { billing: 1 } } },
    { ...ticketAnswers, category: { ...ticketAnswers.category, confidence: -0.1 } },
    { ...ticketAnswers, needsHuman: { type: "choice", choice: "yes", confidence: 1, probabilities: { yes: 1 } } },
  ];
  for (const answers of invalid) assert.throws(() => validateDecisionResponse({ answers }, questions), /Invalid decision response/);
});

test("Jev and Microsoft send identical state and questions with independent transports", async (t) => {
  const oldFetch = globalThis.fetch;
  const oldKeys = { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  process.env.TYPESAFE_API_KEY = "test-key"; process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => { globalThis.fetch = oldFetch; for (const [key, value] of Object.entries(oldKeys)) { if (value == null) delete process.env[key]; else process.env[key] = value; } });
  const sent: { url: string; body: Record<string, unknown>; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(typeof init?.body, "string");
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json({ model: "returned-snapshot", answers: ticketAnswers, usage: { input_tokens: 100, output_tokens: 5, cost: 0.001 } });
  };
  const request = supportRequest("Duplicate charge");
  const jev = await runDecisionProvider("jev", request);
  const microsoft = await runDecisionProvider("microsoft", request);
  assert.equal(sent.length, 2);
  assert.match(sent[0].url, /api.typesafe.ai\/v1\/systemone$/);
  assert.equal(sent[0].body.model, process.env.JEV_MODEL || "jev-1.14.0");
  assert.equal(sent[1].url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(sent[1].body.model, MICROSOFT_MODEL);
  assert.deepEqual(sent[0].body.state, sent[1].body.state);
  assert.deepEqual(sent[0].body.questions, sent[1].body.questions);
  assert.ok(sent.every((call) => call.signal));
  assert.equal(jev.model, "returned-snapshot");
  assert.equal(microsoft.model, "returned-snapshot");
  assert.equal(decisionCost(microsoft.usage), 0.001);
});

test("Microsoft errors are not retried and context errors retain a useful safe message", async (t) => {
  const oldFetch = globalThis.fetch; const oldKey = process.env.OPENROUTER_API_KEY;
  t.after(() => { globalThis.fetch = oldFetch; if (oldKey == null) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
  process.env.OPENROUTER_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"error":"maximum context length exceeded"}', { status: 400 }); };
  await assert.rejects(runDecisionProvider("microsoft", supportRequest("x")), (error) => {
    assert.match(providerError(error, "Microsoft-Decision-1"), /32,768 tokens/); return true;
  });
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response("not JSON", { status: 200 });
  await assert.rejects(runDecisionProvider("microsoft", supportRequest("x")), /Invalid decision response/);
  assert.match(providerError(Object.assign(new Error("secret"), { status: 401 }), "Microsoft"), /authentication/);
  assert.match(providerError(Object.assign(new Error("secret"), { status: 429 }), "Microsoft"), /rate limit/);
  assert.match(providerError(new DOMException("Timed out", "TimeoutError"), "Microsoft"), /60 seconds/);
});

test("resume mappings preserve exact evidence and shared Noul, Score, and Choice thresholds", () => {
  const base: Requirement = { id: "r1", requirement: "TypeScript experience", description: "", jdSourceQuote: "Required TypeScript experience", importance: "mandatory", evaluationType: "noul", criteria: "Explicit TypeScript evidence", choiceOptions: [], targetOption: "" };
  const requirements: Requirement[] = [base, { ...base, id: "r2", evaluationType: "score" }, { ...base, id: "r3", evaluationType: "choice", choiceOptions: ["AWS", "Azure"], targetOption: "AWS" }];
  const resume = "Built TypeScript services on AWS for five years.";
  const { request, candidateMap } = resumeRequest(base.jdSourceQuote, resume, requirements);
  const answers: DecisionAnswers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
    else if (question.type === "score") answers[id] = { type: "score", score: 2, confidence: 0.9, probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 } };
    else {
      const chosen = id.startsWith("evidence_") ? "e1" : "o1";
      answers[id] = { type: "choice", choice: chosen, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === chosen ? 1 : 0])) };
    }
  }
  validateDecisionResponse({ answers }, request.questions);
  const mapped = mapResumeAnswers(answers, resume, requirements, candidateMap);
  assert.deepEqual(mapped.map((item) => item.status), ["supported", "supported", "supported"]);
  assert.ok(mapped.every((item) => item.evidenceQuote && resume.includes(item.evidenceQuote)));
  candidateMap.set("r1", ["Invented qualification"]);
  assert.equal(mapResumeAnswers(answers, resume, requirements, candidateMap)[0].status, "uncertain");
  assert.equal(mapResumeAnswers(answers, resume, requirements, candidateMap)[0].evidenceQuote, null);
});

test("three-provider summaries exclude failed pairs and keep unavailable metrics null", () => {
  const decision = mapSupportAnswers(ticketAnswers).decision;
  const success = (latency: number): BranchResult => ({ status: "success", decision, action: routeDecision(decision), timing: { totalMs: latency }, estimatedCostUsd: 0.01 });
  const trials: Trial[] = [
    { jev: success(100), openai: success(300), microsoft: success(200) },
    { jev: success(120), openai: { status: "error" }, microsoft: success(220) },
    { jev: { status: "error" }, openai: { status: "error" }, microsoft: success(240) },
  ];
  const summary = summarizeTrials(trials);
  assert.deepEqual(summary.successCount, { jev: 2, openai: 1, microsoft: 3 });
  assert.deepEqual(summary.failureCount, { jev: 1, openai: 2, microsoft: 0 });
  assert.deepEqual(summary.medianLatencyMs, { jev: 110, openai: 300, microsoft: 220 });
  assert.deepEqual(summary.pairwiseAgreement, { "jev-openai": 1, "jev-microsoft": 1, "openai-microsoft": 1 });
  assert.deepEqual(trialAgreements(trials[2]), {});
  assert.equal(summary.totalCostUsd.jev, null);
  assert.equal(summary.totalCostUsd.microsoft, 0.03);
  const empty = summarizeTrials([{ jev: { status: "error" }, openai: { status: "error" }, microsoft: { status: "error" } }]);
  assert.equal(empty.averageLatencyMs.microsoft, null);
  assert.equal(empty.decisionStability.microsoft, null);
  assert.equal(empty.pairwiseAgreement["jev-microsoft"], null);
  assert.equal(decisionCost(), undefined);
  assert.equal(decisionCost({ input_tokens: 1000 }), 0.000042);
  assert.equal(decisionCost({ input_tokens: 1000, cost: 0 }), 0);
});
