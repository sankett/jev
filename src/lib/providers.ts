export const PROVIDERS = ["jev", "openai", "microsoft"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type DecisionProvider = Exclude<Provider, "openai">;
export const DEFAULT_JEV_MODEL = "jev-1.14.0";
export const MICROSOFT_MODEL = "microsoft/microsoft-decision-1";
export const EVALUATION_TIMEOUT_MS = 60_000;
export const PROVIDER_LABELS: Record<Provider, string> = {
  jev: "JEV", openai: "OpenAI", microsoft: "Microsoft-Decision-1",
};
export const TRANSPORTS: Record<Provider, string> = {
  jev: "TypeSafe direct", openai: "OpenAI direct", microsoft: "OpenRouter → Azure",
};
export type ProviderMetadata = { model?: string; transport?: string };
