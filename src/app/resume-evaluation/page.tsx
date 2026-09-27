"use client";

import Link from "next/link";
import { useState } from "react";
import type { Evaluation, Metrics, Requirement } from "@/lib/resume-evaluation";

type CompletedBranch = { status: "success"; evaluations: Evaluation[]; summary: { lowerPercent: number; upperPercent: number; missingMandatory: number; uncertain: number }; metrics: Metrics; overview?: string } | { status: "error"; error: string };
type Branch = CompletedBranch | { status: "pending" };
type Provider = "jev" | "openai";
type Result = { jev: Branch; openai: Branch; model: string; completionOrder: Provider[] };
type Extraction = { requirements: Requirement[]; provider: "OpenAI"; model: string; omittedUnverifiable: number; metrics: Metrics };

const SAMPLE_JOB_DESCRIPTION = `Senior Frontend Engineer — Example Product Team

Required: At least 4 years building production React applications.
Required: Strong TypeScript experience, including typed APIs and reusable component libraries.
Required: Design scalable frontend architecture and explain technical trade-offs.
Required: Lead technical reviews and mentor other engineers.

Preferred: Azure as the candidate's primary recent production deployment platform, rather than AWS, GCP, or another platform.
Preferred: Hands-on Kubernetes operations experience.
Preferred: Accessibility testing against WCAG guidelines.`;

const SAMPLE_RESUME = `Alex Morgan — Frontend Engineer

Built and maintained production React applications for five years, including a customer dashboard used by 40,000 monthly users.

Created a reusable TypeScript component library and typed REST API clients shared across three product teams.

Contributed to a migration from a frontend monolith to smaller modules. Implemented module boundaries and documented two design trade-offs, but did not own the overall architecture.

Participated in weekly technical design reviews and paired with two junior engineers on React tasks.

Helped plan an Azure migration, including a deployment checklist. Production deployments in this role used AWS ECS.

Ran automated accessibility checks with axe on the dashboard and fixed keyboard navigation issues.`;

const field = "w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-fuchsia-400";
const percent = (value?: number) => value == null ? "—" : `${Math.round(value * 100)}%`;

function MetricLine({ metrics, model }: { metrics: Metrics; model?: string }) {
  return <div className="mt-3 flex flex-wrap gap-2">
    <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-2">
      <span className="block text-xs text-fuchsia-200">Latency</span>
      <strong className="text-base tabular-nums text-zinc-100">{metrics.latencyMs} ms</strong>
    </div>
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
      <span className="block text-xs text-zinc-400">Estimated cost</span>
      <strong className="text-base tabular-nums text-zinc-100">{metrics.estimatedCostUsd != null ? `$${metrics.estimatedCostUsd.toFixed(6)}` : "Unavailable"}</strong>
    </div>
    {model && <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2">
      <span className="block text-xs text-sky-200">OpenAI model</span>
      <strong className="text-base text-zinc-100">{model}</strong>
    </div>}
  </div>;
}

