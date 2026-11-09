<div align="center">

# 軌跡 kiseki

**a react component for reading agent traces**

[kiseki.sh](https://kiseki.sh) · [docs](https://kiseki.sh/docs) · [for agents](https://kiseki.sh/llms.txt) · [design](DESIGN.md)

</div>

kiseki (軌跡, "trajectory") renders [opentraces](https://www.opentraces.ai/schema/latest) records. it reads as the run itself, turn by turn: what the agent thought and said, at full weight, then its tool calls as compact lines with results beneath, with built-in views for edits (diffs), shell runs (pass and fail counts), reads, and searches. a map of the run over time, with a lane per parallel subagent, is a toggle away. live or after the fact. it's one embeddable component in the spirit of [@pierre/diffs](https://diffs.com), not a platform. your app supplies the job-specific parts through custom renderers per tool.

```sh
pnpm add @tetraslam/kiseki
```

```tsx
import { Trace } from "@tetraslam/kiseki";
import "@tetraslam/kiseki/styles.css";

<Trace
  record={record}
  renderers={{ tools: { searchProfiles: PeopleCards } }}
  loadPayload={(step, callId) => fetchOutput(step, callId)}
/>;
```

drop any trace on [kiseki.sh](https://kiseki.sh) to read it. it renders in your browser and nothing is uploaded.

## packages

| package | what it is |
| --- | --- |
| [`@tetraslam/kiseki`](packages/react) | `<Trace>`, `<TraceCompare>`, and the step renderers. peer: react 19; optional peer: `@pierre/diffs` |
| [`@tetraslam/kiseki-core`](packages/core) | parse, validate, normalize, pair, tree, align, search. no react |
| [`@tetraslam/kiseki-adapters`](packages/adapters) | ai sdk steps, claude code, opencode, codex, and pi sessions into opentraces |
| [`apps/site`](apps/site) | kiseki.sh |

## what's proven

- **performance**, by `pnpm perf` against [the budgets](DESIGN.md#performance-budgets) on a generated 10,000-step, 28 MB trace in headless chromium ([results](docs/perf-results.json)): first rows paint a median of 88 ms after the record is parsed (element timing, budget 100 ms), layout shift is 0 while loading, scrolling, expanding, and streaming, a clicked element stays put to the pixel, diffs reserve their exact height before @pierre/diffs loads, and the live view stays pinned to the tail.
- **core**: 28 unit tests on pairing, the tree, alignment (checked against a brute-force lcs), the overview's lanes and waits, search, and generation resolution, over the [fixtures](fixtures).
- **adapters**, against real sessions on one machine: 99 claude code sessions, 622 opencode 2.x sessions plus 600 from 1.x, 8 codex rollouts, and ai sdk 7 `StepResult`s from a mock model and from a live run through the ai gateway ([the package scout](fixtures/README.md)). every record validates. see [the adapters readme](packages/adapters/README.md#evidence).
- **rendering**, against real recorded runs ([fixtures](fixtures/README.md)): a coding session, three parallel subagents, an ai sdk agent with custom renderers, and two models on the same task, in light and dark.

## unproven

- claude code `MultiEdit`, `NotebookEdit`, and the older inline sidechain format haven't appeared in a real session.
- pi: one real session, without tool calls. tool calls, patches, and branching follow pi's docs.
- codex: no rollouts with subagents.
- the overview's lanes were checked on one real parallel run; deeply nested subagents haven't appeared in a real trace.
- page-mode `<TraceCompare>` renders every pair without virtualization; long compares should use container mode.
- performance is measured in chromium on one machine. firefox and safari aren't measured.
- dogfooding in parc's admin view (milestone 6) hasn't happened yet.

## develop

```sh
pnpm install
pnpm -r --filter "./packages/*" build
pnpm test
pnpm --filter @kiseki/site dev
pnpm --filter "@kiseki/site..." build && pnpm perf
```

## stack

from [tetrastack](https://github.com/tetraslam/tetrastack): pnpm, typescript, biome, vitest, changesets, tsdown for the packages. the component uses @tanstack/react-virtual (see [decisions](DESIGN.md#decisions)), use-stick-to-bottom, streamdown, and @pierre/diffs, with plain css variables so hosts don't need tailwind. the look is in [BRIEF.md](BRIEF.md). the site is next 16 on vercel with tailwind 4, shadcn on base ui, phosphor, next-themes, fontsource files through `next/font/local`, shiki and unified for docs, and vercel analytics. no database: the site is static.

## license

[mit](LICENSE)
