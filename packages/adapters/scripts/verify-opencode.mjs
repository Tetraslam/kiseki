// Converts real OpenCode sessions on this machine and validates the output. Opens the database
// read-only. Usage: node scripts/verify-opencode.mjs [limit=400] [exports=25]
//   v2 rows:  session_v2 + session_message rows, as stored
//   v1 parts: legacy message + part tables, in the OpenCode 1.x export shape
//   export:   `opencode session export <id>` output, the shape most users will drop
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fromOpenCode } from "../dist/opencode.js";
import { createReport } from "./verify-lib.mjs";

const limit = Number(process.argv[2] ?? 400);
const exports = Number(process.argv[3] ?? 25);
const db = new DatabaseSync(join(homedir(), ".local/share/opencode/opencode.db"), {
  readOnly: true,
});

const sessions = db.prepare("select * from session_v2 order by random() limit ?").all(limit);
const messages = db.prepare(
  "select id, type, seq, time_created, data from session_message where session_id = ? order by seq",
);
const children = db.prepare("select id from session_v2 where parent_id = ?");

function sourceCounts(rows) {
  let calls = 0;
  let results = 0;
  for (const row of rows) {
    if (row.type !== "assistant") continue;
    for (const part of JSON.parse(row.data).content ?? []) {
      if (part.type !== "tool") continue;
      calls++;
      if (part.state?.status === "completed" || part.state?.status === "error") results++;
    }
  }
  return { calls, results };
}

const v2 = createReport("opencode v2 rows");
for (const session of sessions) {
  const rows = messages.all(session.id);
  const kids = {};
  for (const { id } of children.all(session.id))
    kids[id] = { info: { id }, messages: messages.all(id) };
  v2.check(session.id, () => fromOpenCode({ info: session, messages: rows }), sourceCounts(rows));
  // With children inlined, every call still pairs.
  if (Object.keys(kids).length)
    v2.check(`${session.id}+children`, () =>
      fromOpenCode({ info: session, messages: rows }, { children: kids }),
    );
}
v2.print();

const v1 = createReport("opencode v1 parts");
const v1Sessions = db.prepare("select * from session order by random() limit ?").all(limit);
const v1Messages = db.prepare(
  "select id, data from message where session_id = ? order by time_created, id",
);
const v1Parts = db.prepare("select data from part where message_id = ? order by id");
for (const session of v1Sessions) {
  let calls = 0;
  let results = 0;
  const list = v1Messages.all(session.id).map((row) => {
    const parts = v1Parts.all(row.id).map((part) => JSON.parse(part.data));
    for (const part of parts) {
      if (part.type !== "tool") continue;
      calls++;
      if (part.state?.status === "completed" || part.state?.status === "error") results++;
    }
    return { info: { id: row.id, ...JSON.parse(row.data) }, parts };
  });
  const info = {
    id: session.id,
    title: session.title,
    version: session.version,
    parentID: session.parent_id,
  };
  v1.check(session.id, () => fromOpenCode({ info, messages: list }), { calls, results });
}
v1.print();

// Piping large exports into execFileSync truncates them, so redirect to a file.
const scratch = mkdtempSync(join(tmpdir(), "kiseki-opencode-"));
const exported = createReport("opencode export");
for (const session of sessions.slice(0, exports)) {
  let text;
  try {
    const file = join(scratch, `${session.id}.json`);
    execFileSync("sh", ["-c", 'opencode session export "$1" > "$2"', "sh", session.id, file]);
    text = readFileSync(file, "utf8");
  } catch (error) {
    exported.problems.push(`${session.id}: export failed ${error.message.split("\n")[0]}`);
    continue;
  }
  const rows = messages.all(session.id);
  const record = exported.check(session.id, () => fromOpenCode(text), sourceCounts(rows));
  const fromRows = fromOpenCode({ info: session, messages: rows });
  if (record && record.steps.length !== fromRows.steps.length) {
    exported.problems.push(
      `${session.id}: export has ${record.steps.length} steps, rows ${fromRows.steps.length}`,
    );
  }
}
exported.print();
rmSync(scratch, { recursive: true });
