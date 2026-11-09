import { detect } from "@tetraslam/kiseki-adapters";
import { resolveGenerations, type TraceRecord, type ValidationIssue } from "@tetraslam/kiseki-core";

export interface Converted {
  format: string;
  records: TraceRecord[];
  issues: ValidationIssue[];
}

/** Turns the text of a dropped file into records. Runs in the parse worker for large files. */
export function convert(text: string): Converted {
  const detected = detect(text);
  if (!detected) throw new Error("not a format kiseki reads");
  return { ...detected, records: resolveGenerations(detected.records) };
}
