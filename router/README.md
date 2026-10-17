# Jev workspace router

The router is OFF by default. In this workspace's Codex conversation, say:

- **Jev router on**
- **Jev router off**
- **Jev router status**

The same controls work in PowerShell as `npm.cmd run router -- on`, `off`, or
`status`. Node.js 22.19+ is needed for the router command's system certificate store
support. Existing application scripts and credentials are unchanged.

## Routing

| Size | Verified helper model |
| --- | --- |
| tiny | gpt-6-luna |
| everyday | gpt-6-sol |
| large | gpt-6.1-sol |
| hardest | gpt-6-astra |

These models were exposed by this session's spawn tool and each was smoke tested.
The ladder ranks their intended capability; it does not assert measured per-token
prices or prove that delegation saves subscription usage. Sol is the previous
workhorse and 6.1 Sol is the current workhorse, so their distinction is capability
rather than a verified billing discount.

Each independent message gets exactly one Choice question: the smallest size that
can do the job well. Confidence below 60%, context-dependent replies, unavailable
models, invalid responses, network errors and the 1000 ms deadline use the primary
agent. No retries. Fewer configured available models means fewer choices; missing
workload sizes are assigned to the next larger model, or largest remaining model.

Helpers are described in `agents/*.toml` and invoked explicitly by the primary
agent according to the root `AGENTS.md`. These files are recipes, not installed
native custom-agent configurations. The current session has already smoke tested
one helper per size; a future session can instantiate them on demand.

## Limits and privacy

The running primary model cannot be swapped before an incoming message. This
workflow delegates work after it reaches the primary model. It applies only in
this workspace and depends on the primary agent following `AGENTS.md`; it does
not intercept every chat in ChatGPT. There is added orchestration overhead, and
zero extra latency cannot be guaranteed. A fast Jev result is needed to route;
otherwise the existing handler proceeds. Helper failures also return to it.

The default uses the existing direct **TypeSafe** key because no OpenRouter key
was configured. In this mode eligible messages go directly to TypeSafe, Jev's
maker. To use OpenRouter, set `OPENROUTER_API_KEY` in `.env.local` and change
`transport` in `config.json` to `openrouter`. Then eligible messages pass through
OpenRouter to TypeSafe via the official TypeSafe SDK compatibility endpoint.
Never send a TypeSafe key to OpenRouter. Leave it OFF for private work.

The ledger contains decisions and usage, not message text. Temporary input files
are private workspace files and should be removed after the CLI consumes them.
Helpers receive the context needed for the task; Jev receives only message text
and the size rubric.

## Status and tests

Status counts **delivered** helper responses separately from classification
attempts. Estimated Jev cost uses reported input tokens at $0.042 per million;
output is free. It includes recorded live diagnostics, but excludes the primary
and helper models. Unpriced failed/time-out requests may still be billed, so this
is not an invoice total. Setup attempts before the ledger existed are excluded.

`npm.cmd test` runs deterministic behavior tests without network access.
`npm.cmd run router -- test-live` checks the normal 1000 ms policy on eight public
samples plus two context replies while remaining OFF.
`npm.cmd run router -- test-live --diagnostic` gives only the public samples a
5-second deadline so real choices and confidence can be inspected even on a
high-latency connection. The diagnostic report separately indicates whether each
result would have met the normal 1000 ms deadline. Context replies make no API call.
Diagnostics classify samples; they do not execute the large/high-stakes jobs.

See `live-results.json` for the real Jev choices and `deadline-results.json` for
the normal policy. Both are explicitly public sample artifacts.

References: [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice),
[TypeSafe model pricing](https://docs.typesafe.ai/models),
[OpenRouter TypeSafe SDK](https://openrouter.ai/docs/guides/community/typesafe-sdk),
[official OpenAI subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
