import type { Attachment, Outcome, ToolCall, TraceRecord } from "@tetraslam/kiseki-core";
import {
  asInput,
  assemble,
  attachment,
  buildRecord,
  clean,
  type Draft,
  draft,
  errorText,
  isObject,
  iso,
  type Json,
  modelName,
  num,
  observation,
  patchesFor,
  str,
  stringify,
  textOf,
  usage,
} from "./shared";

/**
 * An OpenCode session as `opencode session export <id>` prints it: `{ info, messages }`. Messages
 * may be v2 export messages, raw `session_message` rows (`{ id, type, data }` with `data` as a JSON
 * string), or v1 `{ info, parts }` pairs from OpenCode 1.x exports.
 */
export interface OpenCodeSession {
  info: Json;
  messages: Json[];
}

export interface OpenCodeOptions {
  /**
   * Child sessions, keyed by session id. A child launched by a `task` or `subagent` call is inlined
   * under that call's step; a missing one becomes `subagent_trajectory_ref: "<session id>"`.
   */
  children?: Record<string, OpenCodeSession>;
}

const SUBAGENT_TOOLS = new Set(["task", "subagent"]);

/**
 * Converts an OpenCode session into a trace. Each assistant message (v2), or each
 * step-start/step-finish span of one (v1), is one step; tool parts carry their call and result.
 */
export function fromOpenCode(
  input: OpenCodeSession | string,
  options: OpenCodeOptions = {},
): TraceRecord {
  const session = typeof input === "string" ? (JSON.parse(input) as OpenCodeSession) : input;
  const info = session.info ?? {};
  const { steps, patches } = assemble(convert(session), (id) => {
    const child = options.children?.[id];
    return child && convert(child);
  });
  const time = isObject(info.time) ? info.time : {};
  const location = isObject(info.location) ? info.location : {};
  const model = isObject(info.model) ? modelName(info.model.providerID, info.model.id) : undefined;
  return buildRecord({
    sessionId: str(info.id) ?? "opencode",
    agent: {
      name: "opencode",
      version: str(info.version),
      model: model ?? steps.find((step) => step.model)?.model,
    },
    steps,
    patches: patches.length ? patches : undefined,
    start: iso(time.created ?? info.time_created),
    end: iso(time.idle ?? time.updated ?? info.time_updated),
    cost: num(info.cost),
    outcome: outcomeOf(str(info.outcome) ?? str(info.idle_outcome) ?? lastIdle(session.messages)),
    metadata: {
      title: str(info.title),
      agent: str(info.agent),
      directory: str(location.directory) ?? str(info.directory),
      parent_session_id: str(info.parentID) ?? str(info.parent_id),
    },
  });
}

function convert(session: OpenCodeSession): Draft[] {
  const drafts: Draft[] = [];
  for (const raw of session.messages ?? []) {
    if (isObject(raw.info) && Array.isArray(raw.parts)) convertV1(raw.info, raw.parts, drafts);
    else convertV2(rowOf(raw), drafts);
  }
  return drafts;
}

/** A raw `session_message` row keeps the payload in a JSON `data` column. */
function rowOf(raw: Json): Json {
  if (typeof raw.data !== "string") return raw;
  try {
    const data: unknown = JSON.parse(raw.data);
    return isObject(data) ? { ...data, id: raw.id, type: raw.type } : raw;
  } catch {
    return raw;
  }
}

