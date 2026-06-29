# InstantRailCheck

**Know before you transfer.**

Crowdsourced database of real-world bank transfer compatibility across RTP, FedNow, ACH, Wire, Zelle, and more.

Live at [instantrailcheck.com](https://www.instantrailcheck.com)

## What it does

- Search any two US banks to see which payment rails work between them
- View success rates, average settlement times, and data freshness
- Submit your own real transfer outcomes to improve the database
- Accounts via magic link — no password required

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

## Database

Supabase tables: `banks`, `route_reports`

See SQL migration files in conversation history (`001` through `004`).
