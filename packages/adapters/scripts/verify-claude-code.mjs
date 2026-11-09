// Converts real Claude Code transcripts on this machine and validates the output.
// Usage: node scripts/verify-claude-code.mjs [root=~/.claude/projects]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fromClaudeCode } from "../dist/claude-code.js";
import { createReport } from "./verify-lib.mjs";

const root = process.argv[2] ?? join(homedir(), ".claude/projects");
const report = createReport("claude-code");
for (const project of readdirSync(root)) {
  const dir = join(root, project);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
    const path = join(dir, file);
    const text = readFileSync(path, "utf8");
    const subagents = {};
    const subdir = join(dir, basename(file, ".jsonl"), "subagents");
    if (existsSync(subdir)) {
      for (const name of readdirSync(subdir).filter((n) => n.endsWith(".jsonl"))) {
        subagents[basename(name, ".jsonl").replace(/^agent-/, "")] = readFileSync(
          join(subdir, name),
          "utf8",
        );
      }
    }
    let calls = 0;
    let results = 0;
    const seen = new Set();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.isSidechain) continue;
      for (const block of Array.isArray(entry.message?.content) ? entry.message.content : []) {
        if (entry.type === "assistant" && block.type === "tool_use" && !seen.has(block.id)) {
          seen.add(block.id);
          calls++;
        }
        if (entry.type === "user" && block.type === "tool_result" && seen.has(block.tool_use_id))
          results++;
      }
    }
    const subCount = Object.keys(subagents).length;
    report.check(
      `${project}/${file}`,
      () => fromClaudeCode(text, { subagents }),
      subCount ? {} : { calls, results },
    );
  }
}
report.print();
