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
