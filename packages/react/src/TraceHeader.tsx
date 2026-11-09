import type { TraceView } from "@tetraslam/kiseki-core";
import { useState } from "react";
import { Markdown } from "./blocks";
import { formatCost, formatDuration, formatTokens, oneLine, shortModel } from "./format";
import { finalAnswer } from "./insight";

export interface TraceHeaderProps {
  view: TraceView;
  /** Replaces the agent's final answer under the outcome. */
  summary?: string;
}

/**
 * The verdict first: outcome and the agent's answer. Then the numbers people check (time, cost,
 * failures). The prompt and the rest recede into one quiet line.
 */
export function TraceHeader({ view, summary }: TraceHeaderProps) {
  const { record, totals } = view;
  const outcome = record.outcome;
  const [open, setOpen] = useState(false);
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
  const answer = summary ?? (view.live ? undefined : finalAnswer(view));
  const long = (answer?.length ?? 0) > 360 || (answer?.split("\n").length ?? 0) > 5;
  const prompt =
    record.task?.description ?? record.steps?.find((s) => s.role === "user")?.content ?? "";
  return (
    <header className="kiseki-header">
      <div className="kiseki-verdict">
        <span className="kiseki-outcome" data-state={state} title={outcome?.description}>
          <span className="kiseki-outcome-mark" />
          {verdict}
          {outcome?.reward != null && <span className="kiseki-num">reward {outcome.reward}</span>}
        </span>
        <span className="kiseki-key-metrics">
          {totals.durationMs != null && <span>{formatDuration(totals.durationMs)}</span>}
          {totals.costUsd != null && <span>{formatCost(totals.costUsd)}</span>}
          {totals.errors > 0 && (
            <span className="kiseki-failed">
              {totals.errors}
              <span className="kiseki-unit kiseki-failed">
                failed {totals.errors === 1 ? "call" : "calls"}
              </span>
            </span>
          )}
        </span>
      </div>
      {answer && (
        <div>
          <div className="kiseki-answer" data-clamped={(long && !open) || undefined}>
            <Markdown text={answer} />
          </div>
          {long && (
            <button
              type="button"
              className="kiseki-more"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "show less" : "show the whole answer"}
            </button>
          )}
        </div>
      )}
      {!answer && outcome?.description && (
        <div className="kiseki-answer">{outcome.description}</div>
      )}
      <div className="kiseki-context">
        {prompt && (
          <span className="kiseki-prompt" title={prompt}>
            <b>asked</b> {oneLine(prompt.replace(/^"(.*)"$/s, "$1"), 240)}
          </span>
        )}
        <span className="kiseki-num">
          {totals.steps.toLocaleString()} steps · {totals.toolCalls.toLocaleString()} calls
          {totals.inputTokens + totals.outputTokens > 0 &&
            ` · ${formatTokens(totals.inputTokens)} → ${formatTokens(totals.outputTokens)} tokens`}
        </span>
        <span>
          {record.agent.name}
          {record.agent.model && ` · ${shortModel(record.agent.model)}`}
        </span>
      </div>
    </header>
  );
}
