import type {
  Metrics,
  Observation,
  Patch,
  Step,
  TokenUsage,
  ToolCall,
  TraceRecord,
} from "@tetraslam/kiseki-core";

export const SCHEMA_VERSION = "0.9.0";

const SUMMARY_LENGTH = 200;
const TASK_LENGTH = 500;

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Cuts text to `max` characters, ending in an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A one-line preview of tool output for `output_summary`. */
export function summarize(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat ? truncate(flat, SUMMARY_LENGTH) : undefined;
}

/** Renders any tool output as text: strings as-is, everything else as indented JSON. */
export function stringify(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Joins the text blocks of a content array (`[{type: "text", text}]`) or returns a string as-is. */
export function textOf(content: unknown, separator = "\n"): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") parts.push(block);
    else if (isObject(block) && typeof block.text === "string") parts.push(block.text);
    else if (isObject(block) && block.type === "image") parts.push("[image]");
  }
  return parts.length ? parts.join(separator) : undefined;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (isObject(error) && typeof error.message === "string") return error.message;
  return stringify(error) ?? "error";
}

/** ISO 8601 from epoch milliseconds, a Date, or an ISO string. */
export function iso(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value) return value;
  return undefined;
}

/** Tool inputs must be objects in OpenTraces; anything else is wrapped as `{ input }`. */
export function asInput(value: unknown): Json | undefined {
  if (value == null) return undefined;
  if (isObject(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isObject(parsed)) return parsed;
    } catch {}
  }
  return { input: value };
}

export function observation(
  callId: string,
  content: string | undefined,
  error?: string,
): Observation {
  const out: Observation = { source_call_id: callId };
  if (content != null) out.content = content;
  const summary = summarize(error ?? content);
  if (summary) out.output_summary = summary;
  if (error != null) out.error = error;
  return out;
}

/** Drops undefined values and empty arrays so records stay compact. */
export function clean<T extends object>(value: T): T {
  const out: Json = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (isObject(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
  }
  return out as T;
}

export function usage(
  input?: number,
  output?: number,
  cacheRead?: number,
  cacheWrite?: number,
): TokenUsage | undefined {
  const out = clean<TokenUsage>({
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead || undefined,
    cache_write_tokens: cacheWrite || undefined,
  });
  return Object.keys(out).length ? out : undefined;
}

const EDIT_TOOL = /edit|write|patch|str_replace|create_file|notebook/i;
const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path", "file"];
const CHANGE_KEYS = [
  "old_string",
  "new_string",
  "oldString",
  "newString",
  "content",
  "edits",
  "new_source",
  "diff",
  "patch",
  "patchText",
];

/** File paths named in an `apply_patch` envelope or a unified diff. */
export function patchFiles(text: string): string[] {
  const files: string[] = [];
  for (const line of text.split("\n")) {
    const envelope = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line);
    const moved = /^\*\*\* Move to: (.+)$/.exec(line);
    const unified = /^\+\+\+ (?:b\/)?(.+?)\s*$/.exec(line);
    const path =
      envelope?.[1] ?? moved?.[1] ?? (unified?.[1] !== "/dev/null" ? unified?.[1] : undefined);
    if (path && !files.includes(path.trim())) files.push(path.trim());
  }
  if (!files.length) {
    for (const line of text.split("\n")) {
      const removed = /^--- (?:a\/)?(.+?)\s*$/.exec(line)?.[1];
      if (removed && removed !== "/dev/null" && !files.includes(removed)) files.push(removed);
    }
  }
  return files;
}

/**
 * Files a tool call edits, judged from its name and input: an edit-like name plus a path and a
 * change field (`old_string`, `content`, `edits`, ...), or a patch string naming files.
 */
export function editedFiles(toolName: string, input: Json | undefined): string[] {
  if (!input || !EDIT_TOOL.test(toolName)) return [];
  const patchText = [input.patch, input.patchText, input.diff, input.input].find(
    (value): value is string => typeof value === "string" && value.includes("\n"),
  );
  if (patchText) {
    const files = patchFiles(patchText);
    if (files.length) return files;
  }
  const path = PATH_KEYS.map((key) => input[key]).find((value) => typeof value === "string");
  if (typeof path === "string" && CHANGE_KEYS.some((key) => key in input)) return [path];
  return [];
}

/** Splits a multi-file unified diff into one diff per file, keyed by the `+++` (or `---`) path. */
export function splitDiff(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  const sections = diff.split(/^(?=Index: |diff --git )/m);
  for (const section of sections) {
    const [file] = patchFiles(section);
    if (file) out[file] = out[file] ? `${out[file]}\n${section}` : section;
  }
  return out;
}

function diffFor(file: string, diffs: Record<string, string>): string | undefined {
  if (diffs[file]) return diffs[file];
  for (const [path, diff] of Object.entries(diffs)) {
    if (path.endsWith(`/${file}`) || file.endsWith(`/${path}`)) return diff;
  }
  return undefined;
}

/**
 * One patch per edited file of a call. `diff` (a kiseki extension to OpenTraces `Patch`) holds a
 * unified diff when the source recorded one; pass one diff string or several keyed by path.
 */
export function patchesFor(
  step: Step,
  call: ToolCall,
  diffs?: Record<string, string> | string,
): Patch[] {
  const byFile = typeof diffs === "string" ? splitDiff(diffs) : (diffs ?? {});
  const files = editedFiles(call.tool_name, call.input);
  if (!files.length) files.push(...Object.keys(byFile));
  return files.map((file, i) => {
    const single = typeof diffs === "string" && files.length === 1 ? diffs : undefined;
    return clean<Patch>({
      patch_id: files.length > 1 ? `${call.tool_call_id}:${i}` : call.tool_call_id,
      file_path: file,
      step_index: step.step_index,
      tool_call_id: call.tool_call_id,
      diff: diffFor(file, byFile) ?? single,
    });
  });
}

