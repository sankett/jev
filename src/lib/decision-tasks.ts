import { choice, noul, score, type Questions } from "@typesafe-ai/sdk";
import type { DecisionRequest, DecisionAnswers } from "./decision-provider.ts";
import { evidenceCandidates, validatedQuote, type Evaluation, type Requirement } from "./resume-evaluation.ts";
import type { Category, NormalizedDecision, DecisionEvidence } from "./comparison.ts";

export function supportRequest(message: string): DecisionRequest {
  return {
      state: { supportTicket: message },
      questions: {
        category: choice("Which support category best matches this ticket?", {
          billing: "Payments, invoices, charges, or refunds",
          technical: "A product defect, error, outage, or access problem",
          cancellation: "A request to cancel or close an account",
          general: "Anything that does not fit the other categories",
        }),
        urgency: score("How urgent is this support ticket?", [
          "Low: informational or no time pressure",
          "Normal: should be handled in the usual support queue",
          "High: materially affecting the customer and needs prompt attention",
          "Critical: severe impact, security risk, or immediate deadline",
        ]),
        needsHuman: noul("Does this ticket need a human support agent?", {
          true: "A person should review or act on this ticket",
          false: "The ticket can be handled safely by an automated workflow",
        }),
      },
    };
}

export function mapSupportAnswers(answers: DecisionAnswers): { decision: NormalizedDecision; evidence: DecisionEvidence } {
  const category = answers.category;
  const urgency = answers.urgency;
  const human = answers.needsHuman;
  if (category.type !== "choice" || urgency.type !== "score" || human.type !== "noul") throw new Error("Invalid decision response");
  return {
    decision: { category: category.choice as Category, urgency: urgency.score, needsHuman: human.noul >= 0.5 },
    evidence: {
      categoryConfidence: category.confidence, categoryProbabilities: category.probabilities,
      urgencyRaw: urgency.score, urgencyConfidence: urgency.confidence,
      urgencyProbabilities: urgency.probabilities, needsHumanProbability: human.noul,
    },
  };
}

export function resumeRequest(jobDescription: string, resume: string, requirements: Requirement[]) {
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
  return { request: { state: { jobDescription, resume }, questions }, candidateMap };
}

export function mapResumeAnswers(answers: DecisionAnswers, resume: string, requirements: Requirement[], candidateMap: Map<string, string[]>): Evaluation[] {
  return requirements.map((requirement) => {
      const answer = answers[`assessment_${requirement.id}`];
      const evidence = answers[`evidence_${requirement.id}`];
      const candidates = candidateMap.get(requirement.id) ?? [];
      const chosen = evidence?.type === "choice" && /^e\d+$/.test(evidence.choice)
        ? candidates[Number(evidence.choice.slice(1)) - 1]
        : null;
      const evidenceQuote = validatedQuote(resume, chosen);
      const reliableEvidence = evidenceQuote && evidence?.type === "choice" && evidence.confidence >= 0.55;
      let status: Evaluation["status"] = "uncertain";
      let probability: number | undefined;
      let scoreValue: number | undefined;
      let scoreConfidence: number | undefined;
      let selectedOption: string | undefined;
      let choiceConfidence: number | undefined;
      let choiceProbabilities: Record<string, number> | undefined;
      if (answer?.type === "noul") {
        probability = answer.noul;
        if (probability >= 0.8 && reliableEvidence) status = "supported";
        else if (probability <= 0.2) status = "not supported";
      } else if (answer?.type === "score") {
        scoreValue = answer.score;
        scoreConfidence = answer.confidence;
        if (scoreConfidence >= 0.55) {
          if (scoreValue >= 1.75 && reliableEvidence) status = "supported";
          else if (scoreValue >= 0.75 && reliableEvidence) status = "partial";
          else if (scoreValue < 0.75) status = "not supported";
        }
      } else if (answer?.type === "choice") {
        selectedOption = /^o\d+$/.test(answer.choice) ? requirement.choiceOptions[Number(answer.choice.slice(1)) - 1] : undefined;
        choiceConfidence = answer.confidence;
        choiceProbabilities = Object.fromEntries(Object.entries(answer.probabilities).map(([key, value]) => [key === "none" ? "No documented primary category" : requirement.choiceOptions[Number(key.slice(1)) - 1] ?? key, value]));
        if (choiceConfidence >= 0.55) {
          if (selectedOption === requirement.targetOption && reliableEvidence) status = "supported";
          else if (selectedOption && selectedOption !== requirement.targetOption) status = "not supported";
        }
      }
      return { id: requirement.id, status, evidenceQuote, evidenceConfidence: evidence?.type === "choice" ? evidence.confidence : undefined, probability, score: scoreValue, scoreConfidence, selectedOption, choiceConfidence, choiceProbabilities };
    });
}
