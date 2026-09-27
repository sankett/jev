"use client";

import { FormEvent, useState } from "react";

const EXAMPLES = [
  ["Billing issue", "I was charged twice for my subscription this morning. Please refund the duplicate payment as soon as possible."],
  ["Technical issue", "The dashboard has been showing a blank screen since yesterday. I already cleared my cache and tried another browser."],
  ["Cancellation", "Please cancel my plan at the end of this billing period. I no longer need the service."],
];

type Decision = { category: string; urgency: number; needsHuman: boolean };
type Branch = {
  status: "success" | "error";
  decision?: Decision;
  action?: string;
  inputPrompt?: string;
  outputResponse?: string;
  estimatedCostUsd?: number;
  costPricingLabel?: string;
  error?: string;
  jevEvidence?: {
    categoryConfidence: number;
    categoryProbabilities: Record<string, number>;
    urgencyConfidence: number;
    urgencyProbabilities: Record<string, number>;
    needsHumanProbability: number;
  };
  timing?: { totalMs: number };
  usage?: {
    jevInputTokens?: number;
    jevOutputTokens?: number;
    openaiInputTokens?: number;
    openaiOutputTokens?: number;
  };
};
type Trial = { jev: Branch; openai: Branch; agreement?: Record<string, boolean> };
type Comparison = {
  model: string;
  requestedRuns: number;
  trials: Trial[];
  summary: {
    averageLatencyMs: { jev: number; openai: number };
    medianLatencyMs: { jev: number; openai: number };
    decisionStability: { jev: number; openai: number };
    crossApproachAgreement: number;
  };
};

const pct = (value?: number) => value == null ? "—" : Math.round(value * 100) + "%";
const ms = (value?: number) => value == null ? "—" : Math.round(value) + " ms";

function Bars({ values }: { values: Record<string, number> }) {
  return <div className="space-y-2">{Object.entries(values).map(([key, value]) =>
    <div key={key}>
      <div className="flex justify-between text-xs text-zinc-400"><span>{key}</span><span>{pct(value)}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-zinc-800"><div className="h-1.5 rounded-full bg-fuchsia-400" style={{ width: Math.max(2, value * 100) + "%" }} /></div>
    </div>
  )}</div>;
}

function PromptDetails({ branch }: { branch: Branch }) {
  if (!branch.inputPrompt && !branch.outputResponse) return null;
  return <div className="space-y-2 border-t border-zinc-800 pt-4">
    {branch.inputPrompt && <details>
      <summary className="cursor-pointer text-sm text-zinc-300">Input prompt</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-900 p-3 text-xs leading-5 text-zinc-300">{branch.inputPrompt}</pre>
    </details>}
    {branch.outputResponse && <details>
      <summary className="cursor-pointer text-sm text-zinc-300">Output response</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-900 p-3 text-xs leading-5 text-zinc-300">{branch.outputResponse}</pre>
    </details>}
  </div>;
}

function Card({ title, branch, jev }: { title: string; branch: Branch; jev?: boolean }) {
  const decision = branch.decision;
  const inputTokens = jev
    ? branch.usage?.jevInputTokens
    : branch.usage?.openaiInputTokens;
  const outputTokens = jev
    ? branch.usage?.jevOutputTokens
    : branch.usage?.openaiOutputTokens;
  const totalTokens = inputTokens != null && outputTokens != null
    ? inputTokens + outputTokens
    : undefined;

  return <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-2xl">
    <div className="mb-5 flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className={"rounded-full px-2.5 py-1 text-xs " + (branch.status === "success" ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}>{branch.status}</span>
    </div>
    {branch.error ? <div className="space-y-4">
      <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">{branch.error}</div>
      <PromptDetails branch={branch} />
      {branch.estimatedCostUsd != null && <div className="text-xs text-zinc-300">Estimated token cost: ${branch.estimatedCostUsd.toFixed(6)} USD{branch.costPricingLabel && <span className="mt-1 block text-zinc-500">{branch.costPricingLabel}</span>}</div>}
    </div> : decision ?
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div><div className="label">Category</div><div className="value">{decision.category}</div></div>
          <div><div className="label">Urgency</div><div className="value">{decision.urgency.toFixed(1)}</div></div>
          <div><div className="label">Human review</div><div className="value">{decision.needsHuman ? "Yes" : "No"}</div></div>
        </div>
        <div><div className="label">Application routing</div><p className="text-sm text-zinc-200">{branch.action}</p></div>
        <PromptDetails branch={branch} />
        {jev && branch.jevEvidence && <div className="space-y-4 border-t border-zinc-800 pt-4">
          <div><div className="label">JEV category probabilities</div><Bars values={branch.jevEvidence.categoryProbabilities} /></div>
          <div><div className="label">JEV urgency probabilities</div><Bars values={branch.jevEvidence.urgencyProbabilities} /></div>
          <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
            <span>Category confidence <b className="text-zinc-200">{pct(branch.jevEvidence.categoryConfidence)}</b></span>
            <span>Urgency confidence <b className="text-zinc-200">{pct(branch.jevEvidence.urgencyConfidence)}</b></span>
            <span>Human probability <b className="text-zinc-200">{pct(branch.jevEvidence.needsHumanProbability)}</b></span>
          </div>
        </div>}
        {!jev && <p className="text-xs text-zinc-500">OpenAI’s free-form explanation includes explicit decision labels for comparison.</p>}
        <div className="border-t border-zinc-800 pt-3 text-xs text-zinc-500">
          <div>Total {ms(branch.timing?.totalMs)}</div>
          <div className="mt-1">Tokens: {inputTokens ?? "—"} + {outputTokens ?? "—"} = {totalTokens ?? "—"}</div>
          <div className="mt-1">{inputTokens ?? "—"} input tokens · {outputTokens ?? "—"} output tokens</div>
          <div className="mt-2 text-zinc-300">Estimated token cost: {branch.estimatedCostUsd == null ? "Unavailable for this model" : `$${branch.estimatedCostUsd.toFixed(6)} USD`}</div>
          {branch.costPricingLabel && <div className="mt-1">{branch.costPricingLabel}</div>}
        </div>
      </div> : <p className="text-sm text-zinc-500">No result.</p>}
  </section>;
}

