import { z } from "zod";
import type { Step, TraceRecord } from "./types";

const count = z.number().nonnegative();
const optionalString = z.string().nullish();

const toolCall = z.looseObject({
  tool_call_id: z.string(),
  tool_name: z.string(),
  input: z.record(z.string(), z.unknown()).nullish(),
  duration_ms: count.nullish(),
});

const observation = z.looseObject({
  source_call_id: z.string(),
  content: optionalString,
  output_summary: optionalString,
  error: optionalString,
});

export const stepSchema = z.looseObject({
  step_index: z.number().int().nonnegative(),
  role: z.enum(["system", "user", "agent"]),
  content: optionalString,
  reasoning_content: optionalString,
  model: optionalString,
  agent_role: optionalString,
  parent_step: z.number().int().nullish(),
  call_type: z.enum(["main", "subagent", "warmup"]).nullish(),
  subagent_trajectory_ref: optionalString,
  tool_calls: z.array(toolCall).nullish(),
  observations: z.array(observation).nullish(),
  token_usage: z
    .looseObject({
      input_tokens: count.nullish(),
      output_tokens: count.nullish(),
      cache_read_tokens: count.nullish(),
      cache_write_tokens: count.nullish(),
      prefix_reuse_tokens: count.nullish(),
    })
    .nullish(),
  timestamp: optionalString,
});

export const recordSchema = z.looseObject({
  schema_version: z.string(),
  trace_id: z.string(),
  session_id: z.string(),
  agent: z.looseObject({ name: z.string(), version: optionalString, model: optionalString }),
  steps: z.array(z.unknown()).nullish(),
  patches: z
    .array(
      z.looseObject({
        patch_id: z.string(),
        file_path: z.string(),
        step_index: z.number().int().nullish(),
        tool_call_id: optionalString,
      }),
    )
    .nullish(),
  generation_index: z.number().int().nullish(),
});

export interface ValidationIssue {
  /** JSON path, e.g. `steps.4.role`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  /** The record with invalid steps removed, or null when the record itself is unusable. */
  record: TraceRecord | null;
  issues: ValidationIssue[];
}

/**
 * Checks a value against the parts of OpenTraces 0.9 kiseki relies on. Invalid steps are dropped
 * and reported instead of failing the whole record, so a partial trace still renders.
 */
export function validateTrace(value: unknown): ValidationResult {
  const head = recordSchema.safeParse(value);
  if (!head.success) {
    return { record: null, issues: head.error.issues.map((issue) => toIssue(issue)) };
  }
  const issues: ValidationIssue[] = [];
  const steps: Step[] = [];
  const raw = head.data.steps ?? [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = stepSchema.safeParse(raw[i]);
    if (parsed.success) steps.push(parsed.data as Step);
    else for (const issue of parsed.error.issues) issues.push(toIssue(issue, `steps.${i}`));
  }
  const major = head.data.schema_version.split(".").slice(0, 2).join(".");
  if (major !== "0.9") {
    issues.push({
      path: "schema_version",
      message: `kiseki reads OpenTraces 0.9; this record is ${head.data.schema_version}`,
    });
  }
  return { record: { ...(head.data as TraceRecord), steps }, issues };
}

function toIssue(issue: z.core.$ZodIssue, prefix?: string): ValidationIssue {
  const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
  return { path, message: issue.message };
}
