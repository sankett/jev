# JEV Decision Lab

A small Next.js and TypeScript application demonstrating the three JEV question types against one shared support-ticket state:

- **Choice** classifies the ticket.
- **Score** measures its urgency against an ordered rubric.
- **Noul** estimates whether human review is needed.

## Run locally

The app requires Node.js 20.9 or newer.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set the three server-only provider keys:

   ```env
   TYPESAFE_API_KEY=your_typesafe_api_key
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_MODEL=gpt-5.6-luna
   OPENROUTER_API_KEY=your_openrouter_api_key
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The browser calls `/api/compare`. The page compares JEV, OpenAI, and [Microsoft-Decision-1](https://openrouter.ai/microsoft/microsoft-decision-1) independently on category, urgency, and human-review decisions. Use “Compare once” for three concurrent requests or “Run 3-trial benchmark” for three sequential trials, each running all providers concurrently. Cards appear as requests settle without a presentation delay. Server request duration and browser completion order are distinct measurements.

JEV uses TypeSafe directly; OpenAI uses its Responses API directly; Microsoft uses OpenRouter's `POST https://openrouter.ai/api/alpha/decisions` with model `microsoft/microsoft-decision-1`. JEV and Microsoft share identical state, typed questions, answer validation, and application scoring. OpenAI retains its generated explanation baseline. Each card identifies the returned model (when supplied), transport, token usage, and reported or estimated cost. Microsoft input costs are estimated at $0.042 per million tokens with free output when reported cost is unavailable; pricing can change. No provider is silently substituted.

All comparison/evaluation requests have a 60-second timeout and no automatic retries. A missing key or a failed provider produces its own error without discarding other results. Microsoft context-limit errors identify its 32,768-token limit; inputs and evidence are never silently truncated. All keys stay on the server.

On a corporate network where Node reports `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, use the machine's trusted certificate store rather than disabling TLS verification. With a Node version supporting system CAs, start from PowerShell with `$env:NODE_OPTIONS='--use-system-ca'`, then `npm run dev`.

## Resume Evaluation

Open `/resume-evaluation` to use the preloaded sample job description and resume, or replace them with your own text, then click **Identify requirements**. OpenAI extracts requirements from the JD only; each retained requirement must have an exact source quote. Review its wording, importance, criterion, and Noul/Score/Choice type before clicking **Evaluate resume**. Choice is for one primary category among competing options, such as the sample's primary deployment platform. Requirements marked unspecified must be resolved first.

JEV and Microsoft independently evaluate each requirement with a typed Noul, Score, or Choice judgment and use a separate Choice to select an exact resume excerpt from candidates. OpenAI independently returns a structured evaluation for the same reviewed requirements. The app verifies displayed resume quotes against the pasted resume. The application computes weighted summary ranges in TypeScript (mandatory weight 2, preferred weight 1); uncertain items expand the range. Provider latency and input/output tokens are shown separately, with the shared extraction call shown above the comparison. JEV and Microsoft use the same evidence candidates, quote verification, thresholds, and deterministic aggregation. These comparison thresholds do not establish equal calibration. No hiring or rejection decision is produced.

## Checks

Run `npm run lint` and `npm run build` to check the app. Run `npm test` with Node.js 22.6 or newer for the regression tests (the test runner uses built-in TypeScript stripping).

Benchmark stability is the fraction of successful trials matching the most common decision, using rounded urgency. Failed trials are excluded. Pairwise agreement is reported for JEV/OpenAI, JEV/Microsoft, and OpenAI/Microsoft, using only trials where both providers succeeded. With no eligible results, metrics are unavailable rather than zero. Cost totals are unavailable if any trial's cost is unknown. Agreement and three repetitions measure consistency; labeled ground truth is needed to establish accuracy.

The audited `support-v2-shared-rubric` protocol supplies the full Jev/Microsoft rubric to OpenAI while preserving its explanation output. Provider launch order rotates across the three trials. The page exposes individual trials, raw timing/token/model details, min–max duration, cost per request, and the exact repeatability definition. Fewer than two successful calls cannot establish repeatability. All displayed durations are server branch wall time, not isolated model inference. OpenAI standard-rate estimates include cache writes and use one shared pricing implementation across both pages. `JEV_MODEL` defaults to `jev-1.14.0`; returned model IDs are recorded for checking reproducibility. Old and new prompt results should not be pooled. See [benchmark-audit.md](benchmark-audit.md) for findings, fixes, and remaining evaluation limits.
