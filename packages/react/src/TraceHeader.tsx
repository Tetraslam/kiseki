import type { TraceView } from "@tetraslam/kiseki-core";
import { formatCost, formatDuration, formatTokens, oneLine, shortModel } from "./format";

export interface TraceHeaderProps {
  view: TraceView;
  /** Replaces the task description as the title. */
  title?: string;
}

/** Task, agent and model, outcome, duration, tokens, and cost. */
export function TraceHeader({ view, title }: TraceHeaderProps) {
  const { record, totals } = view;
  const outcome = record.outcome;
  const heading =
    title ??
    record.task?.description ??
    oneLine(record.steps?.find((s) => s.role === "user")?.content ?? "", 160) ??
    record.trace_id;
  const state =
    outcome?.success === true ? "success" : outcome?.success === false ? "failure" : "unknown";
  const outcomeText =
    outcome?.terminal_state?.replaceAll("_", " ") ??
    (outcome?.success === true ? "succeeded" : outcome?.success === false ? "failed" : undefined);
  return (
    <header className="kiseki-header">
      <h2 className="kiseki-title">{heading || record.trace_id}</h2>
      <div className="kiseki-meta">
        {(outcomeText || view.live) && (
          <span
            className="kiseki-outcome"
            data-state={view.live ? "live" : state}
            title={outcome?.description}
          >
            {view.live ? "running" : outcomeText}
          </span>
        )}
        {outcome?.reward != null && (
          <span>
            <span className="kiseki-meta-label">reward</span>
            <span className="kiseki-num">{outcome.reward}</span>
          </span>
        )}
        <span>
          {record.agent.name}
          {record.agent.model && (
            <span className="kiseki-dim">{shortModel(record.agent.model)}</span>
          )}
        </span>
        {totals.durationMs != null && (
          <span>
            <span className="kiseki-num">{formatDuration(totals.durationMs)}</span>
          </span>
        )}
        <span>
          <span className="kiseki-num">{totals.steps.toLocaleString()}</span>
          <span className="kiseki-meta-label">steps</span>
        </span>
        {totals.toolCalls > 0 && (
          <span>
            <span className="kiseki-num">{totals.toolCalls.toLocaleString()}</span>
            <span className="kiseki-meta-label">calls</span>
            {totals.errors > 0 && (
              <span className="kiseki-num kiseki-failed">{totals.errors} failed</span>
            )}
          </span>
        )}
        {totals.inputTokens + totals.outputTokens > 0 && (
          <span>
            <span className="kiseki-num">
              {formatTokens(totals.inputTokens)} → {formatTokens(totals.outputTokens)}
            </span>
            <span className="kiseki-meta-label">tokens</span>
          </span>
        )}
        {totals.costUsd != null && (
          <span>
            <span className="kiseki-num">{formatCost(totals.costUsd)}</span>
          </span>
        )}
      </div>
    </header>
  );
}
