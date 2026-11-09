import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalize, type TraceRecord, validateTrace } from "@tetraslam/kiseki-core";
import { describe, expect, it } from "vitest";
import { fromClaudeCode } from "../src/claude-code";
import { fromCodex } from "../src/codex";
import { detect, detectFormat } from "../src/index";
import { fromOpenCode, type OpenCodeSession } from "../src/opencode";
import { fromPi } from "../src/pi";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const json = <T>(name: string) => JSON.parse(fixture(name)) as T;

/** Validates a record and checks that every tool call pairs with an observation. */
function check(record: TraceRecord) {
  const { record: valid, issues } = validateTrace(record);
  expect(issues).toEqual([]);
  expect(valid).not.toBeNull();
  const calls = normalize(record).steps.flatMap((step) => step.calls);
  expect(calls.every((call) => call.observation)).toBe(true);
  for (const step of record.steps ?? []) {
    for (const observation of step.observations ?? []) {
      expect(observation.output_summary?.length ?? 0).toBeLessThanOrEqual(200);
    }
  }
  return record;
}

const shape = (record: TraceRecord) =>
  (record.steps ?? []).map((step) => [
    step.role,
    ...(step.tool_calls ?? []).map((call) => call.tool_name),
  ]);

describe("claude-code", () => {
  const session = fixture("claude-code/session.jsonl");
  const subagent = fixture(
    "claude-code/5f0c2a8e-1b7d-4c3e-9a10-2d6f8e4b7c01/subagents/agent-a3f9c1d2e4b5a6978.jsonl",
  );

  it("merges streamed lines into one step per message and pairs results", () => {
    const record = check(fromClaudeCode(session));
    expect(shape(record)).toEqual([
      ["user"],
      ["agent", "Write"],
      ["agent", "Edit", "Read"],
      ["agent", "Agent"],
      ["agent", "Agent"],
      ["user"],
      ["agent"],
    ]);
    const first = record.steps?.[1];
    expect(first?.reasoning_content).toBe("Create the file, then edit it.");
    expect(first?.content).toBe("Creating the file first.");
    expect(first?.token_usage).toEqual({
      input_tokens: 912,
      output_tokens: 40,
      cache_write_tokens: 900,
    });
    expect(record.steps?.[2]?.observations?.[1]?.error).toBe("File does not exist.");
    expect(record.steps?.[2]?.tool_calls?.[0]?.duration_ms).toBe(1000);
    expect(record.agent).toEqual({
      name: "claude-code",
      version: "2.1.305",
      model: "claude-sonnet-5-5",
    });
    expect(record.task?.description).toBe(
      "Add a farewell line to greeting.txt, then count its lines.",
    );
    expect(record.metrics?.estimated_cost_usd).toBe(0.0123);
    expect(record.metadata?.title).toBe("Add farewell line");
  });

  it("emits Write and Edit patches with a diff from structuredPatch", () => {
    const record = fromClaudeCode(session);
    expect(record.patches).toEqual([
      {
        patch_id: "toolu_01Write",
        file_path: "/work/demo/greeting.txt",
        step_index: 1,
        tool_call_id: "toolu_01Write",
      },
      {
        patch_id: "toolu_01Edit",
        file_path: "/work/demo/greeting.txt",
        step_index: 2,
        tool_call_id: "toolu_01Edit",
        diff: "--- a//work/demo/greeting.txt\n+++ b//work/demo/greeting.txt\n@@ -1,1 +1,2 @@\n hello\n+goodbye\n",
      },
    ]);
    expect(record.steps?.[2]?.tool_calls?.[0]?.input).toMatchObject({
      old_string: "hello",
      new_string: "hello\ngoodbye",
    });
  });

  it("references subagents, or inlines their transcripts", () => {
    const referenced = fromClaudeCode(session);
    expect(referenced.steps?.[3]?.subagent_trajectory_ref).toBe("a3f9c1d2e4b5a6978");

    const inlined = check(fromClaudeCode(session, { subagents: { a3f9c1d2e4b5a6978: subagent } }));
    const children = (inlined.steps ?? []).filter((step) => step.parent_step === 3);
    expect(children.map((step) => [step.role, step.call_type, step.agent_role])).toEqual([
      ["user", "subagent", "general-purpose"],
      ["agent", "subagent", "general-purpose"],
      ["agent", "subagent", "general-purpose"],
    ]);
    expect(inlined.steps?.[3]?.subagent_trajectory_ref).toBeUndefined();
    // The other subagent has no transcript, so it stays a reference.
    expect(inlined.steps?.[7]?.subagent_trajectory_ref).toBe("b7e2d4c6a8f0b1c3d");
    expect(normalize(inlined).steps[3]?.children).toHaveLength(3);
  });

  it("converts a subagent transcript on its own", () => {
    const record = check(fromClaudeCode(subagent));
    expect(shape(record)).toEqual([["user"], ["agent", "Bash"], ["agent"]]);
    // Keyed by agent id, so it resolves a parent's `subagent_trajectory_ref`.
    expect(record.session_id).toBe("a3f9c1d2e4b5a6978");
  });
});

