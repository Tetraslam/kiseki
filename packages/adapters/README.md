# @tetraslam/kiseki-adapters

Converts other agent formats into OpenTraces 0.9 `TraceRecord`s for kiseki. Framework-free and browser-safe: every adapter takes text or parsed objects, never a path.

```ts
import { detect } from "@tetraslam/kiseki-adapters";

const result = detect(await file.text()); // { format, records, issues } or null
```

| Import         | Export                                                       | Input                                          |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `/ai-sdk`      | `createTraceRecorder(options)`, `fromSteps(steps, options)`  | AI SDK `StepResult`s                           |
| `/claude-code` | `fromClaudeCode(text, { subagents })`                        | `~/.claude/projects/<project>/<session>.jsonl` |
| `/opencode`    | `fromOpenCode(session, { children })`                        | `opencode session export <id>` output          |
| `/codex`       | `fromCodex(text)`                                            | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| `/pi`          | `fromPi(text)`                                               | `~/.pi/agent/sessions/--<path>--/*.jsonl`      |
| root           | `detect(input)`, `detectFormat(input)`, and all of the above | any of the above, or OpenTraces records        |

## Conventions

- One agent step per LLM call, holding that call's tool calls and the observations that answer them.
- `input_tokens` counts the whole prompt, cached tokens included, so `cache_hit_rate` stays in [0, 1]. Sources that report cache reads separately (Claude Code, OpenCode, Pi) are summed.
- `output_summary` is a one-line preview of at most 200 characters. `content` keeps the full output.
- Tool inputs are copied verbatim. A non-object input (Codex custom tools) is wrapped as `{ input }`.
- `task.description` is the first user message, cut to 500 characters.
- `outcome` is set only when the source states one (OpenCode's run status).
- Subagents: a transcript you pass in is inlined under the step that launched it, as `call_type: "subagent"` steps with `parent_step` and `agent_role`. One you don't pass becomes `subagent_trajectory_ref` (the agent or session id) on the launching step, or on a stub child step when that step launched several.
- Patches: one per edited file, `patch_id` is the tool call id (`<id>:<n>` for multi-file calls). When the source recorded a unified diff, it is attached as `diff`, a kiseki extension to OpenTraces `Patch`.

## What each adapter emits

**AI SDK** (verified with `ai` 7.0 `generateText` and `streamText`; the structural `AiSdkStep` type also reads v5 and v6 field names). Text, reasoning, `tool-call`, `tool-result`, and `tool-error` parts; `performance.toolExecutionMs` as `duration_ms`; `response.timestamp` as the step time; `model` as `provider/modelId`. `options.system` and `options.prompt` become leading system and user steps, and `experimental_steeringMessages` become user steps. Patches come from tool names that look like edits (`edit`, `write`, `patch`, ...) with a path and a change field.

**Claude Code** (2.1.x). Streamed lines that share `message.id` merge into one step. `thinking` blocks become `reasoning_content` (Claude Code often stores them empty). `tool_result` pairs by `tool_use_id`; `is_error` sets `error`; `duration_ms` is result time minus call time. Usage sums `input_tokens + cache_read + cache_creation`. `isMeta` user lines are skipped. `Agent`/`Task` calls link subagents through `toolUseResult.agentId`; pass `subagents/agent-<id>.jsonl` files keyed by id to inline them, or convert one alone (its `session_id` is the agent id). `Write`, `Edit`, and `MultiEdit` inputs keep `file_path`, `content`, `old_string`, `new_string`, and `edits`; `Edit` gets a `diff` built from `toolUseResult.structuredPatch`. `cost-state` gives the cost, `ai-title` the title.

**OpenCode** (2.2 export; also raw `session_message` rows and 1.x `{ info, parts }` messages). v2: each assistant message is a step with `text`, `reasoning`, and `tool` content; tool `state.content` is the output and `state.error.message` the error. v1: each `step-start`…`step-finish` span is a step, with tokens from `step-finish`. Inputs keep OpenCode's camelCase (`filePath`, `oldString`, `newString`, `patchText`). Diffs come from tool metadata (`diff`, `filediff.patch`, `files[].patch`), split per file. `task` and `subagent` calls link children through `metadata.sessionId`/`sessionID`. System, synthetic, and compaction messages become system steps. An assistant error is kept as `step.error`.

**Codex** (0.129–0.149). A `token_count` event closes the current step and supplies its usage. `function_call`, `custom_tool_call`, and hosted `web_search_call` become tool calls; outputs pair by `call_id`, and `Wall time` or `duration_seconds` gives `duration_ms`. User steps come from `user_message`/`UserMessage` events, so injected `<environment_context>` messages are skipped. `apply_patch` (envelope kept as `{ input }`) and code-mode `exec` edits become patches with diffs from `patch_apply_end` or `FileChange` items. Codex does not flag tool errors, so only a failed patch sets `error`.

**Pi** (session format v3). Follows the active branch from the last entry back to the root. `thinking`, `toolCall`, and `toolResult` (`isError`) map directly; `details.patch` becomes the `diff` of `edit` and `write` calls (`{ path, edits: [{ oldText, newText }] }` and `{ path, content }`). Compaction, branch summaries, and custom messages become system steps; `bashExecution` becomes a user step.

## Evidence

Run `pnpm build`, then `node scripts/verify-<name>.mjs`. Each script converts real sessions on the local machine and checks every record with core's `validateTrace` and `normalize`. Results from 2026-11-09:

| Adapter           | Sessions | Steps  | Calls  | Paired | Unpaired | Errors | Patches (with diff) |
| ----------------- | -------- | ------ | ------ | ------ | -------- | ------ | ------------------- |
| Claude Code       | 99       | 5,990  | 5,301  | 5,300  | 1        | 44     | 449 (1)             |
| OpenCode v2 rows  | 622      | 50,863 | 63,529 | 63,528 | 1        | 909    | 7,161 (6,375)       |
| OpenCode v1 parts | 600      | 21,958 | 33,880 | 33,834 | 46       | 516    | 4,564 (4,324)       |
| OpenCode export   | 40       | 1,626  | 2,372  | 2,372  | 0        | 40     | 436 (426)           |
| Codex             | 8        | 247    | 288    | 288    | 0        | 0      | 76 (75)             |
| Pi                | 1        | 2      | 0      | 0      | 0        | 0      | 0                   |

No record failed validation. Unpaired calls are ones the source never answered: interrupted or still running. Call counts match the source files.

Test fixtures in `test/fixtures` keep the structure of those real sessions with invented content; `scripts/make-fixtures.mjs` writes them.

## Unproven

- Claude Code: native `Write`, `Edit`, `Agent`, and subagent files come from one session recorded for this purpose; the other 98 used MCP tools. `MultiEdit`, `NotebookEdit`, and sidechains stored inline in older versions have not been seen.
- Pi: tool calls, tool results, `edit`/`write` patches, compaction, and branching follow Pi's documented format and fixtures only; the only real session has no tool calls.
- Codex: eight rollouts, without subagents or `local_shell_call`.
- AI SDK: real `StepResult`s from a mock model only, not a live provider.
