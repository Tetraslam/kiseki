// Converts real Codex rollouts on this machine and validates the output.
// Usage: node scripts/verify-codex.mjs [root=~/.codex/sessions]
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromCodex } from "../dist/codex.js";
import { createReport } from "./verify-lib.mjs";

const root = process.argv[2] ?? join(homedir(), ".codex/sessions");
const files = readdirSync(root, { recursive: true })
  .filter((name) => name.endsWith(".jsonl"))
  .map((name) => join(root, name));
const report = createReport("codex");
for (const file of files) {
  const text = readFileSync(file, "utf8");
  let calls = 0;
  let results = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const { type, payload } = JSON.parse(line);
    if (type !== "response_item") continue;
    if (
      ["function_call", "custom_tool_call", "local_shell_call", "web_search_call"].includes(
        payload.type,
      )
    )
      calls++;
    if (payload.type.endsWith("_output") || payload.type === "web_search_call") results++;
  }
  const record = report.check(file, () => fromCodex(text), { calls, results });
  if (record)
    console.log(
      file.split("/").pop(),
      record.steps.length,
      "steps",
      record.patches?.length ?? 0,
      "patches",
      record.agent,
    );
}
report.print();
