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

2. Copy `.env.example` to `.env.local` and set both provider keys:

   ```env
   TYPESAFE_API_KEY=your_typesafe_api_key
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_MODEL=gpt-5.6-luna
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The browser calls `/api/compare`. The page compares JEV and OpenAI independently on category, urgency, and human-review decisions. Use “Compare once” for an immediate pair or “Run 3-trial benchmark” for latency, stability, token, and agreement metrics. Both keys are server-only.

## Resume Evaluation

Open `/resume-evaluation` to use the preloaded sample job description and resume, or replace them with your own text, then click **Identify requirements**. OpenAI extracts requirements from the JD only; each retained requirement must have an exact source quote. Review its wording, importance, criterion, and Noul/Score/Choice type before clicking **Evaluate resume**. Choice is for one primary category among competing options, such as the sample's primary deployment platform. Requirements marked unspecified must be resolved first.

JEV evaluates each requirement with a typed Noul, Score, or Choice judgment and uses a separate Choice to select an exact resume excerpt from candidates. OpenAI independently returns a structured evaluation for the same reviewed requirements. The app verifies displayed resume quotes against the pasted resume. The application computes weighted summary ranges in TypeScript (mandatory weight 2, preferred weight 1); uncertain items expand the range. Provider latency and input/output tokens are shown separately, with the shared extraction call shown above the comparison. No hiring or rejection decision is produced.