function convertV2(message: Json, drafts: Draft[]) {
  const time = isObject(message.time) ? message.time : {};
  const timestamp = iso(time.created ?? message.time_created);
  switch (message.type) {
    case "user": {
      const files = Array.isArray(message.files) ? message.files.filter(isObject) : [];
      const attachments = files
        .map((file) => {
          const data = str(file.data);
          const mime = str(file.mime);
          const url =
            str(file.url) ??
            (data ? `data:${mime ?? "application/octet-stream"};base64,${data}` : undefined);
          return attachment(url, mime, str(file.name) ?? str(file.filename));
        })
        .filter((a) => a != null);
      const content = str(message.text);
      if (content || attachments.length)
        drafts.push(
          draft(
            clean({
              role: "user" as const,
              content,
              timestamp,
              attachments: attachments.length ? attachments : undefined,
            }),
          ),
        );
      return;
    }
    case "system":
    case "synthetic":
      if (str(message.text))
        drafts.push(
          draft(clean({ role: "system" as const, content: str(message.text), timestamp })),
        );
      return;
    case "compaction": {
      const summary = str(message.summary);
      if (summary)
        drafts.push(draft(clean({ role: "system" as const, content: summary, timestamp })));
      return;
    }
    case "assistant":
      break;
    default:
      return;
  }

  const model = isObject(message.model)
    ? modelName(message.model.providerID, message.model.id)
    : undefined;
  const current = draft(
    clean({ role: "agent" as const, call_type: "main" as const, model, timestamp }),
  );
  const step = current.step;
  const text: string[] = [];
  const reasoning: string[] = [];
  for (const part of Array.isArray(message.content) ? message.content : []) {
    if (!isObject(part)) continue;
    if (part.type === "text" && str(part.text)) text.push(part.text as string);
    else if (part.type === "reasoning" && str(part.text)) reasoning.push(part.text as string);
    else if (part.type === "tool") {
      const state = isObject(part.state) ? part.state : {};
      const partTime = isObject(part.time) ? part.time : {};
      const start = num(partTime.ran) ?? num(partTime.created);
      const end = num(partTime.completed);
      addTool(current, {
        id: str(part.id) ?? "",
        name: str(part.name) ?? "tool",
        state,
        output: textOf(state.content),
        attachments: filesOf(state.content),
        duration: start != null && end != null && end >= start ? end - start : undefined,
      });
    }
  }
  if (text.length) step.content = text.join("\n\n");
  if (reasoning.length) step.reasoning_content = reasoning.join("\n\n");
  const tokens = tokensOf(message.tokens);
  if (tokens) step.token_usage = tokens;
  if (isObject(message.error)) step.error = errorText(message.error);
  if (step.content || step.reasoning_content || step.tool_calls || step.error) drafts.push(current);
}

function convertV1(info: Json, parts: unknown[], drafts: Draft[]) {
  const time = isObject(info.time) ? info.time : {};
  const timestamp = iso(time.created);
  if (info.role === "user") {
    const texts = parts.filter((part) => isObject(part) && part.type === "text" && !part.synthetic);
    const content = textOf(texts, "\n\n");
    const attachments = filesOf(parts);
    if (content || attachments)
      drafts.push(draft(clean({ role: "user" as const, content, timestamp, attachments })));
    return;
  }
  if (info.role !== "assistant") return;
  const model = modelName(info.providerID, info.modelID);
  const first = drafts.length;
  let current: Draft | undefined;
  const open = (at?: string) => {
    current = draft(
      clean({
        role: "agent" as const,
        call_type: "main" as const,
        model,
        timestamp: at ?? timestamp,
      }),
    );
    drafts.push(current);
    return current;
  };
  for (const part of parts) {
    if (!isObject(part)) continue;
    const partTime = isObject(part.time) ? part.time : {};
    if (part.type === "step-start") {
      open(current ? iso(partTime.start) : timestamp);
      continue;
    }
    const target = current ?? open();
    const step = target.step;
    if (part.type === "text" && str(part.text) && !part.synthetic) {
      step.content = step.content ? `${step.content}\n\n${part.text}` : (part.text as string);
    } else if (part.type === "reasoning" && str(part.text)) {
      const text = part.text as string;
      step.reasoning_content = step.reasoning_content
        ? `${step.reasoning_content}\n\n${text}`
        : text;
    } else if (part.type === "tool") {
      const state = isObject(part.state) ? part.state : {};
      const stateTime = isObject(state.time) ? state.time : {};
      const start = num(stateTime.start);
      const end = num(stateTime.end);
      addTool(target, {
        id: str(part.callID) ?? str(part.id) ?? "",
        name: str(part.tool) ?? "tool",
        state,
        output: stringify(state.output),
        duration: start != null && end != null && end >= start ? end - start : undefined,
      });
    } else if (part.type === "step-finish") {
      const tokens = tokensOf(part.tokens);
      if (tokens) step.token_usage = tokens;
    }
  }
  if (isObject(info.error) && current)
    current.step.error = errorText(info.error.data ?? info.error);
  // Drop empty spans, e.g. a step-start with nothing after it.
  const kept = drafts
    .splice(first)
    .filter(({ step }) => step.content || step.reasoning_content || step.tool_calls || step.error);
  drafts.push(...kept);
}

