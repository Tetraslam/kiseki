import { parseTraces, type TraceRecord, type ValidationIssue } from "@tetraslam/kiseki-core";
import { fromSteps } from "./ai-sdk";
import { fromClaudeCode } from "./claude-code";
import { fromCodex } from "./codex";
import { fromOpenCode, type OpenCodeSession } from "./opencode";
import { fromPi } from "./pi";
import { isObject, type Json } from "./shared";

export {
  type AiSdkOptions,
  type AiSdkPrompt,
  type AiSdkStep,
  createTraceRecorder,
  fromSteps,
  type TraceRecorder,
} from "./ai-sdk";
export { type ClaudeCodeOptions, fromClaudeCode } from "./claude-code";
export { fromCodex } from "./codex";
export { fromOpenCode, type OpenCodeOptions, type OpenCodeSession } from "./opencode";
export { fromPi } from "./pi";

export type Format = "opentraces" | "ai-sdk" | "claude-code" | "opencode" | "codex" | "pi";

export interface Detected {
  format: Format;
  records: TraceRecord[];
  /** Validation issues, for OpenTraces input. */
  issues: ValidationIssue[];
}

const SNIFF_LINES = 50;

/**
 * Names the format of a dropped file's text, or of an already parsed value: OpenTraces records,
 * AI SDK steps, Claude Code, Codex, or Pi JSONL, or an OpenCode session export. Null when unknown.
 */
export function detectFormat(input: string | unknown): Format | null {
  return sniffFormat(input).format;
}

/** Detects the format of a dropped file or value and converts it into trace records. */
export function detect(input: string | unknown): Detected | null {
  const { format, value } = sniffFormat(input);
  if (!format) return null;
  const text = typeof input === "string" ? input : undefined;
  const one = (record: TraceRecord): Detected => ({ format, records: [record], issues: [] });
  switch (format) {
    case "opentraces": {
      const { records, issues } = parseTraces(text ?? JSON.stringify(value));
      return { format, records, issues };
    }
    case "ai-sdk": {
      const steps = Array.isArray(value) ? value : isObject(value) ? value.steps : [];
      return one(fromSteps(steps as never[]));
    }
    case "opencode":
      return one(fromOpenCode(value as OpenCodeSession));
    case "claude-code":
      return one(fromClaudeCode(text ?? (value as Json[])));
    case "codex":
      return one(fromCodex(text ?? (value as Json[])));
    case "pi":
      return one(fromPi(text ?? (value as Json[])));
  }
}

function sniffFormat(input: unknown): { format: Format | null; value: unknown } {
  const value = typeof input === "string" ? parseWhole(input) : input;
  if (value !== undefined) return { format: detectValue(value), value };
  return { format: typeof input === "string" ? detectLines(sniff(input)) : null, value };
}

function parseWhole(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  // JSONL also starts with "{"; only a single document parses whole.
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function sniff(text: string): Json[] {
  const out: Json[] = [];
  let start = 0;
  while (out.length < SNIFF_LINES && start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isObject(value)) out.push(value);
    } catch {}
  }
  return out;
}

function detectValue(value: unknown): Format | null {
  if (Array.isArray(value)) {
    const first = value.find(isObject);
    if (!first) return null;
    if (isTraceRecord(first)) return "opentraces";
    if (isAiSdkStep(first)) return "ai-sdk";
    return detectLines(value.filter(isObject).slice(0, SNIFF_LINES));
  }
  if (!isObject(value)) return null;
  if (isTraceRecord(value)) return "opentraces";
  if (isObject(value.info) && Array.isArray(value.messages)) return "opencode";
  if (Array.isArray(value.steps) && value.steps.some(isAiSdkStep)) return "ai-sdk";
  return detectLines([value]);
}

function detectLines(lines: Json[]): Format | null {
  if (!lines.length) return null;
  if (lines.some(isTraceRecord)) return "opentraces";
  if (
    lines.some(
      (line) =>
        line.type === "session_meta" || (line.type === "response_item" && isObject(line.payload)),
    )
  ) {
    return "codex";
  }
  if (
    lines.some(
      (line) => line.type === "session" && typeof line.version === "number" && "cwd" in line,
    )
  )
    return "pi";
  if (lines.some((line) => line.type === "message" && "parentId" in line && isObject(line.message)))
    return "pi";
  const claude = (line: Json) =>
    (typeof line.sessionId === "string" && ("uuid" in line || line.type === "queue-operation")) ||
    (line.type === "summary" && "leafUuid" in line);
  if (lines.some(claude)) {
    return "claude-code";
  }
  return null;
}

function isTraceRecord(value: Json): boolean {
  return (
    typeof value.schema_version === "string" &&
    typeof value.trace_id === "string" &&
    isObject(value.agent)
  );
}

function isAiSdkStep(value: unknown): boolean {
  return (
    isObject(value) && Array.isArray(value.content) && "finishReason" in value && "usage" in value
  );
}