export default function Home() {
  const [message, setMessage] = useState(EXAMPLES[0][1]);
  const [result, setResult] = useState<Comparison>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run(runs: 1 | 3) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, runs }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Comparison failed");
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(1);
  }

  const trial = result?.trials[0];
  return <main className="min-h-screen bg-[#0c0a0f] px-5 py-10 text-zinc-100"><div className="mx-auto max-w-6xl">
    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-fuchsia-300">JEV decision lab</p>
    <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">Explicit decisions, compared.</h1>
    <p className="mt-4 max-w-2xl text-zinc-400">Compare JEV and OpenAI on the same support-ticket decisions: category, urgency, and human review.</p>
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <label className="label">Support message</label>
      <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} className="mt-2 min-h-32 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm outline-none focus:border-fuchsia-400" />
      <div className="mt-4 flex flex-wrap gap-2">{EXAMPLES.map(([label, text]) => <button type="button" key={label} onClick={() => setMessage(text)} className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-fuchsia-400">{label}</button>)}</div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button disabled={loading || !message.trim()} className="button">{loading ? "Running…" : "Compare once"}</button>
        <button type="button" disabled={loading || !message.trim()} onClick={() => void run(3)} className="button-secondary">Run 3-trial benchmark</button>
      </div>
    </form>
    {error && <div className="mt-5 rounded-xl border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</div>}
    {trial && <>
      <div className="mt-8 grid gap-5 md:grid-cols-2"><Card title="JEV" branch={trial.jev} jev /><Card title="OpenAI" branch={trial.openai} /></div>
      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="label">Agreement for this trial</div>
        <div className="mt-3 flex flex-wrap gap-2">{Object.entries(trial.agreement ?? {}).map(([key, value]) => <span key={key} className={"rounded-full px-3 py-1 text-xs " + (value ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>{key}: {value ? "match" : "different"}</span>)}</div>
      </div>
    </>}
    {result && result.requestedRuns === 3 && <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-lg font-semibold">Benchmark summary</h2>
      <p className="mt-1 text-xs text-zinc-500">JEV / OpenAI</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat">Average latency<br /><b>{ms(result.summary.averageLatencyMs.jev)} / {ms(result.summary.averageLatencyMs.openai)}</b></div>
        <div className="stat">Median latency<br /><b>{ms(result.summary.medianLatencyMs.jev)} / {ms(result.summary.medianLatencyMs.openai)}</b></div>
        <div className="stat">Stability<br /><b>{pct(result.summary.decisionStability.jev)} / {pct(result.summary.decisionStability.openai)}</b></div>
        <div className="stat">Cross-approach agreement<br /><b>{pct(result.summary.crossApproachAgreement)}</b></div>
      </div>
    </section>}
    <p className="mt-8 text-xs leading-5 text-zinc-500">Methodology: timing varies with network and provider load. Agreement shows consistency between approaches, not correctness; accuracy requires labeled ground truth. OpenAI model: {result?.model ?? "configured by OPENAI_MODEL"}.</p>
  </div></main>;
}