function LatencyComparison({ jev, openai }: { jev: Branch; openai: Branch }) {
  if (jev.status !== "success" || openai.status !== "success") return null;
  const jevMs = jev.metrics.latencyMs;
  const openaiMs = openai.metrics.latencyMs;
  const maxMs = Math.max(jevMs, openaiMs, 1);
  const finishedFirst = jevMs === openaiMs ? "Tie" : jevMs < openaiMs ? "JEV" : "OpenAI";
  const difference = Math.abs(jevMs - openaiMs);

  return <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5" aria-label="First evaluation latency comparison">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">First evaluation latency</h2>
      <span className="rounded-full bg-fuchsia-400/10 px-3 py-1 text-sm font-medium text-fuchsia-200">Finished first: {finishedFirst}{difference > 0 ? ` · ${difference} ms sooner` : ""}</span>
    </div>
    <p className="mt-1 text-xs text-zinc-500">Measured for this run; provider/network load can change the result.</p>
    <div className="mt-5 space-y-4">
      {([ ["JEV", jevMs], ["OpenAI", openaiMs] ] as const).map(([name, value]) => <div key={name}>
        <div className="mb-1 flex justify-between text-sm"><span className="text-zinc-300">{name}</span><span className="tabular-nums text-zinc-100">{value} ms</span></div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full ${name === "JEV" ? "bg-fuchsia-400" : "bg-sky-400"}`} style={{ width: `${Math.max((value / maxMs) * 100, 1)}%` }} /></div>
      </div>)}
    </div>
  </section>;
}

function BranchCard({ name, branch, requirements, jev, model }: { name: string; branch: Branch; requirements: Requirement[]; jev?: boolean; model?: string }) {
  return <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
    <h2 className="text-xl font-semibold">{name}</h2>
    {branch.status === "pending" ? <p className="mt-4 text-sm text-zinc-400">Waiting for this result…</p> : branch.status === "error" ? <p className="mt-4 text-sm text-rose-300">{branch.error}</p> : <>
      <MetricLine metrics={branch.metrics} model={jev ? undefined : model} />
      <p className="mt-3 text-sm text-zinc-300">Documented match: {branch.summary.lowerPercent}%{branch.summary.upperPercent !== branch.summary.lowerPercent ? `–${branch.summary.upperPercent}% (uncertain range)` : ""}</p>
      <p className="mt-1 text-xs text-zinc-500">{branch.summary.missingMandatory} mandatory requirements with no documented support · {branch.summary.uncertain} uncertain</p>
      {branch.overview && <p className="mt-4 text-sm text-zinc-300">{branch.overview}</p>}
      <div className="mt-5 space-y-3">{requirements.map((requirement) => {
        const item = branch.evaluations.find((evaluation) => evaluation.id === requirement.id);
        return <article key={requirement.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium text-zinc-100">{requirement.requirement}</h3><span className="rounded-full bg-fuchsia-400/10 px-2 py-1 text-xs text-fuchsia-200">{item?.status ?? "uncertain"}</span></div>
          <p className="mt-1 text-xs text-zinc-500">{requirement.importance} · {requirement.evaluationType === "noul" ? "Noul" : requirement.evaluationType === "score" ? "Score" : "Choice"}</p>
          {jev && <p className="mt-3 text-xs text-zinc-300">{requirement.evaluationType === "noul" ? `Probability of support: ${percent(item?.probability)}` : requirement.evaluationType === "score" ? `Evidence depth: ${item?.score?.toFixed(2) ?? "—"}/3 · score confidence: ${percent(item?.scoreConfidence)}` : `Primary category: ${item?.selectedOption ?? "not established"} · choice confidence: ${percent(item?.choiceConfidence)} · target: ${requirement.targetOption}`} · evidence choice confidence: {percent(item?.evidenceConfidence)}</p>}
          {jev && item?.choiceProbabilities && <p className="mt-1 text-xs text-zinc-500">Options: {Object.entries(item.choiceProbabilities).map(([label, value]) => `${label} ${percent(value)}`).join(" · ")}</p>}
          <p className="mt-3 text-xs uppercase tracking-wide text-zinc-500">Resume evidence</p>
          <blockquote className="mt-1 border-l-2 border-fuchsia-400 pl-3 text-sm text-zinc-300">{item?.evidenceQuote ? `“${item.evidenceQuote}”` : "No verified quote selected"}</blockquote>
          {item?.explanation && <p className="mt-3 text-xs leading-5 text-zinc-400">{item.explanation}</p>}
        </article>;
      })}</div>
    </>}
  </section>;
}

export default function ResumeEvaluationPage() {
  const [jobDescription, setJobDescription] = useState(SAMPLE_JOB_DESCRIPTION);
  const [resume, setResume] = useState(SAMPLE_RESUME);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [extraction, setExtraction] = useState<Extraction>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState<"extract" | "evaluate" | null>(null);
  const [error, setError] = useState("");

  function changeSource(setter: (value: string) => void, value: string) {
    setter(value);
    setRequirements([]);
    setExtraction(undefined);
    setResult(undefined);
  }

  async function post<T>(url: string, body: object): Promise<T> {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data as T;
  }

  async function extract() {
    setBusy("extract"); setError(""); setResult(undefined);
    try {
      const data = await post<Extraction>("/api/resume-evaluation/extract", { jobDescription, resume });
      setRequirements(data.requirements); setExtraction(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Extraction failed"); }
    finally { setBusy(null); }
  }

  async function evaluate() {
    setBusy("evaluate"); setError(""); setResult(undefined);
    const initial: Result = { jev: { status: "pending" }, openai: { status: "pending" }, model: "", completionOrder: [] };
    setResult(initial);
    let revealQueue = Promise.resolve();
    let revealedCount = 0;
    function reveal(provider: Provider, branch: CompletedBranch, model?: string) {
      revealQueue = revealQueue.then(async () => {
        if (revealedCount > 0) await new Promise((resolve) => setTimeout(resolve, 450));
        setResult((current) => {
          const state = current ?? initial;
          return {
            ...state,
            [provider]: branch,
            model: model ?? state.model,
            completionOrder: state.completionOrder.includes(provider) ? state.completionOrder : [...state.completionOrder, provider],
          };
        });
        revealedCount += 1;
        if (revealedCount === 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      return revealQueue;
    }
    async function runProvider(provider: Provider) {
      try {
        const response = await post<{ provider: Provider; result: CompletedBranch; model: string }>("/api/resume-evaluation/evaluate", { jobDescription, resume, requirements, provider });
        await reveal(provider, response.result, response.model);
      } catch (cause) {
        const failed: CompletedBranch = { status: "error", error: cause instanceof Error ? cause.message : `${provider} evaluation failed` };
        await reveal(provider, failed);
      }
    }
    await Promise.all([runProvider("jev"), runProvider("openai")]);
    setBusy(null);
  }

  function update(id: string, patch: Partial<Requirement>) {
    setRequirements((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setResult(undefined);
  }

  return <main className="min-h-screen bg-[#0c0a0f] px-5 py-10 text-zinc-100"><div className="mx-auto max-w-7xl">
    <Link href="/" className="text-sm text-fuchsia-300 hover:underline">← Support comparison</Link>
    <p className="mt-8 text-xs font-semibold uppercase tracking-[0.25em] text-fuchsia-300">JEV decision lab</p>
    <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Resume Evaluation</h1>
    <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-400">Compare documented resume evidence against individual job requirements. Review the extracted requirements before running JEV and OpenAI. This is an evidence review, not a hiring decision.</p>
    <p className="mt-2 text-xs text-zinc-500">Sample JD and resume are preloaded. Edit or replace either before identifying requirements.</p>
    <div className="mt-8 grid gap-5 md:grid-cols-2">
      <label className="block text-sm font-medium">Job description<textarea value={jobDescription} onChange={(event) => changeSource(setJobDescription, event.target.value)} maxLength={12000} placeholder="Paste the job description" className={`${field} mt-2 min-h-64`} /></label>
      <label className="block text-sm font-medium">Resume<textarea value={resume} onChange={(event) => changeSource(setResume, event.target.value)} maxLength={20000} placeholder="Paste the resume text" className={`${field} mt-2 min-h-64`} /></label>
    </div>
    <button type="button" disabled={busy !== null || jobDescription.trim().length < 20 || resume.trim().length < 20} onClick={() => void extract()} className="button mt-5">{busy === "extract" ? "Identifying…" : "Identify requirements"}</button>
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</p>}
    {requirements.length > 0 && <section className="mt-9 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-xl font-semibold">Review requirements</h2>
      <p className="mt-2 text-sm text-zinc-400">Edit the requirement and criteria as needed. The JD quote must remain verbatim. Resolve “unspecified” importance before evaluation.</p>
      {extraction && <><p className="mt-4 text-sm text-zinc-300">Requirements identified by {extraction.provider}. JEV is used after you click Evaluate resume.</p>{extraction.omittedUnverifiable > 0 && <p className="mt-2 text-xs text-amber-300">{extraction.omittedUnverifiable} extracted item(s) omitted because their JD quotes could not be verified.</p>}</>}
      <div className="mt-5 space-y-4">{requirements.map((item) => <div key={item.id} className="rounded-xl border border-zinc-800 p-4">
        <div className="grid gap-3 md:grid-cols-3"><label className="md:col-span-2 text-xs text-zinc-400">Requirement<input value={item.requirement} onChange={(event) => update(item.id, { requirement: event.target.value })} className={`${field} mt-1`} /></label><label className="text-xs text-zinc-400">Importance<select value={item.importance} onChange={(event) => update(item.id, { importance: event.target.value as Requirement["importance"] })} className={`${field} mt-1`}><option value="unspecified">Unspecified</option><option value="mandatory">Mandatory</option><option value="preferred">Preferred</option></select></label></div>
        <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="md:col-span-2 text-xs text-zinc-400">Evaluation criteria<input value={item.criteria} onChange={(event) => update(item.id, { criteria: event.target.value })} className={`${field} mt-1`} /></label><label className="text-xs text-zinc-400">JEV primitive<select value={item.evaluationType} onChange={(event) => update(item.id, { evaluationType: event.target.value as Requirement["evaluationType"], ...(event.target.value === "choice" && item.choiceOptions.length < 2 ? { choiceOptions: ["Option A", "Option B"], targetOption: "Option A" } : {}) })} className={`${field} mt-1`}><option value="noul">Noul · binary</option><option value="score">Score · graded</option><option value="choice">Choice · primary category</option></select></label></div>
        {item.evaluationType === "choice" && <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="md:col-span-2 text-xs text-zinc-400">Mutually exclusive options (one per line)<textarea key={`${item.id}-options`} defaultValue={item.choiceOptions.join("\n")} onBlur={(event) => { const options = event.target.value.split("\n").map((option) => option.trim()).filter(Boolean); update(item.id, { choiceOptions: options, targetOption: options.includes(item.targetOption) ? item.targetOption : options[0] ?? "" }); }} className={`${field} mt-1 min-h-28`} /></label><label className="text-xs text-zinc-400">Target option<select value={item.targetOption} onChange={(event) => update(item.id, { targetOption: event.target.value })} className={`${field} mt-1`}>{item.choiceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div>}
        <p className="mt-3 text-xs text-zinc-500">JD source: “{item.jdSourceQuote}”</p>
      </div>)}</div>
      <button type="button" disabled={busy !== null || requirements.some((item) => item.importance === "unspecified" || !item.requirement.trim() || !item.criteria.trim() || (item.evaluationType === "choice" && (item.choiceOptions.length < 2 || !item.choiceOptions.includes(item.targetOption))))} onClick={() => void evaluate()} className="button mt-5">{busy === "evaluate" ? "Evaluating…" : "Evaluate resume"}</button>
    </section>}
    {result && <><p className="mt-8 text-sm text-zinc-400">Both branches use the reviewed criteria. Results appear as each provider completes, in completion order. Shared extraction appears above and is excluded from each branch’s timing and token totals.</p>{result.completionOrder.length === 0 && <p className="mt-4 text-sm text-zinc-400">JEV and OpenAI are evaluating…</p>}<LatencyComparison jev={result.jev} openai={result.openai} /><div className="mt-4 grid gap-5 lg:grid-cols-2">{result.completionOrder.map((provider) => <BranchCard key={provider} name={provider === "jev" ? "JEV" : "OpenAI"} branch={result[provider]} requirements={requirements} jev={provider === "jev"} model={provider === "openai" ? result.model : undefined} />)}</div>{result.completionOrder.length === 1 && <p className="mt-4 text-sm text-zinc-400">Showing the first completed result; the other provider’s panel will appear shortly.</p>}{result.completionOrder.length === 2 && <p className="mt-5 text-xs text-zinc-500">Match percentages are deterministic summaries of documented evidence. Uncertain requirements widen the range. No score establishes candidate suitability on its own.</p>}</>}
  </div></main>;
}
