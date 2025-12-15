# Repository Guidelines

This guide helps contributors work efficiently on Gift Bundle Optimizer. Keep changes small, typed, and easy to review.

## Project Structure & Module Organization
- `app/` holds the React Router app: UI components in `app/components/`, shared helpers in `app/lib/`, routes in `app/routes/`, and entry files in `app/root.tsx` + `app/entry.server.tsx`.
- `public/` stores static assets bundled by Vite; `build/` is the compiled output.
- `workers/app.ts` contains the Cloudflare Worker entry; `wrangler.jsonc` and `react-router.config.ts` control deployment and routing.
- Path alias: import app code with `~/*` (configured in `tsconfig.cloudflare.json`).

## Build, Test, and Development Commands
- `npm run dev`: Start the React Router + Vite dev server.
- `npm run build`: Production build for both client and worker bundles.
- `npm run preview`: Serve the production build locally for spot checks.
- `npm run cf-typegen`: Regenerate Cloudflare bindings/types before typechecking.
- `npm run typecheck`: Run Worker typegen, React Router typegen, and `tsc -b` under strict mode.
- `npm run deploy`: Build, then deploy with Wrangler to Cloudflare.

## Coding Style & Naming Conventions
- TypeScript, strict mode on; favor explicit return types on exported helpers in `app/lib/*`.
- Use functional React components; colocate styles via Tailwind utility classes (Tailwind 4). Prefer `clsx`/`tailwind-merge` to compose classes.
- Keep data/logic in `app/lib/` (e.g., `gift-optimizer.ts`), UI in `app/components/`, and route-specific loaders/actions in `app/routes/*`.
- Naming: route files `kebab-case.tsx`; components/hooks/utilities in `camelCase` filenames; exported components in `PascalCase`.

## Testing Guidelines
- No automated test suite is present yet; when adding, prefer Vitest + React Testing Library. Name files `*.test.ts`/`*.test.tsx` alongside the code.
- Cover edge cases in `app/lib/gift-optimizer.ts` (empty purchases, ties, high thresholds) and critical UI flows (input parsing, result panel state).
- Run `npm run typecheck` before opening a PR; add `npm test` if you introduce a test runner.

## Commit & Pull Request Guidelines
- Existing history uses short, imperative summaries (e.g., "change algorithm"); follow that pattern.
- Scope commits narrowly; include context in the body when touching optimization logic or Worker config.
- PRs should describe the user-facing change, steps to verify (commands run, scenarios tried), and screenshots for UI updates.
- Link related issues/threads and call out risk areas (performance of optimization, Cloudflare bindings) for reviewers.

## Security & Configuration Tips
- Do not commit secrets; Wrangler credentials and env vars belong in your local environment/config storage.
- Re-run `npm run cf-typegen` when Cloudflare bindings change to avoid drift between worker types and runtime.
