import type { Patch, Step, ToolCall, TraceRecord } from "@tetraslam/kiseki-core";
import {
  asInput,
  buildRecord,
  clean,
  errorText,
  isObject,
  iso,
  type Json,
  modelName,
  num,
  observation,
  parseLines,
  patchesFor,
  str,
  textOf,
  usage,
} from "./shared";

/**
 * Converts a Pi session (`~/.pi/agent/sessions/--<path>--/<time>_<id>.jsonl`) into a trace. Pi
 * stores a tree of entries; the trace follows the active branch, from the last entry back to the
 * root. Tool results join the step that made the call; `edit` and `write` calls become patches,
 * with the unified diff Pi records in `details.patch` or `details.diff`.
 */
export function fromPi(input: string | Json[]): TraceRecord {
  const entries = typeof input === "string" ? parseLines(input) : input;
  const header = entries.find((entry) => entry.type === "session") ?? {};
  const steps: Step[] = [];
  const patches: Patch[] = [];
  const owners = new Map<string, { step: Step; call: ToolCall; at?: string }>();
  let model: string | undefined;
  let cost = 0;

  const push = (step: Partial<Step> & Pick<Step, "role">) => {
    const full = clean<Step>({ ...step, step_index: steps.length });
    steps.push(full);
    return full;
  };

  for (const entry of activeBranch(entries)) {
    const timestamp = str(entry.timestamp);
    if (entry.type === "model_change") model = modelName(entry.provider, entry.modelId) ?? model;
    else if (entry.type === "compaction" || entry.type === "branch_summary") {
      const summary = str(entry.summary);
      if (summary) push({ role: "system", content: summary, timestamp });
    } else if (entry.type === "custom_message") {
      const content = textOf(entry.content);
      if (content) push({ role: "system", content, timestamp });
    }
    if (entry.type !== "message" || !isObject(entry.message)) continue;
    const message = entry.message;
    const at = timestamp ?? iso(message.timestamp);
    switch (message.role) {
      case "system": {
        const sections = isObject(message.sections)
          ? Object.values(message.sections).filter((v) => typeof v === "string")
          : [];
        const content = textOf(message.content) || sections.join("\n\n");
        if (content) push({ role: "system", content, timestamp: at });
        break;
      }
      case "user":
      case "custom": {
        const content = textOf(message.content, "\n\n");
        if (content)
          push({ role: message.role === "user" ? "user" : "system", content, timestamp: at });
        break;
      }
      case "bashExecution": {
        const content = [`$ ${str(message.command) ?? ""}`, str(message.output)]
          .filter(Boolean)
          .join("\n");
        push({ role: "user", content, timestamp: at });
        break;
      }
      case "assistant": {
        const text: string[] = [];
        const thinking: string[] = [];
        const calls: ToolCall[] = [];
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (!isObject(block)) continue;
          if (block.type === "text" && str(block.text)) text.push(block.text as string);
          else if (block.type === "thinking" && str(block.thinking))
            thinking.push(block.thinking as string);
          else if (block.type === "toolCall") {
            calls.push(
              clean<ToolCall>({
                tool_call_id: str(block.id) ?? "",
                tool_name: str(block.name) ?? "tool",
                input: asInput(block.arguments),
              }),
            );
          }
        }
        const u = isObject(message.usage) ? message.usage : {};
        const cacheRead = num(u.cacheRead) ?? 0;
        const cacheWrite = num(u.cacheWrite) ?? 0;
        const inputTokens = num(u.input);
        cost += isObject(u.cost) ? (num(u.cost.total) ?? 0) : 0;
        const step = push({
          role: "agent",
          call_type: "main",
          content: text.join("\n\n") || undefined,
          reasoning_content: thinking.join("\n\n") || undefined,
          model: modelName(message.provider, message.model) ?? model,
          tool_calls: calls,
          token_usage: usage(
            inputTokens != null ? inputTokens + cacheRead + cacheWrite : undefined,
            num(u.output),
            cacheRead,
            cacheWrite,
          ),
          timestamp: at,
          error:
            message.stopReason === "error" || message.stopReason === "aborted"
              ? (str(message.errorMessage) ?? str(message.stopReason))
              : undefined,
        });
        for (const call of step.tool_calls ?? []) owners.set(call.tool_call_id, { step, call, at });
        break;
      }
      case "toolResult": {
        const id = str(message.toolCallId) ?? "";
        const owner = owners.get(id);
        if (!owner) break;
        const content = textOf(message.content);
        const failed = message.isError === true;
        owner.step.observations = [
          ...(owner.step.observations ?? []),
          observation(id, content, failed ? errorText(content ?? "error") : undefined),
        ];
        if (owner.at && at) {
          const ms = Date.parse(at) - Date.parse(owner.at);
          if (ms >= 0) owner.call.duration_ms = ms;
        }
        const details = isObject(message.details) ? message.details : {};
        if (!failed)
          patches.push(
            ...patchesFor(owner.step, owner.call, str(details.patch) ?? str(details.diff)),
          );
        break;
      }
    }
  }

  return buildRecord({
    sessionId: str(header.id) ?? "pi",
    agent: { name: "pi", model: steps.find((step) => step.model)?.model ?? model },
    steps,
    patches: patches.length ? patches : undefined,
    start: str(header.timestamp),
    cost,
    metadata: { cwd: str(header.cwd), parent_session: str(header.parentSession) },
  });
}

/** Entries on the path from the last entry back to the root, in order. Linear v1 files pass through. */
function activeBranch(entries: Json[]): Json[] {
  const tree = entries.filter((entry) => entry.type !== "session" && str(entry.id));
  if (!tree.length || !tree.some((entry) => "parentId" in entry)) return entries;
  const byId = new Map(tree.map((entry) => [entry.id as string, entry]));
  const path: Json[] = [];
  const seen = new Set<string>();
  let current: Json | undefined = tree.at(-1);
  while (current && !seen.has(current.id as string)) {
    seen.add(current.id as string);
    path.push(current);
    const parent = str(current.parentId);
    current = parent ? byId.get(parent) : undefined;
  }
  return path.reverse();
}
