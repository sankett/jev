"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/providers";
import { PAIRS, PAIR_PROVIDERS, compareDecisions, type Agreement, type BranchResult, type ComparisonSummary, type Pair } from "@/lib/comparison";

const EXAMPLES = [
  ["Billing issue", "I was charged twice for my subscription this morning. Please refund the duplicate payment as soon as possible."],
  ["Technical issue", "The dashboard has been showing a blank screen since yesterday. I already cleared my cache and tried another browser."],
  ["Cancellation", "Please cancel my plan at the end of this billing period. I no longer need the service."],
];

type Branch = Omit<BranchResult, "status"> & { status: "success" | "error" | "pending" };
type Trial = Record<Provider, Branch> & { executionOrder?: Provider[]; pairwiseAgreement?: Partial<Record<Pair, Agreement>> };
type Comparison = { model: string; requestedRuns: number; trials: Trial[]; completionOrder?: Provider[]; summary?: ComparisonSummary; benchmark?: { protocolVersion: string; startedAt: string; measurement: string; launchPolicy: string; warmupRuns: number } };

const pct = (value?: number | null) => value == null ? "—" : Math.round(value * 100) + "%";
const ms = (value?: number | null) => value == null ? "—" : Math.round(value) + " ms";

function trialAgreement(trial: Trial): Partial<Record<Pair, Agreement>> {
  const pairs: Partial<Record<Pair, Agreement>> = {};
  for (const pair of PAIRS) {
    const [left, right] = PAIR_PROVIDERS[pair].map((provider) => trial[provider]);
    if (left.status === "success" && right.status === "success" && left.decision && right.decision && left.action && right.action) pairs[pair] = compareDecisions(left.decision, left.action, right.decision, right.action);
  }
  return pairs;
}
const pairLabel = (pair: Pair) => PAIR_PROVIDERS[pair].map((provider) => PROVIDER_LABELS[provider]).join(" / ");

function Bars({ values }: { values: Record<string, number> }) {
  return <div className="space-y-2">{Object.entries(values).map(([key, value]) =>
    <div key={key}>
      <div className="flex justify-between text-xs text-zinc-400"><span>{key}</span><span>{pct(value)}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-zinc-800"><div className="h-1.5 rounded-full bg-fuchsia-400" style={{ width: Math.max(2, value * 100) + "%" }} /></div>
    </div>
  )}</div>;
}

function PromptDetails({ branch, expanded = false }: { branch: Branch; expanded?: boolean }) {
  if (!branch.inputPrompt && !branch.outputResponse) return null;
  return <div className="space-y-2 border-t border-zinc-800 pt-4">
    {branch.inputPrompt && <details open={expanded}>
      <summary className="cursor-pointer text-sm text-zinc-300">Input prompt</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-900 p-3 text-xs leading-5 text-zinc-300">{branch.inputPrompt}</pre>
    </details>}
    {branch.outputResponse && <details open={expanded}>
      <summary className="cursor-pointer text-sm text-zinc-300">Output response</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-900 p-3 text-xs leading-5 text-zinc-300">{branch.outputResponse}</pre>
    </details>}
  </div>;
}

