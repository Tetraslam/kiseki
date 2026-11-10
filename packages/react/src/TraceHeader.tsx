import type { TraceView } from "@tetraslam/kiseki-core";
import { type ReactNode, useEffect, useState } from "react";
import { formatCost, formatDuration, formatTokens, shortModel } from "./format";

export interface TraceHeaderProps {
  view: TraceView;
  /** Controls on the right of the line, such as the search toggle. */
  children?: ReactNode;
}

/** One quiet line of stats. The trace below is the content; this only says what kind of run it was. */
export function TraceHeader({ view, children }: TraceHeaderProps) {
  const { record, totals } = view;
  const outcome = record.outcome;
  const state = view.live
    ? "live"
    : outcome?.success === true || outcome?.terminal_state === "goal_reached"
      ? "success"
      : outcome?.success === false ||
          outcome?.terminal_state === "error" ||
          outcome?.terminal_state === "interrupted" ||
          outcome?.terminal_state === "abandoned"
        ? "failure"
        : "unknown";
  const verdict = view.live
    ? "running"
    : outcome?.terminal_state && outcome.terminal_state !== "goal_reached"
      ? outcome.terminal_state.replaceAll("_", " ")
      : state === "success"
        ? "succeeded"
        : state === "failure"
          ? "failed"
          : "finished";
  return (
    <header className="kiseki-header">
      <span className="kiseki-outcome" data-state={state} title={outcome?.description}>
        <span className="kiseki-outcome-mark" />
        {verdict}
        {outcome?.reward != null && <span className="kiseki-num"> · reward {outcome.reward}</span>}
      </span>
      <span className="kiseki-stats kiseki-num">
        {view.live ? (
          <LiveClock start={record.timestamp_start ?? record.steps?.[0]?.timestamp} />
        ) : (
          totals.durationMs != null && <span>{formatDuration(totals.durationMs)}</span>
        )}
        <span>{totals.steps.toLocaleString()} steps</span>
        <span>
          {totals.toolCalls.toLocaleString()} calls
          {totals.errors > 0 && <span className="kiseki-failed"> · {totals.errors} failed</span>}
        </span>
        {totals.inputTokens + totals.outputTokens > 0 && (
          <span>
            {formatTokens(totals.inputTokens)} → {formatTokens(totals.outputTokens)} tok
          </span>
        )}
        {totals.costUsd != null && <span>{formatCost(totals.costUsd)}</span>}
        <span className="kiseki-stats-agent">
          {record.agent.name}
          {record.agent.model && ` · ${shortModel(record.agent.model)}`}
        </span>
      </span>
      {children}
    </header>
  );
}

/** Elapsed time of a running trace, ticking each second. Its own component, so only it re-renders. */
function LiveClock({ start }: { start?: string }) {
  // Times are read only after mount, so server and client render the same first frame.
  const [times, setTimes] = useState<{ origin: number; now: number } | null>(null);
  useEffect(() => {
    const origin = Date.now();
    setTimes({ origin, now: origin });
    const timer = setInterval(() => setTimes((t) => (t ? { ...t, now: Date.now() } : t)), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!times) return <span className="kiseki-clock">0:00</span>;
  const from = start ? Date.parse(start) : times.origin;
  // Replays carry old timestamps; count from when the view started instead of the recording.
  const base = Number.isNaN(from) || times.now - from > 6 * 3_600_000 ? times.origin : from;
  return <span className="kiseki-clock">{clock(times.now - base)}</span>;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
