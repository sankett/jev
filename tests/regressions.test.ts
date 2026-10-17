import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTrials, type NormalizedDecision, type Trial } from "../src/lib/comparison.ts";
import {
  aggregate,
  evidenceCandidates,
  normalizeExtractedRequirement,
  requirementSchema,
  validateRequirements,
  validatedQuote,
  type Requirement,
} from "../src/lib/resume-evaluation.ts";

const requirement: Requirement = {
  id: "r1",
  requirement: "Production TypeScript experience",
  description: "",
  jdSourceQuote: "Required: TypeScript experience.",
  importance: "mandatory",
  evaluationType: "noul",
  criteria: "Documented TypeScript experience",
  choiceOptions: [],
  targetOption: "",
};

test("benchmark stability is the most common decision regardless of trial order", () => {
  const a: NormalizedDecision = { category: "billing", urgency: 1, needsHuman: true };
  const b: NormalizedDecision = { ...a, category: "technical" };
  const trial = (decision: NormalizedDecision): Trial => ({
    jev: { status: "success", decision },
    openai: { status: "error" },
  });
  assert.equal(summarizeTrials([trial(a), trial(b), trial(b)]).decisionStability.jev, 2 / 3);
  assert.equal(summarizeTrials([trial(b), trial(a), trial(b)]).decisionStability.jev, 2 / 3);
});

test("failed trials do not count toward successful decision stability", () => {
  const summary = summarizeTrials([{ jev: { status: "error" }, openai: { status: "error" } }]);
  assert.equal(summary.decisionStability.jev, null);
  assert.equal(summary.crossApproachAgreement, null);
});

test("evidence selection retains relevant text beyond the start of a long paragraph", () => {
  const resume = `${"Managed team schedules and routine planning activities; ".repeat(15)}Built production TypeScript applications for five years`;
  const candidates = evidenceCandidates(resume, requirement);
  assert.ok(candidates.some((quote) => quote.includes("TypeScript")));
  assert.ok(candidates.every((quote) => quote.length <= 360 && resume.includes(quote)));
});

test("extracted Choice options are trimmed and remain valid for evaluation", () => {
  const item = normalizeExtractedRequirement(requirement.jdSourceQuote, {
    ...requirement,
    evaluationType: "choice",
    choiceOptions: [" Azure ", " AWS "],
    targetOption: " Azure ",
  }, "r1");
  assert.ok(item);
  assert.ok(requirementSchema.safeParse(item).success);
  assert.equal(validateRequirements(requirement.jdSourceQuote, [item]), null);
  assert.deepEqual(item.choiceOptions, ["Azure", "AWS"]);
});

test("extraction rejects duplicate options, short fields, oversized quotes and options", () => {
  assert.equal(normalizeExtractedRequirement(requirement.jdSourceQuote, {
    ...requirement, evaluationType: "choice", choiceOptions: ["AWS", "aws"], targetOption: "AWS",
  }, "r1"), null);
  assert.equal(normalizeExtractedRequirement(requirement.jdSourceQuote, { ...requirement, requirement: "X" }, "r1"), null);
  const longQuote = "x".repeat(1001);
  assert.equal(normalizeExtractedRequirement(longQuote, { ...requirement, jdSourceQuote: longQuote }, "r1"), null);
  assert.equal(normalizeExtractedRequirement(requirement.jdSourceQuote, {
    ...requirement, evaluationType: "choice", choiceOptions: ["a".repeat(81), "AWS"], targetOption: "AWS",
  }, "r1"), null);
});

test("quotes must be exact source excerpts", () => {
  assert.equal(validatedQuote("Built React apps.", " Built React apps. "), "Built React apps.");
  assert.equal(validatedQuote("Built React apps.", "Built Vue apps."), null);
  assert.equal(normalizeExtractedRequirement("Different job description", requirement, "r1"), null);
});

test("weighted summaries preserve uncertainty and handle empty input", () => {
  const preferred: Requirement = { ...requirement, id: "r2", importance: "preferred" };
  assert.deepEqual(aggregate([requirement, preferred], [{ id: "r1", status: "supported", evidenceQuote: "Evidence" }]), {
    lowerPercent: 67, upperPercent: 100, missingMandatory: 0, uncertain: 1,
  });
  assert.deepEqual(aggregate([], []), { lowerPercent: 0, upperPercent: 0, missingMandatory: 0, uncertain: 0 });
});
