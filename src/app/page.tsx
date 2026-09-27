"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

const EXAMPLES = [
  ["Billing issue", "I was charged twice for my subscription this morning. Please refund the duplicate payment as soon as possible."],
  ["Technical issue", "The dashboard has been showing a blank screen since yesterday. I already cleared my cache and tried another browser."],
  ["Cancellation", "Please cancel my plan at the end of this billing period. I no longer need the service."],
];

type Decision = { category: string; urgency: number; needsHuman: boolean };
type Provider = "jev" | "openai";
type Branch = {
  status: "success" | "error" | "pending";
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
  completionOrder?: Provider[];
  summary?: {
    averageLatencyMs: { jev: number; openai: number };
    medianLatencyMs: { jev: number; openai: number };
    decisionStability: { jev: number; openai: number };
    crossApproachAgreement: number;
  };
};

const pct = (value?: number) => value == null ? "—" : Math.round(value * 100) + "%";
const ms = (value?: number) => value == null ? "—" : Math.round(value) + " ms";

function trialAgreement(trial: Trial): Record<string, boolean> | undefined {
  const { jev, openai } = trial;
  if (jev.status !== "success" || openai.status !== "success" || !jev.decision || !openai.decision || !jev.action || !openai.action) return undefined;
  return {
    category: jev.decision.category === openai.decision.category,
    urgency: Math.round(jev.decision.urgency) === Math.round(openai.decision.urgency),
    needsHuman: jev.decision.needsHuman === openai.decision.needsHuman,
    action: jev.action === openai.action,
  };
}

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

function Card({ title, branch, jev, model }: { title: string; branch: Branch; jev?: boolean; model?: string }) {
  const decision = branch.decision;
  return <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-2xl">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className={"rounded-full px-2.5 py-1 text-xs " + (branch.status === "success" ? "bg-emerald-400/10 text-emerald-300" : branch.status === "pending" ? "bg-zinc-800 text-zinc-300" : "bg-rose-400/10 text-rose-300")}>{branch.status}</span>
    </div>
    {(branch.timing || branch.estimatedCostUsd != null) && <div className="mb-5 mt-3 flex flex-wrap gap-2">
      <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-2">
        <span className="block text-xs text-fuchsia-200">Latency</span>
        <strong className="text-base tabular-nums text-zinc-100">{ms(branch.timing?.totalMs)}</strong>
      </div>
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
        <span className="block text-xs text-zinc-400">Estimated cost</span>
        <strong className="text-base tabular-nums text-zinc-100">{branch.estimatedCostUsd != null ? `$${branch.estimatedCostUsd.toFixed(6)}` : "Unavailable"}</strong>
      </div>
      {!jev && model && <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2">
        <span className="block text-xs text-sky-200">OpenAI model</span>
        <strong className="text-base text-zinc-100">{model}</strong>
      </div>}
    </div>}
    {branch.error ? <div className="space-y-4">
      <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-200">{branch.error}</div>
      <PromptDetails branch={branch} expanded={!jev} />
    </div> : decision ?
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div><div className="label">Category</div><div className="value">{decision.category}</div></div>
          <div><div className="label">Urgency</div><div className="value">{decision.urgency.toFixed(1)}</div></div>
          <div><div className="label">Human review</div><div className="value">{decision.needsHuman ? "Yes" : "No"}</div></div>
        </div>
        <div><div className="label">Application routing</div><p className="text-sm text-zinc-200">{branch.action}</p></div>
        <PromptDetails branch={branch} expanded={!jev} />
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
      </div> : <p className="text-sm text-zinc-500">No result.</p>}
  </section>;
}

