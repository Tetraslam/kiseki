import { type ValidationIssue, validateTrace } from "./schema";
import type { TraceRecord } from "./types";

export interface ParseResult {
  records: TraceRecord[];
  issues: ValidationIssue[];
}

/**
 * Parses OpenTraces text: one JSON record, a JSON array of records, or JSONL with one record per
 * line. Records are validated; lines that fail are reported with their line number.
 */
export function parseTraces(text: string): ParseResult {
  const trimmed = text.trim();
  const issues: ValidationIssue[] = [];
  const values: { value: unknown; at: string }[] = [];
  if (trimmed.startsWith("[")) {
    const array = JSON.parse(trimmed) as unknown[];
    array.forEach((value, i) => {
      values.push({ value, at: `[${i}]` });
    });
  } else {
    // A single pretty-printed object spans many lines, so try the whole text first.
    let whole: unknown;
    let single = false;
    try {
      whole = JSON.parse(trimmed);
      single = true;
    } catch {}
    if (single) values.push({ value: whole, at: "" });
    else {
      const lines = trimmed.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;
        try {
          values.push({ value: JSON.parse(line), at: `line ${i + 1}` });
        } catch (error) {
          issues.push({ path: `line ${i + 1}`, message: (error as Error).message });
        }
      }
    }
  }
  const records: TraceRecord[] = [];
  for (const { value, at } of values) {
    const result = validateTrace(value);
    for (const issue of result.issues) {
      issues.push({ path: [at, issue.path].filter(Boolean).join(" "), message: issue.message });
    }
    if (result.record) records.push(result.record);
  }
  return { records, issues };
}

/**
 * Keeps the latest generation of each session. A later `generation_index` of the same
 * `session_id` supersedes earlier ones; ties keep the record that appears last.
 */
export function resolveGenerations(records: TraceRecord[]): TraceRecord[] {
  const latest = new Map<string, { record: TraceRecord; order: number }>();
  records.forEach((record, order) => {
    const current = latest.get(record.session_id);
    if (!current || (record.generation_index ?? 0) >= (current.record.generation_index ?? 0)) {
      latest.set(record.session_id, { record, order: current?.order ?? order });
    }
  });
  return [...latest.values()].sort((a, b) => a.order - b.order).map((entry) => entry.record);
}
