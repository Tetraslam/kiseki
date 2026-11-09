import type { TraceView, ViewStep } from "@tetraslam/kiseki-core";
import type { Outliers } from "./context";

/**
 * Steps that stand out: at least three times the trace's median and above a floor (10s, or 2x
 * the median tokens for long traces). Only these show their numbers without hovering.
 */
export function findOutliers(steps: readonly ViewStep[]): Outliers {
  const durations = steps.map((s) => s.durationMs).filter((d): d is number => d != null && d > 0);
  const tokens = steps
    .map((s) => (s.tokens.input_tokens ?? 0) + (s.tokens.output_tokens ?? 0))
    .filter((t) => t > 0);
  const median = (values: number[]) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] as number;
  };
  const d = median(durations);
  const t = median(tokens);
  const duration = new Set<string>();
  const token = new Set<string>();
  if (steps.length < 4) return { duration, tokens: token };
  for (const s of steps) {
    if (s.durationMs != null && s.durationMs >= Math.max(10_000, d * 3)) duration.add(s.key);
    const total = (s.tokens.input_tokens ?? 0) + (s.tokens.output_tokens ?? 0);
    if (t > 0 && total >= t * 3) token.add(s.key);
  }
  return { duration, tokens: token };
}

/** The deepest directory every path in the trace shares, when it's at least two levels deep. */
export function guessWorkdir(view: TraceView): string | undefined {
  const env = view.record.environment as { cwd?: unknown; directory?: unknown } | undefined;
  const meta = view.record.metadata as { cwd?: unknown; directory?: unknown } | undefined;
  for (const value of [env?.cwd, env?.directory, meta?.cwd, meta?.directory]) {
    if (typeof value === "string" && value.startsWith("/")) return value.replace(/\/$/, "");
  }
  const paths: string[] = [];
  for (const step of view.steps) {
    for (const { call } of step.calls) {
      for (const key of ["file_path", "filePath", "path"]) {
        const value = call.input?.[key];
        if (typeof value === "string" && value.startsWith("/")) paths.push(value);
      }
    }
    if (paths.length > 200) break;
  }
  if (paths.length < 2) return undefined;
  let common = (paths[0] as string).split("/");
  for (const path of paths) {
    const parts = path.split("/");
    let i = 0;
    while (i < common.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  // A path that is itself the common prefix may be a file; keep directories only.
  if (paths.includes(common.join("/")) && /\.[a-z0-9]+$/i.test(common.at(-1) ?? "")) common.pop();
  return common.length >= 3 ? common.join("/") : undefined;
}

/** The agent's last word: the final agent message of the main branch. */
export function finalAnswer(view: TraceView): string | undefined {
  for (let i = view.roots.length - 1; i >= 0; i--) {
    const step = view.byIndex.get(view.roots[i] as number);
    if (step?.step.role === "agent" && step.step.content?.trim()) return step.step.content;
    if (step?.step.role === "user") break;
  }
  return undefined;
}
