# react doctor exceptions

`pnpm dlx react-doctor@latest --verbose`, run in `packages/react` and `apps/site` on 2026-11-09. Findings were fixed where they were real: refs written during render now update in layout effects (`useLatest`), the virtualizer option is set in a layout effect, the permalink hash decode is guarded, internal links use `next/link`, the file input has a label, and the perf harness checks its fetch status. What remains is reviewed and accepted:

## packages/react

| finding | where | why it stays |
| --- | --- | --- |
| exhaustive-deps (×7) | `Trace.tsx`, `TraceOverview.tsx`, `state.ts` | every flagged value is a ref from `useLatest`, which is stable. biome is configured to know this (`stableResult`); react doctor isn't. |
| ref mutated during render | `Timeline.tsx` `seen` | lazy initialization (`if (ref.current === null) ref.current = …`), the pattern React's docs recommend for expensive refs. |
| state initialized from a mount effect | `Timeline.tsx` `virtual` | deliberate: the server and the first client pass render rows in normal flow so the first paint is real; the layout effect hands over to the virtualizer before the browser paints. |
| state adjusted after a prop change | `blocks.tsx` `Disclosure` | keeps closed content mounted until its close transition ends, so collapsing animates instead of cutting. |
| click handler without key handler, static element interaction | `StepRow.tsx` | clicking a row selects it; the keyboard path is the timeline's `j`/`k`, which selects the same rows. Every control inside the row is a real button. |
| array index as key | `tools.tsx` output lines | lines of a tool's output never reorder or change identity. |
| high complexity, giant component | `Trace`, `TraceOverview`, `TraceHeader`, `StepRow`, two tool views | each is one surface with many states, mostly branches on data. splitting them would scatter one contract across files. |

## apps/site

| finding | where | why it stays |
| --- | --- | --- |
| fetch in an effect, effect without cleanup | `app/perf/harness.tsx` | the perf harness exists to time exactly this load: fetch, parse, render, paint. It is not linked from the site. |
| non-component export in a component file | `components/ui/button.tsx`, `tabs.tsx` | shadcn's generated source, kept as installed. |
| high complexity | `components/showcase.tsx` | one switch over the demo kinds. |
