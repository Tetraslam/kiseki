import type { Step, TraceRecord } from "@tetraslam/kiseki";
import { useEffect, useMemo, useRef, useState } from "react";

/** Characters per second while "generating" text. A fast model, sped up a little. */
const CHARS_PER_SECOND = 420;
const TICK = 40;

interface Cursor {
  step: number;
  /** 0: thinking, 1: writing, 2: calling tools, 3: results in. */
  phase: number;
  chars: number;
  waited: number;
}

/**
 * Replays a recorded run the way it streamed: reasoning and text arrive character by character,
 * tool calls appear running, then their results land. Returns the growing record.
 */
export function useStreamed(recorded: TraceRecord, playing: boolean, onDone?: () => void) {
  // Move the recording to now, so the live clock and turn times count from when playback began.
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const first = Date.parse(recorded.timestamp_start ?? recorded.steps?.[0]?.timestamp ?? "");
    setOffset(Number.isNaN(first) ? 0 : Date.now() - first);
  }, [playing, recorded]);
  const source = useMemo(() => shift(recorded, offset), [recorded, offset]);
  const [cursor, setCursor] = useState<Cursor>({ step: 0, phase: 0, chars: 0, waited: 0 });
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const steps = source.steps ?? [];
  const finished = cursor.step >= steps.length;

  useEffect(() => {
    if (!playing) setCursor({ step: 0, phase: 0, chars: 0, waited: 0 });
  }, [playing]);

  useEffect(() => {
    if (!playing || finished) return;
    const timer = setInterval(() => {
      setCursor((c) => advance(c, steps));
    }, TICK);
    return () => clearInterval(timer);
  }, [playing, finished, steps]);

  useEffect(() => {
    if (playing && finished) done.current?.();
  }, [playing, finished]);

  if (!playing) return { record: { ...source, steps: [] } as TraceRecord, live: false };
  if (finished) return { record: source, live: false };
  const shown: Step[] = steps.slice(0, cursor.step);
  const current = steps[cursor.step];
  if (current) shown.push(partial(current, cursor));
  return {
    record: {
      ...source,
      steps: shown,
      outcome: undefined,
      metrics: undefined,
      timestamp_end: undefined,
    },
    live: true,
  };
}

function advance(c: Cursor, steps: Step[]): Cursor {
  const step = steps[c.step];
  if (!step) return c;
  const perTick = (CHARS_PER_SECOND * TICK) / 1000;
  const reasoning = step.reasoning_content?.length ?? 0;
  const content = step.content?.length ?? 0;
  const calls = step.tool_calls?.length ?? 0;
  const next = (): Cursor => ({ step: c.step + 1, phase: 0, chars: 0, waited: 0 });
  if (step.role !== "agent") {
    // Prompts and system messages arrive whole, after a beat.
    return c.waited > 250 ? next() : { ...c, waited: c.waited + TICK };
  }
  if (c.phase === 0) {
    if (c.chars + perTick < reasoning) return { ...c, chars: c.chars + perTick * 1.6 };
    return { ...c, phase: 1, chars: 0 };
  }
  if (c.phase === 1) {
    if (c.chars + perTick < content) return { ...c, chars: c.chars + perTick };
    return calls ? { ...c, phase: 2, chars: 0, waited: 0 } : next();
  }
  if (c.phase === 2) {
    // Calls run for their recorded duration, clamped so the replay keeps moving.
    const longest = Math.max(0, ...(step.tool_calls ?? []).map((call) => call.duration_ms ?? 0));
    const wait = Math.min(1400, Math.max(350, longest));
    return c.waited >= wait ? { ...c, phase: 3, waited: 0 } : { ...c, waited: c.waited + TICK };
  }
  return c.waited > 200 ? next() : { ...c, waited: c.waited + TICK };
}

function partial(step: Step, c: Cursor): Step {
  if (step.role !== "agent") return step;
  const reasoning = step.reasoning_content ?? "";
  const content = step.content ?? "";
  if (c.phase === 0) {
    return {
      ...step,
      reasoning_content: reasoning.slice(0, Math.floor(c.chars)) || undefined,
      content: undefined,
      tool_calls: [],
      observations: [],
    };
  }
  if (c.phase === 1) {
    return {
      ...step,
      content: content.slice(0, Math.floor(c.chars)) || undefined,
      tool_calls: [],
      observations: [],
    };
  }
  if (c.phase === 2) return { ...step, observations: [] };
  return step;
}

function shift(record: TraceRecord, ms: number): TraceRecord {
  if (!ms) return record;
  const move = (iso?: string) =>
    iso && !Number.isNaN(Date.parse(iso)) ? new Date(Date.parse(iso) + ms).toISOString() : iso;
  return {
    ...record,
    timestamp_start: move(record.timestamp_start),
    timestamp_end: move(record.timestamp_end),
    steps: record.steps?.map((step) => ({ ...step, timestamp: move(step.timestamp) })),
  };
}
