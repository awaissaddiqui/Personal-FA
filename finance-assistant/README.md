# Finance Assistant

An AI-powered personal finance companion. Upload your transaction history, chat with your data in natural language, detect subscriptions, track budgets, and get personalized spending insights.

---

## Setup

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier is fine)
- An [OpenAI](https://platform.openai.com) API key with GPT-4o access

### 1. Clone and install

```bash
git clone <repo-url>
cd finance-assistant
npm install
```

### 2. Configure environment

Fill in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres.your-ref:password@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.your-ref:password@aws-0-region.pooler.supabase.com:5432/postgres
OPENAI_API_KEY=sk-...
```

> Get `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) from Supabase → Settings → Database → Connection strings.

### 3. Set up the database

```bash
npx prisma migrate dev --name init
```

### 4. Create Supabase Storage bucket

In Supabase dashboard → Storage → New bucket named `receipts` (private).

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Architecture & Design Decisions

### The core insight: not all requests are equal

The 10 assistant capabilities require very different amounts of compute:

| Request type | What it actually needs | Approach |
|---|---|---|
| "How much on groceries last month?" | A SQL query | SQL → format with gpt-4o-mini |
| "Am I spending more than usual?" | Statistical comparison across months | Pre-aggregated data → gpt-4o |
| Receipt photo upload | Image understanding | gpt-4o Vision |
| "What is AMZN MKTP?" | Merchant identification | Cache lookup → gpt-4o-mini fallback |
| Subscription detection | Pattern recognition | Pure algorithm (interval analysis) |
| "Remember I get paid on the 1st" | Structured fact extraction | gpt-4o-mini async after response |

A weak candidate calls gpt-4o for every request. This design routes each request to the cheapest sufficient tool.

---

### Why pre-aggregate instead of sending raw transactions

A user with 3 years of history may have 10,000–50,000 transactions. Sending these to an LLM is expensive (~$0.50/query), slow, and unreliable. Instead, a background job runs after every CSV import and computes `monthly_aggregates`: total spent + count + average per category per month. A 50,000-row history becomes ~600 rows (~1,000 tokens).

When the user asks "am I spending more than usual?", the assistant calls `get_monthly_aggregates(12)` and the LLM compares 12 months of category summaries — full accuracy at a fraction of the cost.

---

### Intent routing — fast path first

Before calling OpenAI for classification, the router runs a regex pre-check against ~12 patterns. Most common questions are classified in <1ms with no API call. Only ambiguous messages hit the GPT-4o-mini classifier (max 30 tokens, ~$0.000005/classification).

Model selection:
- **gpt-4o-mini** — simple lookups, budget checks, subscriptions, merchant lookup, memory extraction
- **gpt-4o** — trend analysis, financial summaries, cut-back suggestions

---

### Subscription detection: algorithm, not LLM

Subscription detection is a pure statistical algorithm:
1. Normalize merchant names (strip location codes, digits, punctuation)
2. Group transactions by normalized merchant
3. Compute intervals between charges, find dominant period (weekly/monthly/quarterly/annual) with ±25% tolerance
4. Score confidence: regularity ratio + amount variance

No LLM call. Faster, cheaper, and scales to 100,000 transactions for free.

---

### Anomaly detection: z-score baseline

Per-user, per-category baseline (mean + stddev) over rolling 6-month history. Z > 2.0 with spend > $20 triggers an alert. Explainable to users ("you spent 2.3× your usual amount on dining"), personalized, and computable from existing aggregate data.

---

### User memory: structured + free-form

When users say "I get paid on the 1st" or "don't count rent in food budget", a gpt-4o-mini call (async, never blocks the response) extracts structured facts with type/key/value/tags. Conflicts are resolved by superseding the old fact. Top 10 active memories are injected into every system prompt.

---

### Receipt processing pipeline

1. File validation → Supabase Storage upload → signed URL for GPT-4o Vision
2. Structured JSON extraction with confidence score (0–1)
3. Auto-create Transaction if confidence ≥ 0.7; flag for review if 0.5–0.7; fail if < 0.5

Handles blurry images, rotations, partial receipts, foreign languages via the vision prompt instructions.

---

## What Was Built

| Feature | Status | Notes |
|---|---|---|
| Auth (signup/login/logout) | ✅ Complete | Supabase Auth |
| CSV import with dedup | ✅ Complete | Hash-based dedup, flexible column detection |
| AI chat with streaming | ✅ Complete | Agentic loop, max 5 tool iterations |
| Intent routing | ✅ Complete | Regex fast path + gpt-4o-mini fallback |
| Spending queries | ✅ Complete | `query_transactions` tool |
| Historical comparison | ✅ Complete | `get_monthly_aggregates` tool |
| Receipt OCR | ✅ Complete | GPT-4o Vision, confidence scoring |
| Subscription detection | ✅ Complete | Pure algorithm, no LLM |
| Anomaly detection | ✅ Complete | Z-score against rolling baseline |
| User memory | ✅ Complete | Async extraction, conflict resolution |
| Budget tracking | ✅ Complete | Per-category monthly limits |
| Merchant lookup | ✅ Complete | Cache + gpt-4o-mini (web search stubbed) |
| Dashboard | ✅ Complete | Monthly summary, top categories |

## What Was Simplified

**Merchant web search** — Production would use Brave Search API or Tavily. Current implementation uses gpt-4o-mini's training data and caches results for 30 days. The cache table and TTL logic are in place for a drop-in replacement.

**Proactive anomaly alerts** — Detection runs on user request. Production would run nightly via Vercel Cron with push notifications via Supabase Realtime.

## What Was Intentionally Skipped

**Live bank API integration** — The brief provides a CSV sample. Plaid integration is a well-defined task but not the architecturally interesting part.

**Multi-currency** — Adds FX rate API dependency and significant edge cases. Receipts return detected currency; bank transactions assumed USD.

## Key Trade-offs

**Cost vs. quality** — gpt-4o-mini for classification saves ~20× on API costs at slight quality expense on nuanced questions. The router escalates to gpt-4o only when synthesis is genuinely needed.

**Pre-computation vs. flexibility** — Monthly aggregates are fast and cheap but require a recompute job after imports. Raw queries would be more flexible but make LLM context management much harder at scale.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL (Supabase) |
| ORM | Prisma 7 |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| AI | OpenAI gpt-4o + gpt-4o-mini |
| Deployment | Vercel |

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
