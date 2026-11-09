import type { TraceView } from "@tetraslam/kiseki-core";
import type { ReactNode } from "react";
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
        {totals.durationMs != null && <span>{formatDuration(totals.durationMs)}</span>}
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
