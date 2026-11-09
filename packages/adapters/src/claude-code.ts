import type { ToolCall, TraceRecord } from "@tetraslam/kiseki-core";
import {
  asInput,
  assemble,
  buildRecord,
  clean,
  type Draft,
  isObject,
  type Json,
  draft as newDraft,
  num,
  observation,
  parseLines,
  patchesFor,
  str,
  textOf,
  usage,
} from "./shared";

export interface ClaudeCodeOptions {
  /**
   * Subagent transcripts (`<session>/subagents/agent-<id>.jsonl`), keyed by agent id. Given ones
   * are inlined as `call_type: "subagent"` steps under the step that launched them; missing ones
   * become `subagent_trajectory_ref: "<agent id>"`.
   */
  subagents?: Record<string, string | Json[]>;
}

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/**
 * Converts a Claude Code session transcript (`~/.claude/projects/<project>/<session>.jsonl`) into a
 * trace. Streamed assistant lines that share a message id merge into one step; tool results join
 * the step that made the call. Edit, Write, and MultiEdit calls become patches, with a unified
 * `diff` when the transcript recorded one.
 */
export function fromClaudeCode(
  input: string | Json[],
  options: ClaudeCodeOptions = {},
): TraceRecord {
  const entries = typeof input === "string" ? parseLines(input) : input;
  // A subagent transcript on its own is all sidechain; convert it whole, keyed by its agent id.
  const own = entries.filter(
    (entry) => !entry.isSidechain && (entry.type === "user" || entry.type === "assistant"),
  );
  const standalone = own.length ? undefined : str(entries.find((entry) => entry.agentId)?.agentId);
  const main = standalone ? entries : entries.filter((entry) => !entry.isSidechain);

  // Sidechains stored inline (older versions) or passed separately, keyed by agent id.
  const transcripts = new Map<string, Json[]>();
  for (const entry of entries) {
    const agentId = str(entry.agentId);
    if (!entry.isSidechain || !agentId) continue;
    const list = transcripts.get(agentId) ?? [];
    list.push(entry);
    transcripts.set(agentId, list);
  }
  for (const [id, transcript] of Object.entries(options.subagents ?? {})) {
    transcripts.set(id, typeof transcript === "string" ? parseLines(transcript) : transcript);
  }

  const { steps, patches } = assemble(convert(main), (id) => {
    const transcript = transcripts.get(id);
    return transcript && convert(transcript);
  });

  let cost: number | undefined;
  let title: string | undefined;
  for (const entry of entries) {
    if (entry.type === "cost-state") cost = num(entry.totalCostUSD) ?? cost;
    if (entry.type === "ai-title") title ??= str(entry.aiTitle);
    if (entry.type === "custom-title") title = str(entry.customTitle) ?? title;
  }
  const head = main.find((entry) => entry.type === "user" || entry.type === "assistant") ?? {};
  const model = steps.find((step) => step.role === "agent" && step.model)?.model;
  return buildRecord({
    sessionId: standalone ?? str(head.sessionId) ?? str(entries[0]?.sessionId) ?? "claude-code",
    agent: { name: "claude-code", version: str(head.version), model },
    steps,
    patches: patches.length ? patches : undefined,
    cost,
    metadata: {
      title,
      cwd: str(head.cwd),
      git_branch: str(head.gitBranch),
      parent_session_id: standalone && str(head.sessionId),
    },
  });
}

