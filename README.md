# InstantRailCheck

**Know before you transfer.**

Crowdsourced database of real-world bank transfer compatibility across RTP, FedNow, ACH, Wire, Zelle, and more.

Live at [instantrailcheck.com](https://www.instantrailcheck.com)

## What it does

- Search any two US banks to see which payment rails work between them
- View success rates, average settlement times, and data freshness
- Submit your own real transfer outcomes to improve the database
- Accounts via magic link — no password required
- Bank profile pages with website, address, and phone auto-filled from FDIC, NCUA, and FINRA
- FedNow, RTP, and Zelle network participation, verified against official/semi-official directories where available
- Visa Direct and Mastercard Send tracked as community-reported (no official directory exists for either)
- Compare two banks side by side
- Settlement time leaderboard and a changelog of recent activity
- Public read-only API — see [/developers](https://www.instantrailcheck.com/developers)

## Stack

- [Next.js 16](https://nextjs.org) — App Router
- [Supabase](https://supabase.com) — database + auth
- [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- [Vercel](https://vercel.com) — hosting

## Local development

```bash
npm install
npm run dev
```

Create a `.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Also uses `SUPABASE_SERVICE_ROLE_KEY` server-side for enrichment and rate limiting (never exposed to the client).

## Database

Supabase tables: `banks`, `route_reports`, `ncua_credit_unions`, `fednow_participants`, `rtp_participants`, `zelle_participants`, `api_rate_limits`

Migrations live in `supabase/migrations/`. Reference tables (`ncua_credit_unions`, `fednow_participants`, `rtp_participants`, `zelle_participants`) are synced periodically from official/semi-official sources via the scripts in `scripts/`, not queried live.
