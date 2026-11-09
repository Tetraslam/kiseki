import { branchRuns, type Row } from "@tetraslam/kiseki-core";
import { memo } from "react";
import { CallSlot, Chevron, Message, PatchBlock, Reasoning } from "./blocks";
import { reasoningKey, systemKey, useTrace } from "./context";
import { elapsed, formatDuration, formatTokens, oneLine, shortModel } from "./format";

export type BranchState = "idle" | "loading" | "loaded" | "error";

export interface StepRowProps {
  row: Row;
  selected: boolean;
  match: boolean;
  branchState: BranchState;
  /** Kept for hosts that render rows themselves; turns now carry their own rule. */
  turn?: boolean;
  /** Marks the turn number for Element Timing, so a perf script can read when it painted. */
  timing?: boolean;
  onSelect: (key: string) => void;
  onToggleBranch: (key: string) => void;
}

/**
 * One turn of the run: a thin rule with its number and time, then what the agent thought and
 * said at full reading weight, then its tool calls as compact lines.
 */
export const StepRow = memo(function StepRow({
  row,
  selected,
  match,
  branchState,
  timing,
  onSelect,
  onToggleBranch,
}: StepRowProps) {
  const context = useTrace();
  const { view, trace } = row;
  const { step } = view;
  const { renderers, outliers } = context;
  const model = step.model && step.model !== context.traceModel ? shortModel(step.model) : "";
  const totalTokens = (view.tokens.input_tokens ?? 0) + (view.tokens.output_tokens ?? 0);
  const callIds = new Set(view.calls.map((c) => c.call.tool_call_id));
  const loosePatches = view.patches.filter((p) => !p.tool_call_id || !callIds.has(p.tool_call_id));
  const latest = trace.steps.at(-1) === view;
  const streaming = trace.live && latest;
  const UserRenderer = renderers.user;
  const SystemRenderer = renderers.system;
  const MessageRenderer = renderers.message ?? Message;
  const ReasoningRenderer = renderers.reasoning ?? Reasoning;
  const systemOpen = context.isExpanded(systemKey(view.key));
  const subagentPrompt = step.role === "user" && step.call_type === "subagent";
  const label =
    step.role === "user"
      ? subagentPrompt
        ? `${step.agent_role ?? "subagent"} task`
        : "prompt"
      : step.role === "system"
        ? "system"
        : step.call_type === "subagent"
          ? (step.agent_role ?? "subagent")
          : "";
  // Not in OpenTraces: adapters record a failed LLM call (an abort, a provider error) here.
  const stepError =
    typeof step.error === "string"
      ? step.error
      : step.error && typeof step.error === "object" && "message" in step.error
        ? String((step.error as { message: unknown }).message)
        : undefined;
  const start = context.root.record.timestamp_start ?? context.root.record.steps?.[0]?.timestamp;
  const time = elapsed(step.timestamp, start ? Date.parse(start) : undefined);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the timeline handles keys for every row.
    // biome-ignore lint/a11y/noStaticElementInteractions: rows select on click; j/k select from the keyboard.
    <div
      className="kiseki-step"
      data-role={step.role}
      data-selected={selected || undefined}
      data-match={match || undefined}
      data-prose={context.prose}
      onClick={() => onSelect(view.key)}
    >
      <div
        className="kiseki-body"
        data-depth={row.depth || undefined}
        style={{ "--kiseki-depth": row.depth } as React.CSSProperties}
      >
        <div className="kiseki-rule">
          <span
            className="kiseki-rule-num kiseki-num"
            {...(timing ? { elementtiming: "kiseki-first-row" } : {})}
          >
            {String(view.position).padStart(2, "0")}
          </span>
          {label && <span className="kiseki-rule-label">{label}</span>}
          <span className="kiseki-rule-line" />
          <span className="kiseki-rule-meta kiseki-num">
            {/* Floats over the hairline, so showing it on hover moves nothing. */}
            <span className="kiseki-rule-extra">
              {model && <span>{model}</span>}
              {totalTokens > 0 && (
                <span data-outlier={outliers.tokens.has(view.key) || undefined}>
                  {formatTokens(totalTokens)} tok
                </span>
              )}
              {view.durationMs != null && (
                <span data-outlier={outliers.duration.has(view.key) || undefined}>
                  {formatDuration(view.durationMs)}
                </span>
              )}
            </span>
            {time}
          </span>
        </div>
        {step.role === "system" && step.content ? (
          SystemRenderer ? (
            <SystemRenderer view={view} row={row} trace={trace} />
          ) : (
            <div>
              <div className={`kiseki-system${systemOpen ? "" : " kiseki-clamp"}`}>
                {step.content}
              </div>
              {step.content.length > 240 && (
                <button
                  type="button"
                  className="kiseki-more"
                  aria-expanded={systemOpen}
                  onClick={() => context.toggle(systemKey(view.key))}
                >
                  {systemOpen ? "show less" : "show all"}
                </button>
              )}
            </div>
          )
        ) : null}
        {step.role === "user" && step.content ? (
          UserRenderer ? (
            <UserRenderer view={view} row={row} trace={trace} />
          ) : subagentPrompt ? (
            <div>
              <div className={`kiseki-task${systemOpen ? "" : " kiseki-clamp"}`}>
                {step.content.replace(/^You are a subagent[^\n]*\n+/i, "")}
              </div>
              {step.content.length > 240 && (
                <button
                  type="button"
                  className="kiseki-more"
                  aria-expanded={systemOpen}
                  onClick={() => context.toggle(systemKey(view.key))}
                >
                  {systemOpen ? "show less" : "show all"}
                </button>
              )}
            </div>
          ) : (
            <div className="kiseki-user">{step.content.replace(/^"(.*)"$/s, "$1")}</div>
          )
        ) : null}
        {step.reasoning_content && (
          <ReasoningRenderer
            text={step.reasoning_content}
            view={view}
            expanded={context.isExpanded(reasoningKey(view.key))}
            onToggle={() => context.toggle(reasoningKey(view.key))}
          />
        )}
        {step.role === "agent" && step.content && (
          <MessageRenderer text={step.content} view={view} streaming={streaming} />
        )}
        {view.calls.length > 0 && (
          <div className="kiseki-calls">
            {view.calls.map((paired) => (
              <CallSlot key={paired.call.tool_call_id} view={view} paired={paired} />
            ))}
          </div>
        )}
        {stepError && <div className="kiseki-error">{stepError}</div>}
        {view.strayObservations.map((observation) => (
          <div key={observation.source_call_id} className="kiseki-note">
            result for unknown call{" "}
            <span className="kiseki-mono">{observation.source_call_id}</span>
            {observation.output_summary ? `: ${oneLine(observation.output_summary, 140)}` : ""}
          </div>
        ))}
        {loosePatches.map((patch) => (
          <PatchBlock key={patch.patch_id} patch={patch} stepKey={view.key} />
        ))}
        {row.branch && (
          <button
            type="button"
            className="kiseki-branch"
            aria-expanded={row.open}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(view.key);
              onToggleBranch(view.key);
            }}
          >
            <Chevron />
            <BranchLabel row={row} state={branchState} />
          </button>
        )}
        {streaming && <span className="kiseki-cursor" role="status" aria-label="running" />}
      </div>
    </div>
  );
});