function Card({ provider, branch }: { provider: Provider; branch: Branch }) {
  const title = PROVIDER_LABELS[provider];
  const decisionModel = provider !== "openai";
  const model = branch.model;
  const decision = branch.decision;
  const evidence = branch.evidence ?? branch.jevEvidence;
  return <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-2xl">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className={"rounded-full px-2.5 py-1 text-xs " + (branch.status === "success" ? "bg-emerald-400/10 text-emerald-300" : branch.status === "pending" ? "bg-zinc-800 text-zinc-300" : "bg-rose-400/10 text-rose-300")}>{branch.status}</span>
    </div>
    {(branch.timing || branch.estimatedCostUsd != null) && <div className="mb-5 mt-3 flex flex-wrap gap-2">
      <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-2">
        <span className="block text-xs text-fuchsia-200">Server request</span>
        <strong className="text-base tabular-nums text-zinc-100">{ms(branch.timing?.totalMs)}</strong>
      </div>
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
        <span className="block text-xs text-zinc-400">{branch.costSource === "reported" ? "Reported cost" : "Estimated cost"}</span>
        <strong className="text-base tabular-nums text-zinc-100">{branch.estimatedCostUsd != null ? `$${branch.estimatedCostUsd.toFixed(6)}` : "Unavailable"}</strong>
      </div>
      {model && <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2">
        <span className="block text-xs text-sky-200">Model</span>
        <strong className="break-all text-base text-zinc-100">{model}</strong>
      </div>}
    </div>}
    <p className="mb-3 mt-2 text-xs text-zinc-400">{branch.transport ?? ""} · {decisionModel ? "Typed decisions" : "Generated explanation baseline"}</p>
    {branch.usage && <p className="mb-4 text-xs text-zinc-400">Input tokens: {branch.usage.inputTokens ?? "Unavailable"} · Output tokens: {branch.usage.outputTokens ?? "Unavailable"}</p>}
    {branch.error ? <div className="space-y-4">
      <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">{branch.error}</div>
      <PromptDetails branch={branch} expanded={!decisionModel} />
    </div> : decision ?
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div><div className="label">Category</div><div className="value">{decision.category}</div></div>
          <div><div className="label">Urgency</div><div className="value">{decision.urgency.toFixed(1)}</div></div>
          <div><div className="label">Human review</div><div className="value">{decision.needsHuman ? "Yes" : "No"}</div></div>
        </div>
        <div><div className="label">Application routing</div><p className="text-sm text-zinc-200">{branch.action}</p></div>
        <PromptDetails branch={branch} expanded={!decisionModel} />
        {decisionModel && evidence && <div className="space-y-4 border-t border-zinc-800 pt-4">
          <div><div className="label">Category probabilities</div><Bars values={evidence.categoryProbabilities} /></div>
          <div><div className="label">Urgency probabilities</div><Bars values={evidence.urgencyProbabilities} /></div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
            <span>Category confidence <b className="text-zinc-200">{pct(evidence.categoryConfidence)}</b></span>
            <span>Urgency confidence <b className="text-zinc-200">{pct(evidence.urgencyConfidence)}</b></span>
            <span>Human probability <b className="text-zinc-200">{pct(evidence.needsHumanProbability)}</b></span>
          </div>
        </div>}
        {!decisionModel && <p className="text-xs text-zinc-500">OpenAI’s free-form explanation includes explicit decision labels for comparison.</p>}
      </div> : <p className="text-sm text-zinc-500">No result.</p>}
  </section>;
}