export default function Home() {
  const [message, setMessage] = useState(EXAMPLES[0][1]);
  const [result, setResult] = useState<Comparison>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runOnce() {
    const initial: Comparison = {
      model: "",
      requestedRuns: 1,
      trials: [{ jev: { status: "pending" }, openai: { status: "pending" } }],
      completionOrder: [],
    };
    setResult(initial);
    let revealQueue = Promise.resolve();
    let revealedCount = 0;
    function reveal(provider: Provider, branch: Branch, model?: string) {
      revealQueue = revealQueue.then(async () => {
        if (revealedCount > 0) await new Promise((resolve) => setTimeout(resolve, 450));
        setResult((current) => {
          const state = current ?? initial;
          const trial = { ...state.trials[0], [provider]: branch };
          return {
            ...state,
            model: model ?? state.model,
            trials: [{ ...trial, agreement: trialAgreement(trial) }],
            completionOrder: state.completionOrder?.includes(provider) ? state.completionOrder : [...(state.completionOrder ?? []), provider],
          };
        });
        revealedCount += 1;
        if (revealedCount === 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      return revealQueue;
    }
    async function runProvider(provider: Provider) {
      try {
        const response = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, runs: 1, provider }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `${provider} comparison failed`);
        await reveal(provider, data.branch as Branch, data.model as string);
      } catch (cause) {
        await reveal(provider, { status: "error", error: cause instanceof Error ? cause.message : `${provider} comparison failed` });
      }
    }
    await Promise.all([runProvider("jev"), runProvider("openai")]);
  }

  async function run(runs: 1 | 3) {
    setLoading(true);
    setError("");
    try {
      if (runs === 1) {
        await runOnce();
        return;
      }
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
  const displayedProviders: Provider[] = result?.completionOrder ?? ["jev", "openai"];
  return <main className="min-h-screen bg-[#0c0a0f] px-5 py-10 text-zinc-100"><div className="mx-auto max-w-6xl">
    <Link href="/resume-evaluation" className="float-right rounded-full border border-fuchsia-400/50 px-4 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-400/10">Resume Evaluation →</Link>
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
      {result?.requestedRuns === 1 && <p className="mt-8 text-sm text-zinc-400">{displayedProviders.length === 0 ? "JEV and OpenAI are running…" : displayedProviders.length === 1 ? `Showing ${displayedProviders[0] === "jev" ? "JEV" : "OpenAI"} first; the other result will appear shortly.` : `Finished first: ${displayedProviders[0] === "jev" ? "JEV" : "OpenAI"}.`}</p>}
      <div className="mt-4 grid gap-5 md:grid-cols-2">{displayedProviders.map((provider) => <Card key={provider} title={provider === "jev" ? "JEV" : "OpenAI"} branch={trial[provider]} jev={provider === "jev"} model={provider === "openai" ? result?.model : undefined} />)}</div>
      {trial.agreement && <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="label">Agreement for this trial</div>
        <div className="mt-3 flex flex-wrap gap-2">{Object.entries(trial.agreement).map(([key, value]) => <span key={key} className={"rounded-full px-3 py-1 text-xs " + (value ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>{key}: {value ? "match" : "different"}</span>)}</div>
      </div>}
    </>}
    {result?.summary && result.requestedRuns === 3 && <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-lg font-semibold">Benchmark summary</h2>
      <p className="mt-1 text-xs text-zinc-500">JEV / OpenAI</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat">Average latency<br /><b>{ms(result.summary.averageLatencyMs.jev)} / {ms(result.summary.averageLatencyMs.openai)}</b></div>
        <div className="stat">Median latency<br /><b>{ms(result.summary.medianLatencyMs.jev)} / {ms(result.summary.medianLatencyMs.openai)}</b></div>
        <div className="stat">Stability<br /><b>{pct(result.summary.decisionStability.jev)} / {pct(result.summary.decisionStability.openai)}</b></div>
        <div className="stat">Cross-approach agreement<br /><b>{pct(result.summary.crossApproachAgreement)}</b></div>
      </div>
    </section>}
    <p className="mt-8 text-xs leading-5 text-zinc-500">Methodology: timing varies with network and provider load. Agreement shows consistency between approaches, not correctness; accuracy requires labeled ground truth. OpenAI model: {result?.model || "configured by OPENAI_MODEL"}.</p>
  </div></main>;
}
