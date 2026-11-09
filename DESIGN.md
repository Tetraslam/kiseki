# kiseki design

kiseki (軌跡, "trajectory", the path something leaves behind) is an open-source React library for rendering agent traces. It does for agent trajectories what [@pierre/diffs](https://diffs.com) does for diffs: one excellent, embeddable component, not a platform.

Package: `@tetraslam/kiseki`. Site: [kiseki.sh](https://kiseki.sh). License: MIT.

## Why a library

Raindrop's trace viewer is good because Raindrop serves one job, improving agents. Langfuse's is bad because it must render any span from any system. An open-source dashboard drifts toward Langfuse, because every user brings a different job.

kiseki splits the responsibility:

- **kiseki owns rendering agent semantics**, opinionated about them: turns, reasoning, a tool call with its result, subagent branches, file edits, outcomes. It does not render generic OpenTelemetry spans.
- **the host owns the job.** It supplies custom renderers per tool name (parc renders `searchProfiles` as people cards; an RL harness foregrounds reward), storage, auth, and any dashboards. That is how each host gets single-minded focus.

## Behavioral contract

Given an OpenTraces `TraceRecord` (complete or still growing), kiseki renders a trace a person can read, navigate, search, and compare, at any size, without layout shift, and without loading heavy payloads until asked.

- **Input is OpenTraces 0.9 only.** Everything else enters through adapters that produce `TraceRecord`. One data model.
- **Read-only.** kiseki never mutates, uploads, or persists a trace.
- **Host-controlled state.** Selection, expansion, and search are controllable props, so a host can put them in the URL (nuqs recommended). Uncontrolled defaults work out of the box.

## Data model

Canonical input: [OpenTraces `TraceRecord`](https://www.opentraces.ai/schema/latest), schema 0.9.0. Relevant fields:

- `steps[]`: `role` (system, user, agent), `content`, `reasoning_content`, `model`, `agent_role`, `call_type` (main, subagent, warmup), `parent_step`, `subagent_trajectory_ref`, `tool_calls[]`, `observations[]`, `token_usage`, `timestamp`.
- `tool_calls[].tool_call_id` pairs with `observations[].source_call_id`. An observation has `content` (full, possibly huge), `output_summary` (preview), and `error`.
- `patches[]`: file changes, linked to `step_index` and `tool_call_id`.
- `outcome`: `success`, `terminal_state`, `reward`, `signal_source`, `signal_confidence`, `description`.
- `metrics`, `agent`, `task`, `environment`, `system_prompts` (keyed by `system_prompt_hash`).
- `generation_index`: a later generation of the same `session_id` supersedes earlier ones.

`core` normalizes a record into a view model:

- tool calls paired with their observations; unpaired calls render as pending (live) or missing (complete)
- a step tree built from `parent_step` and `call_type`. A `subagent_trajectory_ref` resolves through an optional host callback, `loadTrace(ref)`, and renders as a collapsed branch until expanded.
- patches attached to the step and tool call that produced them
- per-step durations and token usage; trace-level totals from `metrics`, computed when absent

Heavy payloads: render `output_summary` first. Full `content` comes from the record if present, otherwise from an optional host callback, `loadPayload(stepIndex, callId)`, only when a call is expanded.

## Components

- `<Trace record={...} />` is the whole viewer: header plus timeline.
- `<TraceHeader>`: task, agent and model, outcome, duration, tokens, cost.
- `<Timeline>`: virtualized from the start. Rows have stable, measured heights; expanding a row grows it in place and nothing else moves.
- Step renderers, each replaceable through `renderers`:
  - user and system messages
  - agent messages, rendered with streamdown
  - reasoning, collapsed and dimmed by default
  - tool calls: name, input, duration, then the observation (summary, then expandable content), with error states
  - patches, rendered with @pierre/diffs, lazy-loaded
  - subagents: a foldable branch, with a tree overview for deep nesting
- `renderers={{ tools: { searchProfiles: PeopleCards }, fallback }}`: custom renderers per `tool_name`. They receive the paired call, its observation, and the step.
- `<TraceCompare a={...} b={...} />`: two traces aligned by step signature (role plus tool names), via LCS. It highlights where the two runs diverge.

## Live mode

A host passes a growing `record`, or calls `append(steps)` on a handle. New steps animate in without shifting existing rows. The view follows the tail with use-stick-to-bottom, and stops following when the user scrolls up. Pending tool calls show a shimmer label. The point is the R1 lesson: visible work makes waiting feel short.

## Navigation

- Keyboard first: `j`/`k` for the next/previous step, `enter` to expand, `[`/`]` to fold or unfold a subagent, `/` to search, `c` to copy a step permalink.
- Search covers content, reasoning, tool names, inputs, and summaries. It does not search unloaded payloads.
- `selectedStep` and `onSelectStep` let the host own permalinks.

## Performance budgets

- 10,000 steps: the first visible rows paint within 100 ms of receiving a parsed record.
- Zero layout shift while scrolling, expanding, or streaming.
- No payload, diff, or markdown plugin loads until it's on screen or expanded.
- Parsing a large `.jsonl` (over 5 MB) runs off the main thread on the site.
- Measure with paint marks, layout-shift entries, and long tasks in a perf script against fixtures, the way parc's `docs/performance.md` does.

## Style

The defaults follow [tetrastack](https://github.com/tetraslam/tetrastack): stepped surfaces, ink-overlay states, one accent hue, the named easing curves, Inter for UI, Commit Mono for code and numbers. Light and dark. Everything is themed through CSS variables, so hosts restyle without forking. No display face inside the component; Shippori Mincho B1 belongs to the site only. Devtools should look like devtools: dense and calm.

## Packages

pnpm monorepo:

- `packages/core`: framework-free parse, validate, normalize, pair, tree, align, search. No React.
- `packages/react`: the components. Peer dependency: React 19. Dependencies: @pierre/diffs, streamdown, use-stick-to-bottom, a virtualizer (choose and justify).
- `packages/adapters`: AI SDK steps (`onStepFinish`), OpenCode sessions, Claude Code JSONL. Verify each against real files before claiming support.
- `apps/site`: kiseki.sh on Next. The hero is the real component on a real trace. Dropping a `.jsonl` renders it locally, with nothing uploaded. Docs follow, including a "for agents" link (llms.txt).

Tooling: TypeScript, Biome, Vitest, Changesets for releases.

## Non-goals

Storage, ingestion, auth, dashboards, evals, alerting, and generic span rendering. A trace list filtered by outcome may come later as a second component, after the viewer holds up.

## Milestones

1. `core` and a static `<Trace>` over fixtures: pairing, the tree, patches, the virtualized timeline, and renderers.
2. Live mode and keyboard navigation.
3. `<TraceCompare>`.
4. Adapters: AI SDK first, then OpenCode and Claude Code.
5. kiseki.sh.
6. Dogfooding: parc's admin trace view uses kiseki, and local OpenCode sessions render through the adapter.

## Evidence

- Fixtures: a real parc search trace (parc can export OpenTraces from its admin page), a synthetic 10,000-step trace with subagents and patches, a trace with errors and missing observations, and a growing trace for live mode.
- Unit tests in `core` for pairing, the tree, alignment, and generation resolution.
- The perf script reports against the budgets above.
- Anything not exercised against a real fixture is marked unproven in the README.

## Open questions

- Which virtualizer handles variable, changing row heights without layout shift.
- How OpenCode and Claude Code store sessions in practice (OpenCode keeps them in `~/.local/share/opencode/opencode.db`; check the schema).
- Whether `@pierre/diffs` should be an optional peer dependency, so hosts that never show patches don't ship it.
