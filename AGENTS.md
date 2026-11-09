# kiseki

- Read `DESIGN.md` before writing code. It is the contract; update it when a decision changes.
- Use the tetrastack skill for library and style choices, and its `perf.md` for every rendering decision.
- Check current library docs (Context7, or the docs inside `node_modules`) before using an API.
- Prove claims with fixtures and the perf script. Mark anything unexercised as unproven.

## stack

- pnpm workspace: `packages/core` (no react), `packages/react`, `packages/adapters`, `apps/site` (next 16).
- tsdown builds the packages; the site and the adapters' tests read their `dist`, so build packages first: `pnpm -r --filter "./packages/*" build`.
- checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter "@kiseki/site..." build`, then `pnpm perf` for the budgets. CI runs the same.
- the virtualizer is @tanstack/react-virtual; see DESIGN.md decisions before changing it.
- `scripts/fixtures.mjs` writes the synthetic fixtures; `synthetic-10k.jsonl` is generated, never committed.
- real sessions hold private data. adapter fixtures are invented content in the real structure; check any real trace before committing it.