function BranchLabel({ row, state }: { row: Row; state: BranchState }) {
  const { view, trace } = row;
  const ref = view.step.subagent_trajectory_ref;
  const runs = branchRuns(trace, view);
  const role = runs[0]?.[0]?.step.agent_role ?? "subagent";
  let span: number | undefined;
  const times = runs
    .flat()
    .map((s) => (s.step.timestamp ? Date.parse(s.step.timestamp) : Number.NaN))
    .filter((t) => !Number.isNaN(t));
  if (times.length) span = Math.max(...times) - Math.min(...times);
  const size = row.branchSize ?? 0;
  const label = runs.length > 1 ? `${runs.length} ${role} subagents` : `${role} subagent`;
  return (
    <>
      <span>{label}</span>
      {ref && <span className="kiseki-mono kiseki-dim">{oneLine(ref, 32)}</span>}
      {state === "loading" ? (
        <span className="kiseki-shimmer">loading</span>
      ) : state === "error" ? (
        <span className="kiseki-dim">couldn't load</span>
      ) : ref && state === "idle" && size === 0 ? (
        <span className="kiseki-dim">{row.open ? "" : "open"}</span>
      ) : (
        <span className="kiseki-num kiseki-dim">
          {size} {size === 1 ? "step" : "steps"}
          {span != null && span > 0 ? ` · ${formatDuration(span)}` : ""}
          {runs.length > 1 ? " · in parallel" : ""}
        </span>
      )}
    </>
  );
}