describe("opencode", () => {
  const session = json<OpenCodeSession>("opencode/session.json");
  const child = json<OpenCodeSession>("opencode/child.json");

  it("converts a v2 export", () => {
    const record = check(fromOpenCode(session));
    expect(shape(record)).toEqual([
      ["user"],
      ["system"],
      ["agent", "edit", "read"],
      ["agent", "task"],
      ["agent"],
    ]);
    const edit = record.steps?.[2];
    expect(edit?.reasoning_content).toBe("Edit the first line.");
    expect(edit?.model).toBe("openai/gpt-6.1-terra");
    expect(edit?.token_usage).toEqual({
      input_tokens: 1200,
      output_tokens: 50,
      cache_read_tokens: 1000,
    });
    expect(edit?.tool_calls?.[0]).toMatchObject({
      input: { oldString: "draft", newString: "final" },
      duration_ms: 1000,
    });
    expect(edit?.observations?.[1]?.error).toBe("File not found: /work/demo/missing.md");
    expect(record.patches?.[0]).toMatchObject({
      file_path: "/work/demo/notes.md",
      step_index: 2,
      tool_call_id: "call_0fixtureedit",
    });
    expect(record.patches?.[0]?.diff).toContain("+final");
    expect(record.outcome).toEqual({
      description: "OpenCode run succeeded",
      signal_source: "opencode",
    });
    expect(record.metrics?.estimated_cost_usd).toBe(0.02);
    expect(record.steps?.[3]?.subagent_trajectory_ref).toBe("ses_0fixturechild0000000000001");
  });

  it("inlines child sessions", () => {
    const record = check(
      fromOpenCode(session, { children: { ses_0fixturechild0000000000001: child } }),
    );
    const children = (record.steps ?? []).filter((step) => step.parent_step === 3);
    expect(children.map((step) => [step.role, step.call_type, step.agent_role])).toEqual([
      ["user", "subagent", "general"],
      ["agent", "subagent", "general"],
    ]);
  });

  it("reads raw session_message rows", () => {
    const rows = session.messages.map(({ id, type, ...data }, seq) => ({
      id,
      type,
      seq,
      data: JSON.stringify(data),
    }));
    expect(shape(fromOpenCode({ info: session.info, messages: rows }))).toEqual(
      shape(fromOpenCode(session)),
    );
  });

  it("splits v1 messages into one step per step-start span", () => {
    const record = check(fromOpenCode(json<OpenCodeSession>("opencode/session-v1.json")));
    expect(shape(record)).toEqual([
      ["user"],
      ["agent", "grep"],
      ["agent", "edit", "bash"],
      ["agent"],
    ]);
    expect(record.steps?.[1]?.token_usage).toEqual({
      input_tokens: 270,
      output_tokens: 10,
      cache_read_tokens: 250,
    });
    expect(record.steps?.[2]?.observations?.[1]?.error).toBe("Command exited with code 2");
    expect(record.patches?.[0]?.diff).toContain("+the end");
    expect(record.agent).toEqual({
      name: "opencode",
      version: "1.18.16",
      model: "anthropic/claude-sonnet-5-5",
    });
    expect(record.outcome).toBeUndefined();
  });
});

