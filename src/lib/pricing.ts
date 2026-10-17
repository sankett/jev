// Standard, short-context USD / million tokens. Checked against official model
// pages on 2026-10-17. Estimates exclude account-specific discounts and surcharges.
export const OPENAI_TOKEN_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

export function openaiPricing(model: string) {
  return OPENAI_TOKEN_PRICING[model.toLowerCase().replace(/-\d{4}-?\d{2}-?\d{2}$/, "")];
}

export function estimateOpenaiCost(
  model: string, input: number | undefined, cached: number | undefined,
  output: number | undefined, cacheWrite = 0, serviceTier = "default",
): number | undefined {
  const price = openaiPricing(model);
  if (!price || input == null || output == null || serviceTier !== "default") return undefined;
  const reads = cached ?? 0;
  if (![input, output, reads, cacheWrite].every((value) => Number.isSafeInteger(value) && value >= 0) || reads + cacheWrite > input) return undefined;
  const inputMultiplier = input > 272_000 ? 2 : 1;
  const outputMultiplier = input > 272_000 ? 1.5 : 1;
  return ((input - reads - cacheWrite) * price.input * inputMultiplier
    + reads * price.cachedInput * inputMultiplier
    + cacheWrite * price.input * 1.25 * inputMultiplier
    + output * price.output * outputMultiplier) / 1_000_000;
}
