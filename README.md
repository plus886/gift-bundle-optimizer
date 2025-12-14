# Gift Bundle Optimizer

An optimization tool that runs on React Router and Cloudflare Workers to maximize the number of giveaway gifts. Provide the list of purchase amounts together with the giveaway thresholds and the app instantly derives the best combination.

## Features

- Optimizes two giveaway tiers at once (e.g., Tier A at 2,000 and Tier B at 1,000)
- Expands unit price + quantity inputs into up to 50 purchase lines and groups them automatically
- Highlights leftover amount and achievable gift count in a dedicated result panel
- All calculations happen in the browser via the dynamic-programming logic in `app/lib/gift-optimizer.ts`

## Tech Stack

- React Router 7 / Vite / TypeScript
- Tailwind CSS 4 (with `tw-animate-css` for subtle motion)
- Cloudflare Workers + Wrangler (SSR and deployment)
- Lightweight Radix UI–based component primitives