describe("codex", () => {
  it("splits steps at token_count and pairs outputs", () => {
    const record = check(fromCodex(fixture("codex/rollout.jsonl")));
    expect(shape(record)).toEqual([
      ["user"],
      ["agent", "exec_command"],
      ["agent", "apply_patch"],
      ["agent", "web_search", "exec_command"],
      ["agent"],
    ]);
    expect(record.steps?.[0]?.content).toBe("Rename the project in pyproject.toml to demo.");
    expect(record.steps?.[1]).toMatchObject({
      reasoning_content: "Look at the file first.",
      content: "Reading the project file.",
      token_usage: { input_tokens: 1500, output_tokens: 40, cache_read_tokens: 1000 },
    });
    expect(record.steps?.[1]?.tool_calls?.[0]).toMatchObject({
      input: { cmd: "cat pyproject.toml" },
      duration_ms: 10,
    });
    expect(record.agent).toEqual({ name: "codex", version: "0.129.0", model: "openai/gpt-5.5" });
  });

  it("emits apply_patch patches with diffs from patch_apply_end", () => {
    const record = fromCodex(fixture("codex/rollout.jsonl"));
    expect(record.patches?.map((patch) => [patch.patch_id, patch.file_path])).toEqual([
      ["call_fixturePatch1:0", "pyproject.toml"],
      ["call_fixturePatch1:1", "NOTES.md"],
    ]);
    expect(record.patches?.[0]?.diff).toContain('+name = "demo"');
    expect(record.patches?.[1]?.diff).toBe(
      "--- /dev/null\n+++ b//work/demo/NOTES.md\n@@ -0,0 +1,1 @@\n+renamed\n",
    );
    expect(record.steps?.[2]?.tool_calls?.[0]?.input?.input).toContain("*** Begin Patch");
  });
});

describe("pi", () => {
  it("follows the active branch and pairs tool results", () => {
    const record = check(fromPi(fixture("pi/session.jsonl")));
    expect(shape(record)).toEqual([
      ["system"],
      ["user"],
      ["agent", "write"],
      ["agent", "edit"],
      ["agent", "read"],
      ["agent"],
    ]);
    expect(record.steps?.some((step) => step.content === "Abandoned reply.")).toBe(false);
    expect(record.steps?.[2]).toMatchObject({
      reasoning_content: "Write first.",
      model: "anthropic/claude-sonnet-5-5",
      token_usage: { input_tokens: 1100, output_tokens: 20, cache_read_tokens: 1000 },
    });
    expect(record.steps?.[4]?.observations?.[0]?.error).toBe("ENOENT: no such file or directory");
    expect(
      record.patches?.map((patch) => [patch.file_path, patch.step_index, Boolean(patch.diff)]),
    ).toEqual([
      ["todo.txt", 2, false],
      ["todo.txt", 3, true],
    ]);
    expect(record.metrics?.estimated_cost_usd).toBeCloseTo(0.012);
  });
});

describe("detect", () => {
  it("names each format", () => {
    expect(detectFormat(fixture("claude-code/session.jsonl"))).toBe("claude-code");
    expect(detectFormat(fixture("opencode/session.json"))).toBe("opencode");
    expect(detectFormat(fixture("opencode/session-v1.json"))).toBe("opencode");
    expect(detectFormat(fixture("codex/rollout.jsonl"))).toBe("codex");
    expect(detectFormat(fixture("pi/session.jsonl"))).toBe("pi");
    expect(detectFormat(JSON.parse(fixture("opencode/session.json")))).toBe("opencode");
    expect(detectFormat("not json")).toBeNull();
    expect(detectFormat('{"hello": 1}')).toBeNull();
  });

  it("passes OpenTraces records through core's parser", () => {
    const record = fromPi(fixture("pi/session.jsonl"));
    const text = `${JSON.stringify(record)}\n${JSON.stringify({ ...record, trace_id: "second" })}\n`;
    const detected = detect(text);
    expect(detected?.format).toBe("opentraces");
    expect(detected?.records).toHaveLength(2);
    expect(detect(JSON.stringify(record))?.records[0]?.trace_id).toBe(record.trace_id);
  });

  it("converts a dropped file", () => {
    const detected = detect(fixture("codex/rollout.jsonl"));
    expect(detected?.format).toBe("codex");
    expect(detected?.records[0]?.steps).toHaveLength(5);
  });
});

describe("browser safety", () => {
  it("keeps Node APIs out of the library", () => {
    const src = join(import.meta.dirname, "../src");
    for (const name of readdirSync(src)) {
      const text = readFileSync(join(src, name), "utf8");
      expect(text, name).not.toMatch(/from "node:|require\(|\bprocess\.|\bBuffer\b/);
    }
  });
});
