import type { TraceView, ViewStep } from "./normalize";
import { branchRuns } from "./tree";

export type SegmentKind = "user" | "system" | "agent" | "tools";

/** One step drawn on the overview: a span of time (or of step order) in one lane. */
export interface Segment {
  key: string;
  lane: number;
  start: number;
  end: number;
  kind: SegmentKind;
  error: boolean;
  tokens: number;
  /** The part of the span spent waiting on this step's subagents. */
  wait?: { start: number; end: number };
}

export interface OverviewLane {
  label: string;
  depth: number;
}

export interface Overview {
  /** `time` places steps at their timestamps (ms); `steps` places them by order. */
  scale: "time" | "steps";
  start: number;
  end: number;
  lanes: OverviewLane[];
  /** In reading order, so the timeline's position maps to an index. */
  segments: Segment[];
  maxTokens: number;
}

export interface OverviewOptions {
  scale?: "time" | "steps" | "auto";
  /** Subagent lanes beyond this share the last one. */
  maxLanes?: number;
  loaded?: ReadonlyMap<string, TraceView>;
}

interface Placed {
  view: ViewStep;
  start: number;
  end: number;
  depth: number;
  /** The branch run this step belongs to, for lane packing. */
  run: number;
}

/**
 * Lays a trace out as lanes over time: the main agent on lane 0, subagents on lanes below.
 * Subagent runs that overlap in time get separate lanes, so parallel work reads as parallel;
 * runs that don't overlap share one. A step that launched subagents is marked as waiting for
 * as long as they ran.
 */
