import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { MODEL_LADDER, availableTiers, decide } from "./core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { loadEnvConfig } = nextEnv;
const dataDir = resolve(root, ".jev-router");
const stateFile = resolve(dataDir, "state.json");
const config = JSON.parse(readFileSync(resolve(root, "router/config.json"), "utf8"));
const command = process.argv[2] ?? "status";
const emit = (value) => console.log(JSON.stringify(value, null, 2));
const freshState = () => ({ enabled: false, updatedAt: null });

function readState() {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    return { ...state, enabled: state.enabled === true };
  } catch { return freshState(); }
}

function setEnabled(enabled) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2));
}

function saveEvent(event) {
  // One file per event avoids counters being lost by simultaneous messages.
  mkdirSync(resolve(dataDir, "events"), { recursive: true });
  writeFileSync(resolve(dataDir, "events", `${randomUUID()}.json`), JSON.stringify({ at: new Date().toISOString(), ...event }));
}

function events() {
  try {
    return readdirSync(resolve(dataDir, "events")).flatMap((file) => {
      try { return [JSON.parse(readFileSync(resolve(dataDir, "events", file), "utf8"))]; } catch { return []; }
    });
  } catch { return []; }
}

function connection(transport = config.transport) {
  loadEnvConfig(root, false, { info() {}, error() {} });
  const openrouter = transport === "openrouter";
  const apiKey = process.env[openrouter ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY"];
  if (!apiKey) throw new Error("Missing routing credentials");
  return {
    transport,
    client: new TypeSafeClient({
      apiKey,
      baseURL: openrouter ? "https://openrouter.ai/api" : "https://api.typesafe.ai",
      defaultModel: openrouter ? "typesafe/jev-1.13" : "jev-1.13.0",
      retry: { maxRetries: 0 },
      logLevel: "off",
    }),
  };
}

async function classify(message, enabled, timeoutMs, contextualReply = false, transport = config.transport) {
  let calls = 0;
  const started = performance.now();
  const result = await decide({
    message, enabled, contextualReply, timeoutMs,
    tiers: availableTiers(config.models),
    askJev: async (request, signal) => {
      const { client } = connection(transport);
      calls++;
      return client.systemOne(request, { signal, timeout: timeoutMs, retry: { maxRetries: 0 } });
    },
  });
  const { jev, ...decision } = result;
  const tokens = jev?.usage?.input_tokens;
  return {
    ...decision, id: randomUUID(), transport,
    latencyMs: Math.round(performance.now() - started), calls,
    inputTokens: Number.isFinite(tokens) && tokens >= 0 ? tokens : null,
    costUsd: Number.isFinite(tokens) && tokens >= 0 ? tokens * 0.042 / 1_000_000 : null,
    jevModel: jev?.model ?? null,
  };
}

function status() {
  const records = events();
  const decisions = records.filter((item) => item.kind === "decision");
  const deliveries = new Map(records.filter((item) => item.kind === "delivered").map((item) => [item.id, item]));
  const routed = Object.fromEntries(MODEL_LADDER.map(({ size }) => [size, 0]));
  for (const item of deliveries.values()) routed[item.size]++;
  return {
    ...readState(), transport: config.transport, timeoutMs: config.timeoutMs,
    models: availableTiers(config.models), routed,
    evaluatedMessages: decisions.length,
    parentHandled: decisions.filter((item) => item.action === "parent").length,
    jevCalls: records.reduce((sum, item) => sum + (item.calls ?? 0), 0),
    estimatedJevCostUsd: records.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
    testJevCostUsd: records.filter((item) => item.kind === "diagnostic").reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
    unpricedCalls: records.filter((item) => item.calls > 0 && item.costUsd === null).length,
    costNote: "Estimate from reported input tokens at $0.042/M; output free. Timed-out or failed requests may still be billed. Helper/main-model usage is separate. Live diagnostics count toward cost but not routed-message totals. Setup attempts before accounting was installed are not included.",
  };
}

async function main() {
  if (command === "on" || command === "off") {
    setEnabled(command === "on");
    emit(status());
  } else if (command === "status") {
    emit(status());
  } else if (command === "decide") {
    const fileIndex = process.argv.indexOf("--file");
    const input = fileIndex >= 0
      ? JSON.parse(readFileSync(resolve(root, process.argv[fileIndex + 1]), "utf8"))
      : JSON.parse(readFileSync(0, "utf8"));
    const decision = await classify(input.message, readState().enabled, config.timeoutMs, input.contextualReply === true);
    try { saveEvent({ kind: "decision", ...decision }); } catch { /* Preserve the decision if bookkeeping fails. */ }
    emit(decision);
  } else if (command === "delivered") {
    const id = process.argv[3];
    const decision = events().find((item) => item.kind === "decision" && item.id === id && item.action === "delegate");
    if (!decision) throw new Error("Unknown delegation");
    saveEvent({ kind: "delivered", id, size: decision.size, model: decision.model });
    emit({ recorded: true });
  } else if (command === "test-live") {
    // Explicit diagnostics authorize these public samples even while normal routing is OFF.
    const samples = JSON.parse(readFileSync(resolve(root, "router/samples.json"), "utf8"));
    const diagnostic = process.argv.includes("--diagnostic");
    const deadline = diagnostic ? 5000 : config.timeoutMs;
    const rows = [];
    for (const sample of samples) {
      const decision = await classify(sample.message, true, deadline);
      const operationalAction = decision.latencyMs > config.timeoutMs ? "parent (timeout)" : decision.action;
      const row = { ...sample, ...decision, operationalAction };
      rows.push(row);
      try { saveEvent({ kind: "diagnostic", ...decision }); } catch { /* Keep testing. */ }
      emit({ sample: sample.label, ...decision, operationalAction });
    }
    writeFileSync(resolve(root, diagnostic ? "router/live-results.json" : "router/deadline-results.json"), JSON.stringify({ testedAt: new Date().toISOString(), routingEnabled: readState().enabled, timeoutMs: deadline, operationalTimeoutMs: config.timeoutMs, rows }, null, 2));
  } else {
    emit({ error: "Commands: on, off, status, decide [--file file.json], delivered <decision-id>, test-live" });
  }
}

main().catch(() => {
  // Never print SDK exceptions or credentials, and never prevent the main handler.
  emit({ action: "parent", reason: "router_failure", enabled: readState().enabled });
});
