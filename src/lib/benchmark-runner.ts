import { PROVIDERS, PROVIDER_LABELS, type Provider } from "./providers.ts";
import { trialAgreements, type BranchResult, type Trial } from "./comparison.ts";

export async function runBenchmark(runs: 1 | 3, run: (provider: Provider) => Promise<BranchResult>): Promise<Trial[]> {
  const trials: Trial[] = [];
  for (let index = 0; index < runs; index++) {
    // Each provider starts first once across three trials. Requests still run
    // concurrently; the next trial starts only after every provider settles.
    const executionOrder = [...PROVIDERS.slice(index), ...PROVIDERS.slice(0, index)];
    const entries = await Promise.all(executionOrder.map(async (provider) => {
      let result: BranchResult;
      try { result = await run(provider); }
      catch { result = { status: "error", error: `${PROVIDER_LABELS[provider]} benchmark branch failed.` }; }
      return [provider, result] as const;
    }));
    const trial = { ...Object.fromEntries(entries), executionOrder } as unknown as Trial;
    const pairwiseAgreement = trialAgreements(trial);
    trials.push({ ...trial, pairwiseAgreement, agreement: pairwiseAgreement["jev-openai"] });
  }
  return trials;
}
