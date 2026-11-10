import type { TraceView } from "./normalize";

export type SignalTone = "good" | "bad" | "neutral";

/** One thing worth knowing about a run before opening it. */
export interface Signal {
  label: string;
  tone: SignalTone;
}

export interface RunSummary {
  key: string;
  title: string;
  outcome: "success" | "failure" | "unknown" | "live";
  agent: string;
  model?: string;
  steps: number;
  durationMs?: number;
  costUsd?: number;
  startedAt?: number;
  signals: Signal[];
}

const SHELL = /^(bash|shell|exec|exec_command|run|terminal|command|local_shell)$/i;
const EDIT = /^(edit|multiedit|write|apply_patch|str_replace|create|patch)$/i;
const TASK = /^(task|agent|subagent|delegate)$/i;

/** Pass and fail counts from common test runners, or nothing. */
export function testCounts(text: string): { passed: number; failed: number } | undefined {
  const pass = /^ℹ pass (\d+)/m.exec(text);
  const fail = /^ℹ fail (\d+)/m.exec(text);
  if (pass || fail) return { passed: Number(pass?.[1] ?? 0), failed: Number(fail?.[1] ?? 0) };
  const failed = /(\d+) (?:failed|failing)/i.exec(text);
  const passed = /(\d+) (?:passed|passing)/i.exec(text);
  if (failed || passed)
    return { passed: Number(passed?.[1] ?? 0), failed: Number(failed?.[1] ?? 0) };
  return undefined;
}

/**
 * What a run did, in a line: its outcome, then signals read from the trace itself. Test runs
 * that went from failing to passing, tool errors, subagents, and files edited.
 */
export function summarizeRun(view: TraceView): RunSummary {
  const { record, totals } = view;
  const outcome = record.outcome;
  const signals: Signal[] = [];
  const tests: { passed: number; failed: number }[] = [];
  const files = new Set<string>();
  let subagents = 0;
  for (const step of view.steps) {
    for (const { call, observation } of step.calls) {
      const name = call.tool_name.split(/__|\./).at(-1) ?? call.tool_name;
      const output = observation?.content ?? observation?.output_summary ?? "";
      if (SHELL.test(name)) {
        const counts = testCounts(output);
        if (counts) tests.push(counts);
      }
      if (EDIT.test(name)) {
        const path = call.input?.file_path ?? call.input?.filePath ?? call.input?.path;
        if (typeof path === "string") files.add(path);
      }
      if (TASK.test(name)) subagents++;
    }
  }
  const first = tests[0];
  const last = tests.at(-1);
  if (first && last) {
    if (first.failed > 0 && last.failed === 0) {
      signals.push({
        label: `tests ${first.failed} failing → ${last.passed} passing`,
        tone: "good",
      });
    } else if (last.failed > 0) {
      signals.push({ label: `${last.failed} tests still failing`, tone: "bad" });
    } else signals.push({ label: `${last.passed} tests passing`, tone: "good" });
  }
  if (totals.errors)
    signals.push({
      label: `${totals.errors} tool ${totals.errors === 1 ? "error" : "errors"}`,
      tone: "bad",
    });
  if (files.size)
    signals.push({
      label: `${files.size} ${files.size === 1 ? "file" : "files"} edited`,
      tone: "neutral",
    });
  if (subagents)
    signals.push({
      label: `${subagents} ${subagents === 1 ? "subagent" : "subagents"}`,
      tone: "neutral",
    });

  const state = view.live
    ? "live"
    : outcome?.success === true || outcome?.terminal_state === "goal_reached"
      ? "success"
      : outcome?.success === false ||
          ["error", "interrupted", "abandoned"].includes(outcome?.terminal_state ?? "")
        ? "failure"
        : "unknown";
  const prompt =
    record.task?.description ??
    record.steps?.find((s) => s.role === "user")?.content ??
    record.trace_id;
  const started = record.timestamp_start ?? record.steps?.[0]?.timestamp;
  return {
    key: record.trace_id,
    // A session's own title (OpenCode names every session), else the prompt.
    title: (typeof record.metadata?.title === "string" && record.metadata.title.trim()
      ? record.metadata.title
      : prompt
    )
      .replace(/^"(.*)"$/s, "$1")
      .replace(/\s+/g, " ")
      .trim(),
    outcome: state,
    agent: record.agent.name,
    model: record.agent.model,
    steps: totals.steps,
    durationMs: totals.durationMs,
    costUsd: totals.costUsd,
    startedAt: started ? Date.parse(started) : undefined,
    signals,
  };
}
