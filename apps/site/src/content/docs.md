# kiseki

kiseki (軌跡, "trajectory") is a React component for reading agent traces. It renders an [OpenTraces 0.9](https://www.opentraces.ai/schema/latest) `TraceRecord`: turns, reasoning, tool calls with their results, subagent branches, file edits, and outcomes, complete or still growing.

It renders agent semantics and nothing else. Your app keeps the job: custom renderers per tool, storage, auth, and dashboards.

## Install

```sh
pnpm add @tetraslam/kiseki
# optional, only if your traces have patches:
pnpm add @pierre/diffs
```

React 19 is a peer dependency. `@pierre/diffs` is an optional peer: kiseki imports it the first time a patch is on screen, so apps that never show patches never load it.

## Render a trace

```tsx
import { Trace } from "@tetraslam/kiseki";
import "@tetraslam/kiseki/styles.css";

export function TraceView({ record }) {
  return (
    <div style={{ height: 640 }}>
      <Trace record={record} />
    </div>
  );
}
```

`<Trace>` fills its parent's height and scrolls inside it. The first rows render on the server, so the first paint is the trace itself, and the virtualizer takes over before the browser paints.

To parse text yourself (a `.json` record, a JSON array, or JSONL with one record per line):

```ts
import { parseTraces, resolveGenerations } from "@tetraslam/kiseki";

const { records, issues } = parseTraces(text);
const latest = resolveGenerations(records); // the max generation_index of each session_id
```

Invalid steps are dropped and reported in `issues`, so a partial trace still renders.

## Props

| prop                                                  | type                                                  | what it does                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `record`                                              | `TraceRecord`                                         | the trace. Pass a new record as it grows.                                                          |
| `live`                                                | `boolean`                                             | unanswered calls are pending, and the view follows the tail                                        |
| `renderers`                                           | `Renderers`                                           | custom renderers, below                                                                            |
| `loadPayload`                                         | `(stepIndex, callId) => Promise<string \| undefined>` | full output for a call whose record holds only `output_summary`. Called when the call is expanded. |
| `loadTrace`                                           | `(ref) => Promise<TraceRecord>`                       | resolves a `subagent_trajectory_ref` when its branch unfolds                                       |
| `loadPatch`                                           | `(patch) => Promise<PatchContent \| undefined>`       | diff content for a patch that carries none                                                         |
| `selectedStep`, `defaultSelectedStep`, `onSelectStep` | `string \| null`                                      | the selected step's key                                                                            |
| `expanded`, `defaultExpanded`, `onExpandedChange`     | `string[]`                                            | open blocks: `12#reasoning`, `12#<tool_call_id>`, `12#patch:<patch_id>`                            |
| `unfolded`, `defaultUnfolded`, `onUnfoldedChange`     | `string[]`                                            | unfolded branch heads. Branches start folded.                                                      |
| `search`, `defaultSearch`, `onSearchChange`           | `string`                                              | the search query                                                                                   |
| `permalink`                                           | `(key) => string`                                     | the link `c` copies. Defaults to the current URL plus `#step=<key>`.                               |
| `header`                                              | `boolean \| ReactNode`                                | hide the header, or replace it                                                                     |
| `toolbar`                                             | `boolean`                                             | hide the search toolbar                                                                            |
| `keyboard`                                            | `"scoped" \| "global" \| false`                       | listen while the trace has focus (default), on the window, or not at all                           |
| `theme`                                               | `"light" \| "dark"`                                   | force a theme. By default kiseki follows a `.dark` class on an ancestor.                           |
| `ref`                                                 | `Ref<TraceHandle>`                                    | `append(steps)`, `scrollToStep(key)`, `focus()`                                                    |

A step's key is its `step_index` as a string. Steps of a subagent trace loaded through `loadTrace` are keyed `<ref>/<step_index>`.

Every state prop works controlled or uncontrolled. Controlled, it can live in the URL; [nuqs](https://nuqs.dev) fits well:

```tsx
const [step, setStep] = useQueryState("step");
<Trace record={record} selectedStep={step} onSelectStep={setStep} />;
```

## Custom renderers

Renderers receive the paired call, its observation, and the step. `Default` is kiseki's own renderer, so you can wrap it instead of replacing it.

```tsx
import { Trace, type ToolRendererProps } from "@tetraslam/kiseki";

function PeopleCards(props: ToolRendererProps) {
  const output = props.payload ?? props.observation?.content;
  if (!output) return <props.Default {...props} />;
  return <ProfileGrid people={JSON.parse(output)} />;
}

<Trace
  record={record}
  renderers={{
    tools: { searchProfiles: PeopleCards },
    fallback: undefined, // any tool without its own renderer
  }}
/>;
```

You can also replace `user`, `system`, `message` (agent text, markdown through streamdown by default), `reasoning`, and `patch`.

## Live mode

Pass a growing `record` with `live`, or append through the handle:

```tsx
const trace = useRef<TraceHandle>(null);
<Trace ref={trace} record={record} live />;

// later, as steps finish:
trace.current?.append([step]);
```

New steps animate in without moving the rows already on screen. The view follows the tail and stops when the reader scrolls up; a "follow live" button brings it back. A call with no result yet shows a shimmer label.

## Patches

OpenTraces patches carry snapshot ids, not diff text. kiseki finds content in this order:

1. a `diff` (unified) string on the patch. The kiseki adapters write this; it is an extension to OpenTraces.
2. `before` and `after` strings on the patch
3. the producing tool call's input: `old_string`/`new_string` or `oldString`/`newString` (Edit), `edits[]` (MultiEdit), `content` (Write), or a unified `patch`/`diff` (apply_patch)
4. `loadPatch(patch)`

Diffs render with [@pierre/diffs](https://diffs.com).

## Compare two runs

```tsx
import { TraceCompare } from "@tetraslam/kiseki";

<TraceCompare a={runA} b={runB} />;
```

Steps are aligned by signature (role plus sorted tool names) through a longest common subsequence (Myers' diff). Steps only one run took sit across from a gap, and the first divergence is labeled.

## Keyboard

| key       | action                                                  |
| --------- | ------------------------------------------------------- |
| `j` / `k` | next / previous step                                    |
| `enter`   | open or close every block of the step                   |
| `[` / `]` | fold / unfold a subagent branch                         |
| `/`       | search. `enter` and `shift+enter` move between matches. |
| `c`       | copy a permalink to the step                            |
| `esc`     | clear the search, then the selection                    |

Search covers content, reasoning, tool names, inputs, summaries, and whatever output the record holds. It does not search payloads that haven't loaded.

## Adapters

`@tetraslam/kiseki-adapters` turns other formats into `TraceRecord`s. Every adapter takes text or parsed objects, never a path, so it runs in the browser too.

```ts
import { detect } from "@tetraslam/kiseki-adapters";

const result = detect(await file.text()); // { format, records, issues } or null
```

| import         | export                                 | input                                          |
| -------------- | -------------------------------------- | ---------------------------------------------- |
| `/ai-sdk`      | `createTraceRecorder()`, `fromSteps()` | AI SDK `StepResult`s                           |
| `/claude-code` | `fromClaudeCode(text, { subagents })`  | `~/.claude/projects/<project>/<session>.jsonl` |
| `/opencode`    | `fromOpenCode(session, { children })`  | `opencode session export <id>`                 |
| `/codex`       | `fromCodex(text)`                      | `~/.codex/sessions/…/rollout-*.jsonl`          |
| `/pi`          | `fromPi(text)`                         | `~/.pi/agent/sessions/…/*.jsonl`               |

Record an AI SDK agent as it runs:

```ts
import { createTraceRecorder } from "@tetraslam/kiseki-adapters/ai-sdk";

const recorder = createTraceRecorder({ agent: { name: "my-agent" }, prompt });
const result = await generateText({ model, tools, prompt, onStepFinish: recorder.onStepFinish });
save(recorder.record());
```

## Theming

Every color, font, size, and curve is a `--kiseki-*` CSS variable, set at zero specificity, so any rule on `.kiseki` overrides it:

```css
.kiseki {
  --kiseki-font: "Inter Variable", sans-serif;
  --kiseki-mono: "Commit Mono", monospace;
  --kiseki-bg: #e9e8e3;
  --kiseki-accent: #d5683f;
}
```

Dark mode follows a `.dark` class or `data-theme="dark"` on an ancestor, or the `theme` prop. kiseki doesn't load fonts; it names Inter and Commit Mono and falls back to system faces.

## Performance

Measured by `scripts/perf.mjs` in headless Chromium against the built site, on a generated 10,000-step trace (28 MB of JSONL):

- first rows paint a median of FIRST_ROWS ms after the record is parsed (budget: 100 ms)
- cumulative layout shift is 0 while scrolling, expanding, and streaming, and rows above an expanded call move 0 px
- @pierre/diffs loads only when a patch is opened or on screen
- files over 5 MB dropped on kiseki.sh parse in a web worker

## What isn't proven

- Claude Code `MultiEdit`, `NotebookEdit`, and the older inline sidechain format haven't been seen in a real session.
- The Pi adapter was checked against one real session with no tool calls; tools, patches, and branching follow Pi's docs.
- The Codex adapter was checked on eight rollouts, none with subagents.
- The AI SDK adapter was checked with real `StepResult`s from a mock model, not a live provider.
- Performance numbers come from one machine in headless Chromium. Other browsers aren't measured.
