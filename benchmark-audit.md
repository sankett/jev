# Benchmark audit — 2026-10-17

Subsequent model update: the app now defaults to the explicitly pinned
`jev-1.14.0`, as requested. The historical measurements discussed below used
`jev-1.13.0`; retain that model distinction when comparing runs.

The application is a comparison of three application workflows on a supplied
input. Its three-trial support benchmark is a repeated-input request-time and
label-repeatability check. It is not an accuracy evaluation or an isolated measure
of model inference speed.

## What the attached result establishes

| Workflow | Mean request time | Median request time | Total cost shown for 3 calls |
| --- | ---: | ---: | ---: |
| Jev | 331 ms | 314 ms | $0.000066 |
| OpenAI explanation | 1,446 ms | 1,399 ms | $0.000257 |
| Microsoft-Decision-1 through OpenRouter | 1,044 ms | 693 ms | $0.000026 |

Jev had the shortest observed requests in this run. Microsoft had the lowest
reported/estimated request cost. Microsoft's mean above its median indicates a
slower request affected the mean; the screenshot does not show its exact duration
or cause. These observations do not establish a general speed or quality ranking.

100% stability means all successful trials agreed on category, rounded urgency,
and the thresholded human-review label. Probability distributions, raw scores,
and explanations may still differ, and all three repeated answers can be wrong.
No human-labeled expected answers are present in this benchmark. Three repeats
of one input cannot establish reliability, tail latency, accuracy, or calibration.
The combined pairwise-agreement percentage averages category, rounded urgency,
human review, and the derived routing action. These are not four independent
quality measurements; the application action depends on the other labels.

## Code checked and corrections made

- **Statistics:** Arithmetic mean and sorted median were correct. A regression
  fixture now reproduces the displayed means/medians using representative inputs;
  these fixture timings are not the original unrecorded raw measurements.
  Successful requests form the latency denominator. Pairwise agreement excludes
  failed pairs. Unknown costs remain unavailable, rather than zero. Repeatability
  now requires at least two successful results.
- **Question parity:** Jev and Microsoft already shared identical state, questions,
  and scoring. OpenAI had abbreviated urgency descriptions and no matching
  human-review criterion. Its explanation prompt now includes the complete shared
  rubric. It still selects a discrete urgency level and writes prose, while the
  decision models return a probability-weighted score. This remains a comparison
  of different workflows/output work, rather than equal model-compute workloads.
- **Parsing:** The original OpenAI regex could accept `Urgency: 2.5` as `2` or
  accept the first of contradictory duplicate labels. Complete-line validation
  now rejects fractional, invalid, missing, or duplicate labels. Score answers
  are also checked for consistency with their reported distributions, allowing
  rounding tolerance.
- **Cost:** The OpenAI estimator was duplicated and omitted cache-write charges.
  One shared estimator now handles ordinary input, cache reads, cache writes,
  total output tokens (including reasoning when present), and long-context
  multipliers. Standard processing is requested explicitly; unexpected tiers and
  unknown model prices are not guessed. Cache counts are exposed. Estimated
  rates exclude account discounts and regional/account surcharges; provider
  invoices remain authoritative. Microsoft reported cost takes precedence over
  a token-price estimate. Different provider tokenizers and billable token counts
  can produce different costs even at the same advertised per-token rate.
- **Execution:** Evaluation retries remain disabled with 60-second timeouts.
  Providers run concurrently, and trials run sequentially. Launch order now
  rotates so each provider starts first once. There are no excluded warm-up calls;
  connection setup, network load, and provider caches can affect results.
- **Traceability:** Results record a protocol version and timestamp, expose every
  trial's timings, tokens, models and cost source, and allow inspection of each
  trial's decisions/prompts. Jev defaults to the known `jev-1.13.0` version via
  `JEV_MODEL`. Other provider aliases may change; returned versions must be
  checked when comparing runs. The revised support protocol is
  `support-v2-shared-rubric`; old and new prompt results should not be pooled.
- **Resume evidence:** Reviewed requirement IDs must now appear exactly once in
  OpenAI results; missing, duplicate or unexpected IDs fail that branch. Its
  Choice instructions explicitly use the target option. Positive Jev/Microsoft
  assessments now require a sufficiently confident evidence selection as well as
  an exact source quote. Extraction remains separately measured and now also uses
  one attempt with a 60-second timeout.

## Limits retained explicitly

The timing uses a monotonic server clock around each branch. It includes SDK
construction, network, provider processing, answer parsing and validation. It
excludes the request's transfer back to the browser and cannot separate GPU/model
inference from provider queueing or network time. The differing transport paths
(direct TypeSafe, direct OpenAI, and OpenRouter to Azure) are part of the measured
workflows. Concurrent calls are not a throughput measurement.

Resume evaluation also compares different evidence-retrieval methods: Jev and
Microsoft select from a shared bounded lexical candidate set; OpenAI can quote
from the full supplied resume and generates explanations. A verified quotation
establishes that the text exists, not that it entails the requirement. Candidate
recall and thresholds require evaluation on labeled examples. The displayed
weighted match range is a deterministic scoring convention, not a statistical
confidence interval or a candidate suitability probability.

For a defensible model-quality comparison, collect representative tickets with
independently reviewed expected labels, freeze rubric/model versions, and measure
per-field correctness and consequential routing errors separately. For request
performance, use more observations across varied inputs and times, disclose cache
and warm-up policy, and retain raw durations before reporting tail percentiles.
No new accuracy claims or invented ground-truth labels were added in this audit.

## Sources checked

- [OpenAI GPT-5.6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI cache read/write accounting](https://developers.openai.com/api/docs/guides/prompt-caching)
- [TypeSafe request/response contracts](https://docs.typesafe.ai/api)
- [Microsoft model, pricing and transport](https://openrouter.ai/microsoft/microsoft-decision-1)

Regression coverage includes shared rubrics, strict output parsing, independent
known-value statistics, failed/zero-success denominators, cache accounting,
concurrent/rotating execution, invalid probability answers, and resume evidence
validation. Passing these tests validates implementation behavior; it does not
validate model correctness on the user's production data.

Verification after the corrections: all 35 tests, ESLint, TypeScript, and the
production build passed. A production-browser run completed all nine support
requests successfully, displayed the raw trials, and switched between individual
trials. Mobile viewport checking found no document-level horizontal overflow.
Live evaluation of the synthetic resume returned seven results from each provider,
with every returned evidence quote present in the source. These are integration
checks, rather than a labeled model-quality evaluation.