interface ToolPart {
  id: string;
  name: string;
  state: Json;
  output: string | undefined;
  attachments?: Attachment[];
  duration?: number;
}

/** Image and file parts in a tool's result content, such as an image the read tool returned. */
function filesOf(content: unknown): Attachment[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const out = content
    .filter((part) => isObject(part) && part.type === "file")
    .map((part) =>
      attachment(
        str(part.uri) ?? str(part.url),
        str(part.mime),
        str(part.name) ?? str(part.filename),
      ),
    )
    .filter((a) => a != null);
  return out.length ? out : undefined;
}

function addTool(target: Draft, { id, name, state, output, attachments, duration }: ToolPart) {
  const step = target.step;
  const call = clean<ToolCall>({
    tool_call_id: id,
    tool_name: name,
    input: asInput(state.input),
    duration_ms: duration,
  });
  step.tool_calls = [...(step.tool_calls ?? []), call];
  if (state.status === "completed")
    step.observations = [
      ...(step.observations ?? []),
      attachments ? { ...observation(id, output), attachments } : observation(id, output),
    ];
  else if (state.status === "error") {
    step.observations = [
      ...(step.observations ?? []),
      observation(id, output, errorText(state.error)),
    ];
  }
  const metadata = isObject(state.metadata) ? state.metadata : {};
  const child = str(metadata.sessionId) ?? str(metadata.sessionID);
  if (child && SUBAGENT_TOOLS.has(name)) {
    const input = call.input ?? {};
    target.agents.push({ id: child, role: str(input.subagent_type) ?? str(input.agent) });
  }
  if (state.status === "completed")
    target.patches.push(...patchesFor(step, call, diffsOf(metadata)));
}

/** Unified diffs OpenCode keeps in tool metadata: `diff`, `filediff.patch`, or `files[].patch`. */
function diffsOf(metadata: Json): Record<string, string> | string | undefined {
  if (Array.isArray(metadata.files)) {
    const out: Record<string, string> = {};
    for (const file of metadata.files) {
      const path = isObject(file) ? (str(file.filePath) ?? str(file.file)) : undefined;
      const patch = isObject(file) ? (str(file.patch) ?? str(file.diff)) : undefined;
      if (path && patch) out[path] = patch;
    }
    if (Object.keys(out).length) return out;
  }
  if (isObject(metadata.filediff) && str(metadata.filediff.patch))
    return metadata.filediff.patch as string;
  return str(metadata.diff);
}

function tokensOf(raw: unknown) {
  if (!isObject(raw)) return undefined;
  const cache = isObject(raw.cache) ? raw.cache : {};
  const read = num(cache.read) ?? 0;
  const write = num(cache.write) ?? 0;
  const input = num(raw.input);
  const output = num(raw.output);
  if (!input && !output && !read && !write) return undefined;
  // OpenCode counts cached prompt tokens separately; OpenTraces input includes them.
  return usage(input != null ? input + read + write : undefined, output, read, write);
}

function lastIdle(messages: Json[] | undefined): string | undefined {
  const idle = (messages ?? []).map(rowOf).findLast((message) => message.type === "idle");
  return idle ? str(idle.outcome) : undefined;
}

function outcomeOf(status: string | undefined): Outcome | undefined {
  if (!status) return undefined;
  const terminal: Record<string, string> = { failed: "error", interrupted: "interrupted" };
  return clean<Outcome>({
    description: `OpenCode run ${status}`,
    signal_source: "opencode",
    terminal_state: terminal[status],
    success: status === "failed" ? false : undefined,
  });
}
