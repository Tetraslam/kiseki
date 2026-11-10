import { normalize, type RunSummary, summarizeRun, type TraceRecord } from "@tetraslam/kiseki-core";
import { type CSSProperties, useMemo } from "react";

export interface TraceListProps {
  records: TraceRecord[];
  selected?: string | null;
  onSelect?: (traceId: string) => void;
  /** Replaces or extends the signals kiseki reads from each trace (tests, errors, edits). */
  summarize?: (record: TraceRecord, summary: RunSummary) => RunSummary;
  /** Reference time for "2h ago". Defaults to now; pass one for stable server rendering. */
  now?: number;
  theme?: "light" | "dark";
  className?: string;
  style?: CSSProperties;
}

/**
 * A list of runs, one row each: what was asked, and a plain line of what happened (failed, tests,
 * edits, subagents). Rows are buttons; arrow keys move between them.
 */
export function TraceList({
  records,
  selected,
  onSelect,
  summarize,
  now,
  theme,
  className,
  style,
}: TraceListProps) {
  const rows = useMemo(
    () =>
      records.map((record) => {
        const summary = summarizeRun(normalize(record));
        return summarize ? summarize(record, summary) : summary;
      }),
    [records, summarize],
  );
  return (
    <div
      className={className ? `kiseki kiseki-list ${className}` : "kiseki kiseki-list"}
      style={style}
      data-theme={theme}
      role="listbox"
      aria-label="runs"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const at = rows.findIndex((r) => r.key === selected);
        const next =
          rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
        if (next) {
          onSelect?.(next.key);
          (
            event.currentTarget.querySelector(
              `[data-run="${CSS.escape(next.key)}"]`,
            ) as HTMLElement | null
          )?.focus();
        }
      }}
    >
      {rows.map((run) => (
        <button
          key={run.key}
          type="button"
          role="option"
          aria-selected={selected === run.key}
          data-run={run.key}
          className="kiseki-run"
          onClick={() => onSelect?.(run.key)}
        >
          <span className="kiseki-run-head">
            <span className="kiseki-run-title">{run.title}</span>
            <span className="kiseki-run-when kiseki-num">{ago(run.startedAt, now)}</span>
          </span>
          <span className="kiseki-run-signals" data-outcome={run.outcome}>
            {[
              run.outcome === "failure" ? "failed" : run.outcome === "live" ? "running" : "",
              ...run.signals.map((s) => s.label),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      ))}
    </div>
  );
}

function ago(at: number | undefined, now = Date.now()): string {
  if (at == null) return "";
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
