import type { PairedCall, Patch } from "@tetraslam/kiseki-core";
import type { PatchContent } from "./types";

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

/**
 * Finds diff content for a patch without a network round trip. OpenTraces patches carry only
 * snapshot ids, so kiseki looks at a `diff`/`patch` string on the patch itself, then at the
 * producing tool call's input: `old_string`/`new_string` (Edit), `edits[]` (MultiEdit),
 * `content` (Write), or a unified `patch`/`diff` (apply_patch).
 */
export function derivePatch(patch: Patch, call?: PairedCall): PatchContent | undefined {
  const own = str(patch.diff) ?? str(patch.unified_diff) ?? str(patch.patch);
  if (own) return { patch: own };
  if (str(patch.before) != null || str(patch.after) != null) {
    return { before: str(patch.before) ?? null, after: str(patch.after) ?? null };
  }
  const input = call?.call.input;
  if (!input) return undefined;
  const unified = str(input.patch) ?? str(input.diff);
  if (unified) return { patch: unified };
  const oldString = str(input.old_string) ?? str(input.oldString);
  const newString = str(input.new_string) ?? str(input.newString);
  if (oldString != null || newString != null) {
    return { before: oldString ?? "", after: newString ?? "" };
  }
  if (Array.isArray(input.edits)) {
    const edits = input.edits as Record<string, unknown>[];
    return {
      before: edits.map((e) => str(e.old_string) ?? str(e.oldString) ?? "").join("\n⋯\n"),
      after: edits.map((e) => str(e.new_string) ?? str(e.newString) ?? "").join("\n⋯\n"),
    };
  }
  const content = str(input.content);
  if (content != null) return { before: null, after: content };
  return undefined;
}

/** Added and removed line counts, without computing a real diff. */
export function lineCounts(content: PatchContent): { added: number; removed: number } {
  if (content.patch != null) {
    let added = 0;
    let removed = 0;
    for (const line of content.patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    return { added, removed };
  }
  const count = (text: string | null) => (text ? text.split("\n").length : 0);
  return { added: count(content.after), removed: count(content.before) };
}

/** A unified diff header in a patch string means it already names its own file. */
export function hasFileHeader(patch: string): boolean {
  return /^(diff --git|--- |\+\+\+ )/m.test(patch);
}

export function withFileHeader(patch: string, path: string): string {
  if (hasFileHeader(patch)) return patch;
  return `--- a/${path}\n+++ b/${path}\n${patch}`;
}
