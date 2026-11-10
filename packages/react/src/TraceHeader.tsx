import type { TraceView } from "@tetraslam/kiseki-core";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { formatCost, formatDuration, formatTokens, shortModel } from "./format";

export interface TraceHeaderProps {
  view: TraceView;
  /** A name shown before the outcome, such as the model when two runs sit side by side. */
  label?: ReactNode;
  /** Controls on the right of the line, such as the search toggle. */
  children?: ReactNode;
}

/** The outcome, and one details popover for everything else about the run. */
export function TraceHeader({ view, label, children }: TraceHeaderProps) {
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
      {label != null && <span className="kiseki-header-label">{label}</span>}
      <span className="kiseki-outcome" data-state={state} title={outcome?.description}>
        <span className="kiseki-outcome-mark" />
        {verdict}
        {outcome?.reward != null && <span className="kiseki-num"> · reward {outcome.reward}</span>}
      </span>
      {view.live && (
        <span className="kiseki-stats kiseki-num">
          <LiveClock start={record.timestamp_start ?? record.steps?.[0]?.timestamp} />
        </span>
      )}
      {totals.errors > 0 && (
        <span className="kiseki-stats kiseki-failed kiseki-num">
          {totals.errors} {totals.errors === 1 ? "call" : "calls"} failed
        </span>
      )}
      <Details
        lead={outcome?.description}
        rows={[
          ["agent", record.agent.name],
          ["model", record.agent.model ? shortModel(record.agent.model) : undefined],
          ["time", totals.durationMs != null ? formatDuration(totals.durationMs) : undefined],
          ["turns", totals.steps.toLocaleString()],
          ["tool calls", totals.toolCalls.toLocaleString()],
          [
            "tokens",
            totals.inputTokens + totals.outputTokens > 0
              ? `${formatTokens(totals.inputTokens)} in, ${formatTokens(totals.outputTokens)} out`
              : undefined,
          ],
          ["cost", totals.costUsd != null ? formatCost(totals.costUsd) : undefined],
        ]}
      />
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

/** Model, time, counts, tokens, and cost, out of the way until asked for. */
function Details({ lead, rows }: { lead?: string; rows: [string, string | undefined][] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const shown = rows.filter((row): row is [string, string] => !!row[1]);
  return (
    <span ref={root} className="kiseki-details">
      <button
        type="button"
        className="kiseki-chip"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        details
      </button>
      <span
        id={id}
        className="kiseki-details-panel"
        data-open={open || undefined}
        role="dialog"
        aria-label="run details"
      >
        {lead && <p className="kiseki-details-lead">{lead}</p>}
        <dl>
          {shown.map(([label, value]) => (
            <span key={label}>
              <dt>{label}</dt>
              <dd className="kiseki-num">{value}</dd>
            </span>
          ))}
        </dl>
      </span>
    </span>
  );
}
