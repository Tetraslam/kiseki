// Converts real Pi sessions on this machine and validates the output.
// Usage: node scripts/verify-pi.mjs [root=~/.pi/agent/sessions]
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromPi } from "../dist/pi.js";
import { createReport } from "./verify-lib.mjs";

const root = process.argv[2] ?? join(homedir(), ".pi/agent/sessions");
const report = createReport("pi");
for (const name of readdirSync(root, { recursive: true }).filter((n) => n.endsWith(".jsonl"))) {
  const text = readFileSync(join(root, name), "utf8");
  const record = report.check(name, () => fromPi(text));
  if (record)
    console.log(
      name,
      JSON.stringify(
        record.steps.map((s) => [
          s.role,
          s.content?.slice(0, 30),
          s.reasoning_content?.slice(0, 30),
          s.token_usage,
        ]),
      ),
    );
}
report.print();
