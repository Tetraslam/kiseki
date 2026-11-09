import type { Observation, Patch, Step, TokenUsage, ToolCall, TraceRecord } from "./types";

export type CallStatus = "ok" | "error" | "pending" | "missing";

/** A tool call with the observation that answers it. */
export interface PairedCall {
  call: ToolCall;
  observation?: Observation;
  /** `pending` while a live trace waits for the result, `missing` once the trace is complete. */
  status: CallStatus;
  patches: Patch[];
  stepIndex: number;
}

export interface ViewStep {
  /** Stable identity for selection, expansion, and permalinks. */
  key: string;
  index: number;
  /** Position in `record.steps`. */
  position: number;
  step: Step;
  calls: PairedCall[];
  /** Observations whose `source_call_id` matches no call in the step. */
  strayObservations: Observation[];
  /** Every patch produced by this step, including the ones attached to its calls. */
  patches: Patch[];
  parent?: number;
  children: number[];
  depth: number;
  durationMs?: number;
  tokens: TokenUsage;
  /** Role plus sorted tool names. Used to align two runs. */
  signature: string;
}

export interface TraceTotals {
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs?: number;
  costUsd?: number;
  toolCalls: number;
  errors: number;
}

export interface TraceView {
  record: TraceRecord;
  steps: ViewStep[];
  byIndex: Map<number, ViewStep>;
  byKey: Map<string, ViewStep>;
  /** Step indices with no parent, in record order. */
  roots: number[];
  totals: TraceTotals;
  live: boolean;
  hasBranches: boolean;
}

export interface NormalizeOptions {
  /** The trace is still growing, so unanswered calls are pending rather than missing. */
  live?: boolean;
  /** Prefix for step keys, used when a subagent trace is nested inside another. */
  keyPrefix?: string;
}

export function normalize(record: TraceRecord, options: NormalizeOptions = {}): TraceView {
  const live = options.live ?? false;
  const prefix = options.keyPrefix ?? "";
  const source = record.steps ?? [];

  const patchesByStep = new Map<number, Patch[]>();
  const patchesByCall = new Map<string, Patch[]>();
  const callStep = new Map<string, number>();
  for (const step of source) {
    for (const call of step.tool_calls ?? []) callStep.set(call.tool_call_id, step.step_index);
  }
  for (const patch of record.patches ?? []) {
    const stepIndex =
      patch.step_index ?? (patch.tool_call_id ? callStep.get(patch.tool_call_id) : undefined);
    if (stepIndex != null) push(patchesByStep, stepIndex, patch);
    if (patch.tool_call_id) push(patchesByCall, patch.tool_call_id, patch);
  }

  const steps: ViewStep[] = [];
  const byIndex = new Map<number, ViewStep>();
  const byKey = new Map<string, ViewStep>();
  let toolCalls = 0;
  let errors = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  source.forEach((step, position) => {
    const observations = new Map<string, Observation>();
    if (step.observations?.length) {
      for (const observation of step.observations) {
        observations.set(observation.source_call_id, observation);
      }
    }
    const calls: PairedCall[] = (step.tool_calls ?? EMPTY).map((call) => {
      const observation = observations.get(call.tool_call_id);
      observations.delete(call.tool_call_id);
      const status: CallStatus = observation
        ? observation.error
          ? "error"
          : "ok"
        : live
          ? "pending"
          : "missing";
      if (status === "error") errors++;
      return {
        call,
        observation,
        status,
        patches: patchesByCall.get(call.tool_call_id) ?? EMPTY,
        stepIndex: step.step_index,
      };
    });
    toolCalls += calls.length;
    const tokens = step.token_usage ?? {};
    inputTokens += tokens.input_tokens ?? 0;
    outputTokens += tokens.output_tokens ?? 0;
    cacheReadTokens += tokens.cache_read_tokens ?? 0;
    const view: ViewStep = {
      key: `${prefix}${step.step_index}`,
      index: step.step_index,
      position,
      step,
      calls,
      strayObservations: observations.size ? [...observations.values()] : EMPTY,
      patches: patchesByStep.get(step.step_index) ?? EMPTY,
      children: [],
      depth: 0,
      tokens,
      signature: signatureOf(step),
    };
    steps.push(view);
    byIndex.set(step.step_index, view);
    byKey.set(view.key, view);
  });

  // Build the tree. A parent must appear earlier in the record, which also rules out cycles.
  const roots: number[] = [];
  for (const view of steps) {
    const parentIndex = view.step.parent_step;
    const parent = parentIndex != null ? byIndex.get(parentIndex) : undefined;
    if (parent && parent.position < view.position) {
      view.parent = parent.index;
      view.depth = parent.depth + 1;
      parent.children.push(view.index);
    } else roots.push(view.index);
  }

  // A step lasts until the next step on the same branch starts. A live trace has no end yet,
  // whatever its record says.
  const end = live ? undefined : parseTime(record.timestamp_end);
  const times = new Map<number, number | undefined>();
  for (const view of steps) times.set(view.index, parseTime(view.step.timestamp));
  const assignDurations = (siblings: number[], branchEnd: number | undefined) => {
    for (let i = 0; i < siblings.length; i++) {
      const view = byIndex.get(siblings[i] as number) as ViewStep;
      const start = times.get(view.index);
      const next = siblings[i + 1];
      const nextStart = next != null ? times.get(next) : branchEnd;
      if (start != null && nextStart != null && nextStart >= start) {
        view.durationMs = nextStart - start;
      } else {
        const toolTime = view.calls.reduce((sum, c) => sum + (c.call.duration_ms ?? 0), 0);
        if (toolTime > 0) view.durationMs = toolTime;
      }
      if (view.children.length) assignDurations(view.children, nextStart ?? undefined);
    }
  };
  assignDurations(roots, end);

  const metrics = record.metrics ?? {};
  const startTime = parseTime(record.timestamp_start) ?? parseTime(source[0]?.timestamp);
  const endTime = end ?? lastTime(source);
  const computedDuration =
    startTime != null && endTime != null && endTime >= startTime ? endTime - startTime : undefined;

  return {
    record,
    steps,
    byIndex,
    byKey,
    roots,
    live,
    hasBranches: steps.some((s) => s.children.length > 0 || s.step.subagent_trajectory_ref),
    totals: {
      steps: metrics.total_steps ?? steps.length,
      inputTokens: metrics.total_input_tokens ?? inputTokens,
      outputTokens: metrics.total_output_tokens ?? outputTokens,
      cacheReadTokens: metrics.total_cache_read_tokens ?? cacheReadTokens,
      durationMs:
        metrics.total_duration_s != null ? metrics.total_duration_s * 1000 : computedDuration,
      costUsd: metrics.estimated_cost_usd,
      toolCalls,
      errors,
    },
  };
}

// Shared and never mutated, so steps without calls or patches allocate nothing.
const EMPTY: never[] = [];

export function signatureOf(step: Step): string {
  const tools = (step.tool_calls ?? []).map((call) => call.tool_name).sort();
  return tools.length ? `${step.role}:${tools.join(",")}` : step.role;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function parseTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

function lastTime(steps: Step[]): number | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const time = parseTime(steps[i]?.timestamp);
    if (time != null) return time;
  }
  return undefined;
}