export function layoutOverview(view: TraceView, options: OverviewOptions = {}): Overview {
  const maxLanes = options.maxLanes ?? 6;
  const ordered: {
    view: ViewStep;
    trace: TraceView;
    depth: number;
    run: number;
    head?: ViewStep;
  }[] = [];
  let runs = 0;
  const walk = (trace: TraceView, indices: number[], depth: number, run: number) => {
    for (const index of indices) {
      const step = trace.byIndex.get(index);
      if (!step) continue;
      ordered.push({ view: step, trace, depth, run });
      for (const members of branchRuns(trace, step)) {
        walk(
          trace,
          members.map((m) => m.index),
          depth + 1,
          ++runs,
        );
      }
      const ref = step.step.subagent_trajectory_ref;
      const nested = ref ? options.loaded?.get(ref) : undefined;
      if (nested) walk(nested, nested.roots, depth + 1, ++runs);
    }
  };
  walk(view, view.roots, 0, 0);

  const timed = ordered.filter(
    (o) => o.view.step.timestamp && !Number.isNaN(Date.parse(o.view.step.timestamp)),
  );
  const scale =
    options.scale && options.scale !== "auto"
      ? options.scale
      : ordered.length && timed.length / ordered.length >= 0.8
        ? "time"
        : "steps";

  const placed: Placed[] = [];
  if (scale === "time") {
    let last = 0;
    for (const o of ordered) {
      const parsed = o.view.step.timestamp ? Date.parse(o.view.step.timestamp) : Number.NaN;
      const start = Number.isNaN(parsed) ? last : parsed;
      // A step with no known duration still gets a sliver, so it can be seen and clicked.
      const end = start + Math.max(o.view.durationMs ?? 0, 1);
      placed.push({ view: o.view, start, end, depth: o.depth, run: o.run });
      last = end;
    }
  } else {
    ordered.forEach((o, i) => {
      placed.push({ view: o.view, start: i, end: i + 1, depth: o.depth, run: o.run });
    });
  }

  // Pack each branch run into the first lane at its depth that is free for the run's span.
  const spans = new Map<number, { start: number; end: number; depth: number; label: string }>();
  for (const p of placed) {
    if (p.run === 0) continue;
    const span = spans.get(p.run);
    if (span) {
      span.start = Math.min(span.start, p.start);
      span.end = Math.max(span.end, p.end);
    } else {
      spans.set(p.run, {
        start: p.start,
        end: p.end,
        depth: p.depth,
        label: p.view.step.agent_role ?? "subagent",
      });
    }
  }
  const lanes: OverviewLane[] = [{ label: "main", depth: 0 }];
  const laneEnds: number[] = [Number.POSITIVE_INFINITY];
  const laneOf = new Map<number, number>([[0, 0]]);
  for (const [run, span] of [...spans].sort((a, b) => a[1].start - b[1].start)) {
    let lane = -1;
    for (let i = 1; i < lanes.length; i++) {
      if (lanes[i]?.depth === span.depth && (laneEnds[i] as number) <= span.start) {
        lane = i;
        break;
      }
    }
    if (lane < 0) {
      if (lanes.length < maxLanes) {
        lane = lanes.length;
        lanes.push({ label: span.label, depth: span.depth });
        laneEnds.push(span.end);
      } else lane = lanes.length - 1;
    }
    laneEnds[lane] = Math.max(laneEnds[lane] as number, span.end);
    const existing = lanes[lane] as OverviewLane;
    if (existing.label !== span.label) existing.label = "subagents";
    laneOf.set(run, lane);
  }

  // Branch members per launching step, nested traces included, to measure the wait.
  const placedOf = new Map(placed.map((p) => [p.view, p]));
  const traceOf = new Map(ordered.map((o) => [o.view, o.trace]));
  const branchSpan = (head: ViewStep): { start: number; end: number } | undefined => {
    const trace = traceOf.get(head);
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    const visit = (step: ViewStep, owner: TraceView | undefined) => {
      for (const index of step.children) {
        const child = owner?.byIndex.get(index);
        const p = child ? placedOf.get(child) : undefined;
        if (!child || !p) continue;
        start = Math.min(start, p.start);
        end = Math.max(end, p.end);
        visit(child, owner);
      }
    };
    visit(head, trace);
    const ref = head.step.subagent_trajectory_ref;
    const nested = ref ? options.loaded?.get(ref) : undefined;
    for (const s of nested?.steps ?? []) {
      const p = placedOf.get(s);
      if (!p) continue;
      start = Math.min(start, p.start);
      end = Math.max(end, p.end);
    }
    return Number.isFinite(start) ? { start, end } : undefined;
  };

  let maxTokens = 0;
  const segments: Segment[] = placed.map((p) => {
    const { step } = p.view;
    const tokens = (p.view.tokens.input_tokens ?? 0) + (p.view.tokens.output_tokens ?? 0);
    maxTokens = Math.max(maxTokens, tokens);
    const segment: Segment = {
      key: p.view.key,
      lane: laneOf.get(p.run) ?? 0,
      start: p.start,
      end: p.end,
      kind:
        step.role === "user"
          ? "user"
          : step.role === "system"
            ? "system"
            : p.view.calls.length
              ? "tools"
              : "agent",
      error: p.view.calls.some((c) => c.status === "error") || step.error != null,
      tokens,
    };
    const branch =
      p.view.children.length || step.subagent_trajectory_ref ? branchSpan(p.view) : undefined;
    if (branch && scale === "time") {
      const wait = { start: Math.max(p.start, branch.start), end: Math.min(p.end, branch.end) };
      if (wait.end > wait.start) segment.wait = wait;
    }
    return segment;
  });

  const start = placed.length ? Math.min(...placed.map((p) => p.start)) : 0;
  const end = placed.length ? Math.max(...placed.map((p) => p.end)) : 1;
  return { scale, start, end: Math.max(end, start + 1), lanes, segments, maxTokens };
}

/** The segment nearest to a position on the axis, for hit testing and keyboard scrubbing. */
export function segmentAt(overview: Overview, at: number, lane?: number): Segment | undefined {
  let best: Segment | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const segment of overview.segments) {
    if (lane != null && segment.lane !== lane) continue;
    const d = at < segment.start ? segment.start - at : at > segment.end ? at - segment.end : 0;
    if (d < distance) {
      distance = d;
      best = segment;
      if (d === 0) break;
    }
  }
  return best;
}
