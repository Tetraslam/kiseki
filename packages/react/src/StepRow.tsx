import type { Row } from "@tetraslam/kiseki-core";
import { memo } from "react";
import { CallSlot, Chevron, Message, PatchBlock, Reasoning } from "./blocks";
import { reasoningKey, systemKey, useTrace } from "./context";
import { formatDuration, formatTokens, oneLine, shortModel } from "./format";

export type BranchState = "idle" | "loading" | "loaded" | "error";

export interface StepRowProps {
  row: Row;
  selected: boolean;
  match: boolean;
  branchState: BranchState;
  onSelect: (key: string) => void;
  onToggleBranch: (key: string) => void;
}

/** One step: its role, message, reasoning, tool calls, patches, and branch toggle. */
export const StepRow = memo(function StepRow({
  row,
  selected,
  match,
  branchState,
  onSelect,
  onToggleBranch,
}: StepRowProps) {
  const context = useTrace();
  const { view, trace } = row;
  const { step } = view;
  const { renderers } = context;
  const model = step.model && step.model !== context.traceModel ? shortModel(step.model) : "";
  const tokens =
    (view.tokens.input_tokens ?? 0) + (view.tokens.output_tokens ?? 0) > 0
      ? `${formatTokens(view.tokens.input_tokens)} → ${formatTokens(view.tokens.output_tokens)}`
      : "";
  const showRole = step.agent_role && step.agent_role !== "main" ? step.agent_role : "";
  const callIds = new Set(view.calls.map((c) => c.call.tool_call_id));
  const loosePatches = view.patches.filter((p) => !p.tool_call_id || !callIds.has(p.tool_call_id));
  const streaming = trace.live && trace.steps.at(-1) === view;
  const UserRenderer = renderers.user;
  const SystemRenderer = renderers.system;
  const MessageRenderer = renderers.message ?? Message;
  const ReasoningRenderer = renderers.reasoning ?? Reasoning;
  const systemOpen = context.isExpanded(systemKey(view.key));
  // Not in OpenTraces: adapters record a failed LLM call (an abort, a provider error) here.
  const stepError =
    typeof step.error === "string"
      ? step.error
      : step.error && typeof step.error === "object" && "message" in step.error
        ? String((step.error as { message: unknown }).message)
        : undefined;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the timeline handles keys for every row.
    // biome-ignore lint/a11y/noStaticElementInteractions: rows select on click; j/k select from the keyboard.
    <div
      className="kiseki-step"
      data-role={step.role}
      data-selected={selected || undefined}
      data-match={match || undefined}
      onClick={() => onSelect(view.key)}
    >
      <div className="kiseki-gutter kiseki-num">{view.index}</div>
      <div
        className="kiseki-body"
        data-depth={row.depth || undefined}
        style={{ "--kiseki-depth": row.depth } as React.CSSProperties}
      >
        <div className="kiseki-step-head">
          <span className="kiseki-role">{step.role}</span>
          {showRole && <span className="kiseki-agent-role">{showRole}</span>}
          <span className="kiseki-step-meta kiseki-num">
            {model && <span>{model}</span>}
            {tokens && <span>{tokens}</span>}
            {view.durationMs != null && <span>{formatDuration(view.durationMs)}</span>}
          </span>
        </div>
        {step.role === "system" && step.content ? (
          SystemRenderer ? (
            <SystemRenderer view={view} row={row} trace={trace} />
          ) : (
            <div>
              <div
                className={`kiseki-message${systemOpen ? "" : " kiseki-clamp"}`}
                data-role="system"
              >
                {step.content}
              </div>
              {step.content.length > 280 && (
                <button
                  type="button"
                  className="kiseki-toggle"
                  aria-expanded={systemOpen}
                  onClick={() => context.toggle(systemKey(view.key))}
                >
                  <Chevron />
                  {systemOpen ? "show less" : "show all"}
                </button>
              )}
            </div>
          )
        ) : null}
        {step.role === "user" && step.content ? (
          UserRenderer ? (
            <UserRenderer view={view} row={row} trace={trace} />
          ) : (
            <div className="kiseki-message" data-role="user">
              {step.content}
            </div>
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
        {stepError && <div className="kiseki-error kiseki-mono">{stepError}</div>}
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
      </div>
    </div>
  );
});

function BranchLabel({ row, state }: { row: Row; state: BranchState }) {
  const { view, trace } = row;
  const ref = view.step.subagent_trajectory_ref;
  const first = view.children.length ? trace.byIndex.get(view.children[0] as number) : undefined;
  const role = first?.step.agent_role ?? "subagent";
  const last = view.children.length
    ? trace.byIndex.get(view.children[view.children.length - 1] as number)
    : undefined;
  const span =
    first?.step.timestamp && last?.step.timestamp
      ? Date.parse(last.step.timestamp) - Date.parse(first.step.timestamp) + (last.durationMs ?? 0)
      : undefined;
  const size = row.branchSize ?? 0;
  return (
    <>
      <span>{role}</span>
      {ref && <span className="kiseki-mono kiseki-dim">{oneLine(ref, 40)}</span>}
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
        </span>
      )}
    </>
  );
}
