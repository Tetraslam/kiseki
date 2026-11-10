import type { TraceView, ViewStep } from "./normalize";

/** One visible line of the timeline. */
export interface Row {
  view: ViewStep;
  /** Indentation, counting nested subagent traces. */
  depth: number;
  /** The trace that owns the step: the root trace, or a loaded subagent trace. */
  trace: TraceView;
  /** Whether the step launched subagents (inline children or a subagent reference). */
  branch: boolean;
  /** Steps under this head, when known. */
  branchSize?: number;
  /** Whether any of its subagent runs is unfolded. */
  open: boolean;
  /** The subagent run this step belongs to, when it's inside one. */
  run?: string;
  /**
   * Set on the row that stands for one subagent: its block, right before its own turns. `view`
   * is the turn that launched it. Such rows have their own `key`.
   */
  head?: { run: string; index: number; members: ViewStep[] };
  /** A key for rows that aren't a step of their own (subagent blocks); otherwise `view.key`. */
  key?: string;
}

/** The row's identity in a list: its own key, or its step's. */
export const rowKey = (row: Row) => row.key ?? row.view.key;

export interface RowOptions {
  /**
   * Keys of unfolded subagent runs (`<head key>~<n>`, see `runKey`). Each subagent a step
   * launched folds on its own; all start folded.
   */
  unfolded: ReadonlySet<string>;
  /** Subagent traces loaded through `loadTrace`, keyed by `subagent_trajectory_ref`. */
  loaded?: ReadonlyMap<string, TraceView>;
}

/** The key of the n-th subagent run a step launched. */
export const runKey = (head: string, n: number) => `${head}~${n}`;

/**
 * Flattens the step tree into the rows the timeline shows. A subagent's turns come right after
 * the turn that launched it, one run at a time, so parallel subagents read as siblings, never
 * interleaved through the parent's turns.
 */
export function visibleRows(view: TraceView, options: RowOptions): Row[] {
  const rows: Row[] = [];
  const walk = (trace: TraceView, indices: number[], baseDepth: number, run?: string) => {
    for (const index of indices) {
      const step = trace.byIndex.get(index);
      if (!step) continue;
      const ref = step.step.subagent_trajectory_ref;
      const nested = ref ? options.loaded?.get(ref) : undefined;
      const runs = step.children.length ? branchRuns(trace, step) : [];
      const branch = runs.length > 0 || !!ref;
      const keys = runs.length
        ? runs.map((_, i) => runKey(step.key, i))
        : ref
          ? [runKey(step.key, 0)]
          : [];
      const open = keys.some((key) => options.unfolded.has(key));
      rows.push({
        view: step,
        depth: baseDepth + step.depth,
        trace,
        branch,
        branchSize: branch ? countBranch(trace, step) + (nested?.steps.length ?? 0) : undefined,
        open,
        run,
      });
      // Each subagent is its own row, its turns right under it when open.
      const depth = baseDepth + step.depth;
      const headRow = (key: string, i: number, members: ViewStep[]) =>
        rows.push({
          view: step,
          depth,
          trace,
          branch: false,
          open: options.unfolded.has(key),
          run,
          head: { run: key, index: i, members },
          key,
        });
      runs.forEach((members, i) => {
        const key = runKey(step.key, i);
        headRow(key, i, members);
        if (options.unfolded.has(key))
          walk(
            trace,
            members.map((m) => m.index),
            baseDepth,
            key,
          );
      });
      if (ref && !runs.length) {
        const key = runKey(step.key, 0);
        headRow(key, 0, nested?.steps ?? []);
        if (nested && options.unfolded.has(key)) walk(nested, nested.roots, depth + 1, key);
      }
    }
  };
  walk(view, view.roots, 0);
  return rows;
}

/** The run key a step sits in, under the step that launched it. */
export function runOf(trace: TraceView, step: ViewStep): string | undefined {
  if (step.parent == null) return undefined;
  const head = trace.byIndex.get(step.parent);
  if (!head) return undefined;
  const i = branchRuns(trace, head).findIndex((members) => members.includes(step));
  return i >= 0 ? runKey(head.key, i) : undefined;
}

function countBranch(trace: TraceView, step: ViewStep): number {
  let total = 0;
  const stack = [...step.children];
  while (stack.length) {
    const child = trace.byIndex.get(stack.pop() as number);
    if (!child) continue;
    total++;
    stack.push(...child.children);
  }
  return total;
}

/** Keys of every subagent run above a step, outermost first. Unfold these to reveal it. */
export function ancestorsOf(trace: TraceView, step: ViewStep): string[] {
  const keys: string[] = [];
  let current: ViewStep | undefined = step;
  while (current && current.parent != null) {
    const run = runOf(trace, current);
    if (run) keys.unshift(run);
    current = trace.byIndex.get(current.parent);
  }
  return keys;
}

export interface BranchNode {
  key: string;
  label: string;
  size: number;
  depth: number;
  children: BranchNode[];
}

/** The subagent hierarchy only, for an overview of deep nesting. */
export function branchTree(view: TraceView, loaded?: ReadonlyMap<string, TraceView>): BranchNode[] {
  const build = (trace: TraceView, indices: number[], depth: number): BranchNode[] => {
    const nodes: BranchNode[] = [];
    for (const index of indices) {
      const step = trace.byIndex.get(index);
      if (!step) continue;
      const ref = step.step.subagent_trajectory_ref;
      const nested = ref ? loaded?.get(ref) : undefined;
      if (!step.children.length && !ref) continue;
      const first = step.children.length
        ? trace.byIndex.get(step.children[0] as number)
        : undefined;
      nodes.push({
        key: step.key,
        label: first?.step.agent_role ?? step.step.agent_role ?? (ref ? "subagent" : "branch"),
        size: countBranch(trace, step) + (nested?.steps.length ?? 0),
        depth,
        children: [
          ...build(trace, step.children, depth + 1),
          ...(nested ? build(nested, nested.roots, depth + 1) : []),
        ],
      });
    }
    return nodes;
  };
  return build(view, view.roots, 0);
}

/**
 * Splits a branch head's children into subagent runs. One launching step can hold several
 * subagents back to back; a run starts at a subagent's prompt (a user step) or where time
 * jumps backward, as it does between subagents that ran in parallel.
 */
export function branchRuns(trace: TraceView, head: ViewStep): ViewStep[][] {
  const runs: ViewStep[][] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const index of head.children) {
    const child = trace.byIndex.get(index);
    if (!child) continue;
    const time = child.step.timestamp ? Date.parse(child.step.timestamp) : Number.NaN;
    const current = runs.at(-1);
    const fresh = !current || child.step.role === "user" || (!Number.isNaN(time) && time < last);
    if (fresh) runs.push([child]);
    else current.push(child);
    if (!Number.isNaN(time)) last = time;
  }
  return runs;
}
