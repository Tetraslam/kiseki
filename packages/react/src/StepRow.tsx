import { branchRuns, type Row, type ViewStep } from "@tetraslam/kiseki-core";
import { memo } from "react";
import { Attachments } from "./attachments";
import { CallSlot, Chevron, Message, PatchBlock, Reasoning } from "./blocks";
import { reasoningKey, systemKey, useTrace } from "./context";
import { elapsed, formatDuration, formatTokens, oneLine, shortModel } from "./format";
import { toolKind } from "./tools";

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
  if (row.head) {
    return (
      <SubagentRow
        row={row}
        selected={selected}
        state={branchState}
        onSelect={onSelect}
        onToggle={onToggleBranch}
      />
    );
  }
  const { view, trace } = row;
  const { step } = view;
  const { renderers } = context;
  const model = step.model && step.model !== context.traceModel ? shortModel(step.model) : "";
  const totalTokens = (view.tokens.input_tokens ?? 0) + (view.tokens.output_tokens ?? 0);
  const callIds = new Set(view.calls.map((c) => c.call.tool_call_id));
  // Subagents this turn launched are rows of their own, right after it, in place of their calls.
  const { replaced } = subagentCalls(row);
  const shownCalls = view.calls.filter((c) => !replaced.includes(c));
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
  const number = row.run || trace !== context.root ? undefined : context.turnNumber?.(view.key);
  const start = context.root.record.timestamp_start ?? context.root.record.steps?.[0]?.timestamp;
  const time = elapsed(step.timestamp, start ? Date.parse(start) : undefined);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the timeline handles keys for every row.
    // biome-ignore lint/a11y/noStaticElementInteractions: rows select on click; j/k select from the keyboard.
    <div
      className="kiseki-step"
      data-role={step.role}
      data-in-run={row.run ? "" : undefined}
      style={row.depth ? ({ "--kiseki-depth": row.depth } as React.CSSProperties) : undefined}
      data-selected={selected || undefined}
      data-match={match || undefined}
      data-prose={context.prose}
      onClick={() => onSelect(view.key)}
    >
      {/* The turn's number and time sit in the gutter; turns separate by spacing, not rules. */}
      {/* The gutter holds the turn number. Time, duration, tokens, and model are on hover. */}
      <div
        className="kiseki-gutter kiseki-num"
        aria-hidden="true"
        title={
          [
            time,
            view.durationMs != null ? formatDuration(view.durationMs) : "",
            totalTokens > 0 ? `${formatTokens(totalTokens)} tokens` : "",
            model,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      >
        <span
          className="kiseki-gutter-num"
          {...(timing ? { elementtiming: "kiseki-first-row" } : {})}
        >
          {number != null ? String(number).padStart(2, "0") : ""}
        </span>
      </div>
      <div
        className="kiseki-body"
        data-depth={row.depth || undefined}
        style={{ "--kiseki-depth": row.depth } as React.CSSProperties}
      >
        {(subagentPrompt || step.role === "system") && (
          <span className="kiseki-label">{label}</span>
        )}
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
            <div className="kiseki-user">
              {step.attachments?.length ? <Attachments items={step.attachments} /> : null}
              {step.content.replace(/^"(.*)"$/s, "$1")}
            </div>
          )
        ) : step.role === "user" && step.attachments?.length ? (
          <div className="kiseki-user">
            <Attachments items={step.attachments} />
          </div>
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
        {shownCalls.length > 0 && (
          <div className="kiseki-calls">
            {shownCalls.map((paired) => (
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
        {streaming && <span className="kiseki-cursor" role="status" aria-label="running" />}
      </div>
    </div>
  );
});

/**
 * One subagent, folded into the turn that launched it: what it was asked and what it came back
 * with. Opening it shows its own turns, indented, before the parent's next turn.
 */
function SubagentBlock({
  members,
  description,
  role,
  reference,
  open,
  state,
  onToggle,
}: {
  members: ViewStep[];
  description?: string;
  role?: string;
  reference?: string;
  open: boolean;
  state: BranchState;
  onToggle: () => void;
}) {
  const prompt = members.find((m) => m.step.role === "user")?.step.content;
  const task =
    description ??
    (prompt ? oneLine(prompt.replace(/^You are a subagent[^\n]*\n+/i, ""), 140) : reference) ??
    "";
  const answer = [...members].reverse().find((m) => m.step.role === "agent" && m.step.content)
    ?.step.content;
  const running = members.length > 0 && !answer;
  return (
    <button
      type="button"
      className="kiseki-subagent"
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span className="kiseki-subagent-head">
        <Chevron />
        <span className="kiseki-subagent-role">{role ?? "subagent"}</span>
        <span className="kiseki-subagent-task">{task}</span>
      </span>
      <span className="kiseki-subagent-result">
        {state === "loading" ? (
          <span className="kiseki-shimmer">loading</span>
        ) : state === "error" ? (
          "couldn't load"
        ) : running ? (
          <span className="kiseki-shimmer">working</span>
        ) : answer ? (
          oneLine(gist(answer) ?? "", 160)
        ) : (
          ""
        )}
      </span>
    </button>
  );
}

/** The first line of an answer that reads as a sentence: no headings, rules, or table rows. */
function gist(text: string): string | undefined {
  // A finding reads as a sentence: eight words or more, at most one code span, no paths.
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^(#{1,6}\s|\||[-*_]{3,}$|```)/.test(line)) continue;
    if ((line.match(/`[^`]+`/g) ?? []).length > 1 || /(^|\s)`?\/\S+\/\S+/.test(line)) continue;
    // Diagrams and arrows aren't prose.
    if (/[\u2500-\u257f\u2190-\u21ff\u25a0-\u25ff]|->|=>/.test(line)) continue;
    const plain = line.replace(/^[-*]\s+|^\d+\.\s+/, "").replace(/\*\*|`/g, "");
    if (/^[A-Za-z]/.test(plain) && plain.split(/\s+/).length >= 8) return plain;
  }
  return undefined;
}

/** The calls that launched this turn's subagents, when they match its runs one to one. */
function subagentCalls(row: Row) {
  const runs = row.branch || row.head ? branchRuns(row.trace, row.view) : [];
  const tasks = row.view.calls.filter((c) => toolKind(c.call.tool_name, c.call.input) === "task");
  return { tasks, replaced: runs.length > 0 && tasks.length === runs.length ? tasks : [] };
}

/** A subagent's own row: its block, sitting right above its turns when open. */
function SubagentRow({
  row,
  selected,
  state,
  onSelect,
  onToggle,
}: {
  row: Row;
  selected: boolean;
  state: BranchState;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
}) {
  const head = row.head as NonNullable<Row["head"]>;
  const { replaced } = subagentCalls(row);
  const task = replaced[head.index];
  const input = task?.call.input;
  return (
    <div
      className="kiseki-step kiseki-step-subagent"
      data-selected={selected || undefined}
      data-in-run={row.run ? "" : undefined}
      style={row.depth ? ({ "--kiseki-depth": row.depth } as React.CSSProperties) : undefined}
    >
      <div className="kiseki-body">
        <SubagentBlock
          members={head.members}
          description={typeof input?.description === "string" ? input.description : undefined}
          role={
            (typeof input?.subagent_type === "string" ? input.subagent_type : undefined) ??
            head.members[0]?.step.agent_role
          }
          reference={row.view.step.subagent_trajectory_ref}
          open={row.open}
          state={state}
          onToggle={() => {
            onSelect(head.run);
            onToggle(head.run);
          }}
        />
      </div>
    </div>
  );
}