function convert(entries: Json[]): Draft[] {
  const drafts: Draft[] = [];
  const byMessage = new Map<string, Draft>();
  const callOwner = new Map<string, { draft: Draft; call: ToolCall; at?: string }>();

  for (const entry of entries) {
    const message = isObject(entry.message) ? entry.message : undefined;
    if (!message) continue;
    const timestamp = str(entry.timestamp);

    if (entry.type === "assistant") {
      const key = str(message.id) ?? str(entry.uuid) ?? String(drafts.length);
      let draft = byMessage.get(key);
      if (!draft) {
        draft = newDraft({ role: "agent", call_type: "main" });
        if (timestamp) draft.step.timestamp = timestamp;
        const model = str(message.model);
        if (model && model !== "<synthetic>") draft.step.model = model;
        byMessage.set(key, draft);
        drafts.push(draft);
      }
      const step = draft.step;
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (!isObject(block)) continue;
        if (block.type === "text" && str(block.text)) {
          step.content = step.content ? `${step.content}\n\n${block.text}` : (block.text as string);
        } else if (block.type === "thinking" && str(block.thinking)) {
          const thinking = block.thinking as string;
          step.reasoning_content = step.reasoning_content
            ? `${step.reasoning_content}\n\n${thinking}`
            : thinking;
        } else if (block.type === "tool_use") {
          const call = clean<ToolCall>({
            tool_call_id: str(block.id) ?? "",
            tool_name: str(block.name) ?? "tool",
            input: asInput(block.input),
          });
          step.tool_calls = [...(step.tool_calls ?? []), call];
          callOwner.set(call.tool_call_id, { draft, call, at: timestamp });
        }
      }
      if (typeof message.content === "string" && message.content) step.content = message.content;
      if (isObject(message.usage)) {
        const u = message.usage;
        const cacheRead = num(u.cache_read_input_tokens) ?? 0;
        const cacheWrite = num(u.cache_creation_input_tokens) ?? 0;
        const input = num(u.input_tokens);
        step.token_usage = usage(
          input != null ? input + cacheRead + cacheWrite : undefined,
          num(u.output_tokens),
          cacheRead,
          cacheWrite,
        );
      }
      continue;
    }

    if (entry.type !== "user" || entry.isMeta) continue;
    const blocks = Array.isArray(message.content) ? message.content : [message.content];
    const results = blocks.filter(
      (block) => isObject(block) && block.type === "tool_result",
    ) as Json[];
    const text = textOf(
      blocks.filter((block) => !isObject(block) || block.type !== "tool_result"),
      "\n\n",
    );
    if (text) {
      drafts.push(newDraft(clean({ role: "user" as const, content: text, timestamp })));
    }
    for (const result of results) {
      const id = str(result.tool_use_id) ?? "";
      const owner = callOwner.get(id);
      if (!owner) continue;
      const content = textOf(result.content) ?? "";
      const step = owner.draft.step;
      step.observations = [
        ...(step.observations ?? []),
        result.is_error === true ? observation(id, content, content) : observation(id, content),
      ];
      if (owner.at && timestamp) {
        const ms = Date.parse(timestamp) - Date.parse(owner.at);
        if (ms >= 0) owner.call.duration_ms = ms;
      }
      // `toolUseResult` describes the entry's result; only trust it when there is one result.
      const extra =
        results.length === 1 && isObject(entry.toolUseResult) ? entry.toolUseResult : undefined;
      const agentId = str(extra?.agentId);
      if (agentId && SUBAGENT_TOOLS.has(owner.call.tool_name)) {
        owner.draft.agents.push({ id: agentId, role: str(owner.call.input?.subagent_type) });
      }
      if (result.is_error !== true) {
        owner.draft.patches.push(...patchesFor(step, owner.call, diffOf(extra)));
      }
    }
  }
  return drafts;
}

/** A unified diff from a `toolUseResult` with `structuredPatch` hunks. */
function diffOf(result: Json | undefined): string | undefined {
  const hunks = Array.isArray(result?.structuredPatch) ? result.structuredPatch : [];
  const file = str(result?.filePath);
  if (!file || !hunks.length) return undefined;
  const lines = [`--- a/${file}`, `+++ b/${file}`];
  for (const hunk of hunks) {
    if (!isObject(hunk) || !Array.isArray(hunk.lines)) continue;
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) if (typeof line === "string") lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}
