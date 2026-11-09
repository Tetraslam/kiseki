# fixtures

| file | what it is |
| --- | --- |
| `opencode-ledger-json-flag.json` | real: claude-haiku-4-5 in OpenCode fixing seven failing tests in a toy ledger repo, then adding a `--json` flag with a test. The site's coding session. |
| `opencode-ledger-review.json` | real: claude-sonnet-5-5 launching three explore subagents in parallel to review the same repo. |
| `opencode-ledger-sonnet.json`, `opencode-ledger-haiku.json` | real: the same "make the tests pass" prompt run by sonnet 5.5 and haiku 4.5, for compare. |
| `ai-sdk-package-scout.json` | real: an AI SDK 7 agent (claude-sonnet-5-5 through the AI Gateway) choosing a React virtualizer from live npm registry data, recorded with `createTraceRecorder`. `scripts/record-package-scout.mjs` reproduces it. |
| `opencode-tally.json` | real: OpenCode (claude-sonnet-5-5) fixing `median()` in a toy repo, with an explore subagent. |
| `parc-search.json` | real: a parc search trace, exported the way parc's admin page exports OpenTraces. Payloads were never stored, only summaries. |
| `errors.json` | failed calls, a call with no result, and a result with no call. |
| `compare-a.json`, `compare-b.json` | two runs of one task that agree, diverge, and agree again. |
| `subagent-parent.json`, `subagent-child.json` | a subagent stored as its own record, resolved through `loadTrace`. |
| `synthetic-300.json` | a generated coding session with subagent branches, edits, and heavy output. |
| `synthetic-10k.jsonl` | the same generator at 10,000 steps (28 MB), for the perf script. Not committed: `pnpm fixtures` writes it. |

The OpenCode traces were converted with `@tetraslam/kiseki-adapters/opencode` from `opencode session export` of each session and its children. Each had the harness's tool-catalog notice removed, since it lists the recording machine's integrations. The ledger runs' outcomes are deterministic: `npm test` was run in each repo after the run.

Synthetic fixtures come from `scripts/fixtures.mjs` and are deterministic. The site shows only the real ones.