/** A step under construction, before indices are assigned. */
export interface Draft {
  step: Step;
  /** Subagents this step launched, in call order: an agent or session id and its role. */
  agents: { id: string; role?: string }[];
  patches: Patch[];
}

export function draft(step: Partial<Step> & Pick<Step, "role">): Draft {
  return { step: { ...step, step_index: 0 }, agents: [], patches: [] };
}

/**
 * Indexes drafts into steps. A subagent whose drafts `resolve` returns is inlined after its parent
 * step as `call_type: "subagent"` steps; one it can't resolve becomes `subagent_trajectory_ref` on
 * the parent, or on a stub child step when the parent launched several.
 */
export function assemble(
  root: Draft[],
  resolve: (id: string) => Draft[] | undefined,
): { steps: Step[]; patches: Patch[] } {
  const steps: Step[] = [];
  const patches: Patch[] = [];
  const emit = (
    drafts: Draft[],
    parent: number | undefined,
    role: string | undefined,
    depth: number,
  ) => {
    for (const { step: source, agents, patches: own } of drafts) {
      const index = steps.length;
      const step: Step = { ...source, step_index: index };
      if (parent != null) {
        step.parent_step = parent;
        step.call_type = "subagent";
        if (role) step.agent_role = role;
      }
      steps.push(step);
      for (const patch of own) patches.push({ ...patch, step_index: index });
      const unresolved: string[] = [];
      for (const agent of agents) {
        const children = depth < 16 ? resolve(agent.id) : undefined;
        if (children) emit(children, index, agent.role, depth + 1);
        else unresolved.push(agent.id);
      }
      if (unresolved.length === 1) step.subagent_trajectory_ref = unresolved[0];
      else {
        for (const id of unresolved) {
          steps.push(
            clean<Step>({
              step_index: steps.length,
              role: "agent",
              call_type: "subagent",
              parent_step: index,
              subagent_trajectory_ref: id,
              timestamp: step.timestamp,
            }),
          );
        }
      }
    }
  };
  emit(root, undefined, undefined, 0);
  return { steps, patches };
}

export interface RecordParts {
  sessionId: string;
  traceId?: string;
  agent: TraceRecord["agent"];
  steps: Step[];
  patches?: Patch[];
  start?: string;
  end?: string;
  task?: string;
  cost?: number;
  outcome?: TraceRecord["outcome"];
  environment?: Json;
  metadata?: Json;
}

/** Assembles a record: task from the first user step, metrics summed from step usage. */
export function buildRecord(parts: RecordParts): TraceRecord {
  const { steps } = parts;
  const first = steps.find((step) => step.role === "user" && step.content)?.content;
  const description = parts.task ?? first;
  const times = steps.flatMap((step) => (step.timestamp ? [step.timestamp] : [])).sort();
  const start = parts.start ?? times[0];
  const end = parts.end ?? times.at(-1);
  return clean<TraceRecord>({
    schema_version: SCHEMA_VERSION,
    trace_id: parts.traceId ?? parts.sessionId,
    session_id: parts.sessionId,
    timestamp_start: start,
    timestamp_end: end,
    task: description ? { description: truncate(description.trim(), TASK_LENGTH) } : undefined,
    agent: clean(parts.agent),
    environment: parts.environment && clean(parts.environment),
    steps,
    patches: parts.patches,
    outcome: parts.outcome,
    metrics: metricsOf(steps, start, end, parts.cost),
    metadata: parts.metadata && clean(parts.metadata),
  });
}

function metricsOf(steps: Step[], start?: string, end?: string, cost?: number): Metrics {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let counted = false;
  for (const step of steps) {
    const tokens = step.token_usage;
    if (!tokens) continue;
    counted = true;
    input += tokens.input_tokens ?? 0;
    output += tokens.output_tokens ?? 0;
    cacheRead += tokens.cache_read_tokens ?? 0;
    cacheWrite += tokens.cache_write_tokens ?? 0;
  }
  const from = start ? Date.parse(start) : Number.NaN;
  const to = end ? Date.parse(end) : Number.NaN;
  return clean<Metrics>({
    total_steps: steps.length,
    total_input_tokens: counted ? input : undefined,
    total_output_tokens: counted ? output : undefined,
    total_cache_read_tokens: counted && cacheRead ? cacheRead : undefined,
    total_cache_creation_tokens: counted && cacheWrite ? cacheWrite : undefined,
    cache_hit_rate: counted && input ? Math.min(1, cacheRead / input) : undefined,
    total_duration_s: to >= from ? (to - from) / 1000 : undefined,
    estimated_cost_usd: cost || undefined,
  });
}

/** `provider/model`, or the model alone when the provider is unknown or already in the id. */
export function modelName(provider: unknown, model: unknown): string | undefined {
  if (typeof model !== "string" || !model) return undefined;
  if (typeof provider !== "string" || !provider || model.startsWith(`${provider}/`)) return model;
  return `${provider}/${model}`;
}

/** Splits JSONL into parsed values, skipping blank and malformed lines. */
export function parseLines(text: string): Json[] {
  const out: Json[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isObject(value)) out.push(value);
    } catch {}
  }
  return out;
}
