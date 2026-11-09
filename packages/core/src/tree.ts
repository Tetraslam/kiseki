import type { TraceView, ViewStep } from "./normalize";

/** One visible line of the timeline. */
export interface Row {
  view: ViewStep;
  /** Indentation, counting nested subagent traces. */
  depth: number;
  /** The trace that owns the step: the root trace, or a loaded subagent trace. */
  trace: TraceView;
  /** Whether the step heads a branch (inline children or a subagent reference). */
  branch: boolean;
  /** Steps under this head, when known. */
  branchSize?: number;
  open: boolean;
}

export interface RowOptions {
  /** Keys of branch heads the user unfolded. Branches start folded. */
  unfolded: ReadonlySet<string>;
  /** Subagent traces loaded through `loadTrace`, keyed by `subagent_trajectory_ref`. */
  loaded?: ReadonlyMap<string, TraceView>;
}

/** Flattens the step tree into the rows the timeline shows, in pre-order. */
export function visibleRows(view: TraceView, options: RowOptions): Row[] {
  const rows: Row[] = [];
  const walk = (trace: TraceView, indices: number[], baseDepth: number) => {
    for (const index of indices) {
      const step = trace.byIndex.get(index);
      if (!step) continue;
      const ref = step.step.subagent_trajectory_ref;
      const nested = ref ? options.loaded?.get(ref) : undefined;
      const branch = step.children.length > 0 || !!ref;
      const open = branch && options.unfolded.has(step.key);
      rows.push({
        view: step,
        depth: baseDepth + step.depth,
        trace,
        branch,
        branchSize: branch ? countBranch(trace, step) + (nested?.steps.length ?? 0) : undefined,
        open,
      });
      if (!open) continue;
      walk(trace, step.children, baseDepth);
      if (nested) walk(nested, nested.roots, baseDepth + step.depth + 1);
    }
  };
  walk(view, view.roots, 0);
  return rows;
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

/** Keys of every branch head above a step, outermost first. Unfold these to reveal it. */
export function ancestorsOf(trace: TraceView, step: ViewStep): string[] {
  const keys: string[] = [];
  let parent = step.parent != null ? trace.byIndex.get(step.parent) : undefined;
  while (parent) {
    keys.unshift(parent.key);
    parent = parent.parent != null ? trace.byIndex.get(parent.parent) : undefined;
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