function BenchmarkSummary({ result }: { result: Comparison }) {
  const summary = result.summary!;
  const money = (value: number | null | undefined) => value == null ? "Unavailable" : "$" + value.toFixed(6);
  return <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
    <h2 className="text-lg font-semibold">Benchmark summary · {result.trials.length} trials</h2>
    <p className="mt-2 text-sm text-amber-200">One ticket repeated {result.trials.length} times. This checks request time and label repeatability; accuracy has not been measured.</p>
    <p className="mt-2 text-xs text-zinc-400">JEV and Microsoft return probabilities. OpenAI generates an explanation using the same semantic rubric, so it performs additional output work. Transport paths and token accounting also differ.</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-400"><tr>{["Provider", "Success / failure", "Mean wall time", "Median wall time", "Min–max", "Label repeatability", "Total cost*", "Cost / request*"].map((label) => <th key={label} className="whitespace-nowrap p-2">{label}</th>)}</tr></thead>
      <tbody>{PROVIDERS.map((provider) => {
        const range = summary.latencyRangeMs[provider];
        return <tr key={provider} className="border-t border-zinc-800">
          <th className="p-2">{PROVIDER_LABELS[provider]}</th>
          <td className="p-2">{summary.successCount[provider]} / {summary.failureCount[provider]}</td>
          <td className="whitespace-nowrap p-2">{ms(summary.averageLatencyMs[provider])}</td>
          <td className="whitespace-nowrap p-2">{ms(summary.medianLatencyMs[provider])}</td>
          <td className="whitespace-nowrap p-2">{range ? range.min + "–" + range.max + " ms" : "Unavailable"}</td>
          <td className="p-2">{pct(summary.decisionStability[provider])}</td>
          <td className="p-2">{money(summary.totalCostUsd[provider])}</td>
          <td className="p-2">{money(summary.averageCostUsd[provider])}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="mt-2 text-xs text-zinc-500">*Reported cost where supplied, estimated otherwise. Totals and per-request averages are unavailable if any attempted request has unknown cost. OpenAI estimates include cache reads and writes at standard rates; account discounts and surcharges are excluded.</p>
    <p className="mt-2 text-xs text-zinc-400">Wall time includes network, SDK setup, provider processing, and application validation. It excludes the browser round trip and does not isolate model inference. Timing statistics use successful requests. Repeatability compares category, rounded urgency, and human-review labels across successful calls; raw scores may vary. At least two successes are required.</p>
    <div className="mt-4 space-y-2">{PAIRS.map((pair) => <p key={pair} className="text-sm text-zinc-300">{pairLabel(pair)} agreement: {pct(summary.pairwiseAgreement[pair])}</p>)}</div>
    <details className="mt-5 border-t border-zinc-800 pt-4"><summary className="cursor-pointer text-sm">Individual trial measurements</summary>
      <p className="mt-2 break-words text-xs text-zinc-400">Protocol: {result.benchmark?.protocolVersion ?? "unavailable"} · Started: {result.benchmark?.startedAt ?? "unavailable"}. Providers run concurrently; trials run sequentially with rotating launch order. No warm-up requests are excluded. Provider cache state is uncontrolled.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-zinc-400"><tr>{["Trial", "Provider / actual model", "Status", "Wall time", "Input / output tokens", "Cache read / write", "Cost / source"].map((label) => <th key={label} className="whitespace-nowrap p-2">{label}</th>)}</tr></thead>
        <tbody>{result.trials.flatMap((trial, index) => PROVIDERS.map((provider) => {
          const branch = trial[provider];
          return <tr key={index + provider} className="border-t border-zinc-800">
            <td className="p-2">{index + 1}</td><td className="p-2">{PROVIDER_LABELS[provider]}<br /><span className="break-all text-zinc-400">{branch.model ?? "Unavailable"}</span></td>
            <td className="p-2">{branch.status}</td><td className="whitespace-nowrap p-2">{ms(branch.timing?.totalMs)}</td>
            <td className="p-2">{branch.usage?.inputTokens ?? "—"} / {branch.usage?.outputTokens ?? "—"}</td>
            <td className="p-2">{branch.usage?.cachedInputTokens ?? "—"} / {branch.usage?.cacheWriteTokens ?? "—"}</td>
            <td className="p-2">{money(branch.estimatedCostUsd)} / {branch.costSource ?? "unknown"}</td>
          </tr>;
        }))}</tbody>
      </table></div>
    </details>
  </section>;
}

export default function Home() {
  const [message, setMessage] = useState(EXAMPLES[0][1]);
  const [result, setResult] = useState<Comparison>();
  const [selectedTrial, setSelectedTrial] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function changeMessage(value: string) { setMessage(value); setSelectedTrial(0); setResult(undefined); setError(""); }
  async function run(runs: 1 | 3) {
    setLoading(true); setSelectedTrial(0); setError(""); setResult(undefined);
    try {
      if (runs === 3) {
        const response = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, runs }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Comparison failed");
        setResult(data); return;
      }
      const initial: Comparison = { model: "", requestedRuns: 1, trials: [{ jev: { status: "pending" }, openai: { status: "pending" }, microsoft: { status: "pending" } }], completionOrder: [] };
      setResult(initial);
      await Promise.all(PROVIDERS.map(async (provider) => {
        let branch: Branch;
        let model: string | undefined;
        try {
          const response = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, runs: 1, provider }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Comparison failed");
          branch = data.branch; model = data.model;
        } catch (cause) { branch = { status: "error", error: cause instanceof Error ? cause.message : "Comparison failed" }; }
        setResult((current) => {
          const state = current ?? initial;
          const trial = { ...state.trials[0], [provider]: branch };
          return { ...state, model: model ?? state.model, trials: [{ ...trial, pairwiseAgreement: trialAgreement(trial) }], completionOrder: [...(state.completionOrder ?? []), provider] };
        });
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Comparison failed"); }
    finally { setLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void run(1); }
  const trial = result?.trials[selectedTrial];
  const displayedProviders = result?.completionOrder ?? [...PROVIDERS];
  return <main className="min-h-screen bg-[#0c0a0f] px-5 py-10 text-zinc-100"><div className="mx-auto max-w-7xl">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.25em] text-fuchsia-300">JEV decision lab</p><Link href="/resume-evaluation" className="rounded-full border border-fuchsia-400/50 px-4 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-400/10">Resume Evaluation →</Link></div>
    <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">Explicit decisions, compared.</h1>
    <p className="mt-4 max-w-3xl text-zinc-400">Compare JEV, OpenAI, and Microsoft-Decision-1 on the same support-ticket decisions: category, urgency, and human review.</p>
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <label className="label" htmlFor="support-message">Support message</label>
      <textarea id="support-message" disabled={loading} value={message} onChange={event => changeMessage(event.target.value)} maxLength={2000} className="mt-2 min-h-32 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm outline-none focus:border-fuchsia-400" />
      <div className="mt-4 flex flex-wrap gap-2">{EXAMPLES.map(([label, text]) => <button type="button" disabled={loading} key={label} onClick={() => changeMessage(text)} className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-fuchsia-400">{label}</button>)}</div>
      <div className="mt-5 flex flex-wrap gap-3"><button disabled={loading || !message.trim()} className="button">{loading ? "Running…" : "Compare once"}</button><button type="button" disabled={loading || !message.trim()} onClick={() => void run(3)} className="button-secondary">Run 3-trial benchmark</button></div>
    </form>
    {error && <div role="alert" className="mt-5 rounded-xl border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</div>}
    {result && result.trials.length > 1 && <label className="mt-6 block text-sm text-zinc-300">Inspect trial <select className="ml-2 rounded border border-zinc-700 bg-zinc-900 p-2" value={selectedTrial} onChange={(event) => setSelectedTrial(Number(event.target.value))}>{result.trials.map((_, index) => <option key={index} value={index}>Trial {index + 1}</option>)}</select></label>}
    {trial && <>
      {result?.requestedRuns === 1 && <p aria-live="polite" className="mt-8 text-sm text-zinc-400">{displayedProviders.length} of 3 requests completed. Cards appear in browser completion order; request duration is measured on the server.</p>}
      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{displayedProviders.map((provider) => <Card key={provider} provider={provider} branch={trial[provider]} />)}</div>
      <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"><h2 className="text-lg font-semibold">Pairwise agreement · trial {selectedTrial + 1}</h2>
        {PAIRS.map((pair) => <div key={pair} className="mt-4"><h3 className="text-sm text-zinc-300">{pairLabel(pair)}</h3><div className="mt-2 flex flex-wrap gap-2">{trial.pairwiseAgreement?.[pair] ? Object.entries(trial.pairwiseAgreement[pair]!).map(([key, value]) => <span key={key} className={"rounded-full px-3 py-1 text-xs " + (value ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>{key}: {value ? "match" : "different"}</span>) : <span className="text-xs text-zinc-500">Unavailable until both providers succeed</span>}</div></div>)}
      </section>
    </>}
    {result?.summary && <BenchmarkSummary result={result} />}
    <p className="mt-8 text-xs leading-5 text-zinc-500">Methodology: all evaluation calls have a 60-second timeout and no automatic retries. Request durations include provider and network time. JEV and Microsoft return typed probabilities; OpenAI generates an explanation. Agreement and three repeated trials measure consistency; accuracy requires labeled ground truth. Latency summaries include successful calls. Failed trials are excluded from agreement and stability. Providers may have different calibration.</p>
  </div></main>;
}
