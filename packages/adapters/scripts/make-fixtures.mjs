// Writes the adapter test fixtures. Each mirrors the structure of real sessions (keys, nesting,
// event types, id formats) recorded on a dev machine, with invented content. Run from anywhere:
//   node packages/adapters/scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const write = (name, value) => {
  const path = join(out, name);
  mkdirSync(dirname(path), { recursive: true });
  const text = Array.isArray(value)
    ? `${value.map((v) => JSON.stringify(v)).join("\n")}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
};

// Claude Code 2.1.x: ~/.claude/projects/<project>/<session>.jsonl and <session>/subagents/agent-<id>.jsonl
{
  const sessionId = "5f0c2a8e-1b7d-4c3e-9a10-2d6f8e4b7c01";
  const agentId = "a3f9c1d2e4b5a6978";
  const base = {
    userType: "external",
    entrypoint: "cli",
    cwd: "/work/demo",
    sessionId,
    version: "2.1.305",
    gitBranch: "main",
  };
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  let parent = null;
  const t = (s) => `2026-11-01T10:00:${String(s).padStart(2, "0")}.000Z`;
  const entry = (type, fields, extra = {}) => {
    const id = uuid();
    const value = {
      parentUuid: parent,
      isSidechain: false,
      ...extra,
      type,
      ...fields,
      uuid: id,
      ...base,
    };
    parent = id;
    return value;
  };
  const usage = (input, output, read, write) => ({
    input_tokens: input,
    cache_creation_input_tokens: write,
    cache_read_input_tokens: read,
    output_tokens: output,
    service_tier: "standard",
  });
  const assistant = (id, block, s, u, extra) =>
    entry(
      "assistant",
      {
        message: {
          model: "claude-sonnet-5-5",
          id,
          type: "message",
          role: "assistant",
          content: [block],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: u,
        },
        requestId: `req_${id.slice(4)}`,
        timestamp: t(s),
      },
      extra,
    );
  const result = (callId, content, s, toolUseResult, isError) =>
    entry("user", {
      message: {
        role: "user",
        content: [
          {
            tool_use_id: callId,
            type: "tool_result",
            content,
            ...(isError ? { is_error: true } : {}),
          },
        ],
      },
      timestamp: t(s),
      toolUseResult,
      sourceToolAssistantUUID: parent,
    });

  const main = [
    {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: t(0),
      sessionId,
      content: "Add a farewell line",
    },
    entry("user", {
      promptId: "p-1",
      message: {
        role: "user",
        content: "Add a farewell line to greeting.txt, then count its lines.",
      },
      timestamp: t(1),
    }),
    entry("attachment", { attachment: { type: "date", date: "2026-11-01" }, timestamp: t(1) }),
    assistant(
      "msg_01Fixture0001",
      { type: "thinking", thinking: "Create the file, then edit it.", signature: "sig" },
      2,
      usage(12, 40, 0, 900),
    ),
    assistant(
      "msg_01Fixture0001",
      { type: "text", text: "Creating the file first." },
      2,
      usage(12, 40, 0, 900),
    ),
    assistant(
      "msg_01Fixture0001",
      {
        type: "tool_use",
        id: "toolu_01Write",
        name: "Write",
        input: { file_path: "/work/demo/greeting.txt", content: "hello\n" },
        caller: { type: "direct" },
      },
      3,
      usage(12, 40, 0, 900),
    ),
    result("toolu_01Write", "File created successfully at: /work/demo/greeting.txt", 4, {
      type: "create",
      filePath: "/work/demo/greeting.txt",
      content: "hello\n",
      structuredPatch: [],
      originalFile: null,
    }),
    assistant(
      "msg_01Fixture0002",
      {
        type: "tool_use",
        id: "toolu_01Edit",
        name: "Edit",
        input: {
          replace_all: false,
          file_path: "/work/demo/greeting.txt",
          old_string: "hello",
          new_string: "hello\ngoodbye",
        },
        caller: { type: "direct" },
      },
      5,
      usage(8, 30, 900, 20),
    ),
    result("toolu_01Edit", "The file /work/demo/greeting.txt has been updated successfully.", 6, {
      filePath: "/work/demo/greeting.txt",
      oldString: "hello",
      newString: "hello\ngoodbye",
      originalFile: "hello\n",
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" hello", "+goodbye"] },
      ],
      userModified: false,
      replaceAll: false,
    }),
    assistant(
      "msg_01Fixture0002",
      {
        type: "tool_use",
        id: "toolu_01Read",
        name: "Read",
        input: { file_path: "/work/demo/missing.txt" },
        caller: { type: "direct" },
      },
      6,
      usage(8, 30, 900, 20),
    ),
    result("toolu_01Read", "File does not exist.", 7, "Error: File does not exist.", true),
    assistant(
      "msg_01Fixture0003",
      {
        type: "tool_use",
        id: "toolu_01Agent",
        name: "Agent",
        input: {
          description: "Count lines",
          subagent_type: "general-purpose",
          prompt: "Count the lines in greeting.txt.",
        },
        caller: { type: "direct" },
      },
      8,
      usage(6, 50, 920, 10),
    ),
    result("toolu_01Agent", [{ type: "text", text: "Async agent launched successfully." }], 9, {
      isAsync: true,
      status: "async_launched",
      agentId,
      description: "Count lines",
      prompt: "Count the lines in greeting.txt.",
    }),
    assistant(
      "msg_01Fixture0004",
      {
        type: "tool_use",
        id: "toolu_01Agent2",
        name: "Agent",
        input: {
          description: "Proofread",
          subagent_type: "Explore",
          prompt: "Proofread greeting.txt.",
        },
        caller: { type: "direct" },
      },
      9,
      usage(6, 20, 930, 10),
    ),
    result("toolu_01Agent2", [{ type: "text", text: "Async agent launched successfully." }], 10, {
      isAsync: true,
      status: "async_launched",
      agentId: "b7e2d4c6a8f0b1c3d",
      description: "Proofread",
    }),
    entry(
      "user",
      {
        message: { role: "user", content: "<local-command-caveat>Caveat</local-command-caveat>" },
        timestamp: t(11),
      },
      { isMeta: true },
    ),
    entry("user", {
      message: {
        role: "user",
        content: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n</task-notification>`,
      },
      timestamp: t(14),
    }),
    {
      ...assistant(
        "msg_01Fixture0005",
        { type: "text", text: "greeting.txt now has 2 lines." },
        15,
        usage(5, 12, 950, 0),
      ),
      message: {
        model: "claude-sonnet-5-5",
        id: "msg_01Fixture0005",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "greeting.txt now has 2 lines." }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: usage(5, 12, 950, 0),
      },
    },
    { type: "ai-title", aiTitle: "Add farewell line", sessionId },
    {
      type: "cost-state",
      sessionId,
      totalCostUSD: 0.0123,
      totalAPIDuration: 9000,
      totalDuration: 15000,
      startTime: 0,
      modelUsage: {},
      hasUnknownModelCost: false,
    },
  ];
  write("claude-code/session.jsonl", main);

  parent = null;
  const sub = (type, fields) => entry(type, fields, { isSidechain: true, agentId });
  const subagent = [
    sub("user", {
      promptId: "p-2",
      message: { role: "user", content: "Count the lines in greeting.txt." },
      timestamp: t(10),
    }),
    {
      ...sub("assistant", {
        message: {
          model: "claude-haiku-5-5",
          id: "msg_01FixtureSub1",
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01Bash",
              name: "Bash",
              input: { command: "wc -l < greeting.txt", description: "Count lines" },
              caller: { type: "direct" },
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: usage(10, 20, 0, 500),
        },
        requestId: "req_sub1",
        timestamp: t(11),
      }),
      attributionAgent: "general-purpose",
    },
    sub("user", {
      message: {
        role: "user",
        content: [
          { tool_use_id: "toolu_01Bash", type: "tool_result", content: "2", is_error: false },
        ],
      },
      timestamp: t(12),
      sourceToolAssistantUUID: parent,
    }),
    sub("assistant", {
      message: {
        model: "claude-haiku-5-5",
        id: "msg_01FixtureSub2",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "2" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: usage(4, 2, 500, 0),
      },
      requestId: "req_sub2",
      timestamp: t(13),
    }),
  ];
  write(`claude-code/${sessionId}/subagents/agent-${agentId}.jsonl`, subagent);
}

// OpenCode 2.x: `opencode session export <id>` output.
{
  const time = (s) => 1793700000000 + s * 1000;
  const model = { id: "gpt-6.1-terra", providerID: "openai", variant: "default" };
  const tokens = (input, output, read) => ({
    input,
    output,
    reasoning: 0,
    cache: { read, write: 0 },
  });
  const diff = [
    "Index: /work/demo/notes.md",
    "===================================================================",
    "--- /work/demo/notes.md",
    "+++ /work/demo/notes.md",
    "@@ -1,1 +1,1 @@",
    "-draft",
    "+final",
    "",
  ].join("\n");
  const child = "ses_0fixturechild0000000000001";
  write("opencode/session.json", {
    info: {
      id: "ses_0fixtureparent000000000001",
      parentID: undefined,
      projectID: "0fixtureproject",
      agent: "build",
      model,
      cost: 0.02,
      tokens: tokens(300, 90, 2000),
      outcome: "succeeded",
      time: { created: time(0), updated: time(30), busy: time(0), idle: time(30) },
      title: "Finalize notes",
      location: { directory: "/work/demo" },
    },
    messages: [
      {
        id: "msg_0fixture0001",
        time: { created: time(1) },
        text: "Mark the notes as final and ask a helper to review them.",
        type: "user",
      },
      {
        id: "msg_0fixture0002",
        time: { created: time(1), streamed: time(2), completed: time(4) },
        type: "system",
        text: "Reminder: keep edits small.",
      },
      {
        id: "msg_0fixture0003",
        time: { created: time(2), streamed: time(3), completed: time(6) },
        type: "assistant",
        agent: "build",
        model,
        content: [
          {
            type: "reasoning",
            text: "Edit the first line.",
            time: { created: time(3), completed: time(3) },
          },
          { type: "text", text: "Editing notes.md." },
          {
            type: "tool",
            id: "call_0fixtureedit",
            name: "edit",
            state: {
              status: "completed",
              input: { filePath: "/work/demo/notes.md", oldString: "draft", newString: "final" },
              content: [{ type: "text", text: "Edit applied successfully." }],
              metadata: {
                diagnostics: {},
                diff,
                filediff: { file: "/work/demo/notes.md", patch: diff, additions: 1, deletions: 1 },
              },
            },
            time: { created: time(4), ran: time(4), completed: time(5) },
          },
          {
            type: "tool",
            id: "call_0fixtureread",
            name: "read",
            state: {
              status: "error",
              input: { filePath: "/work/demo/missing.md" },
              error: { type: "tool.execution", message: "File not found: /work/demo/missing.md" },
            },
            time: { created: time(4), ran: time(4), completed: time(4) },
          },
        ],
        finish: "tool-calls",
        cost: 0.01,
        tokens: tokens(200, 50, 1000),
      },
      {
        id: "msg_0fixture0004",
        time: { created: time(6), streamed: time(7), completed: time(20) },
        type: "assistant",
        agent: "build",
        model,
        content: [
          {
            type: "tool",
            id: "call_0fixturetask",
            name: "task",
            state: {
              status: "completed",
              input: {
                description: "Review notes",
                subagent_type: "general",
                prompt: "Review notes.md.",
              },
              content: [{ type: "text", text: "Looks good." }],
              metadata: {
                parentSessionId: "ses_0fixtureparent000000000001",
                sessionId: child,
                model: { providerID: "openai", modelID: "gpt-6.1-terra" },
                truncated: false,
              },
            },
            time: { created: time(7), ran: time(7), completed: time(19) },
          },
        ],
        finish: "tool-calls",
        cost: 0.005,
        tokens: tokens(60, 20, 600),
      },
      {
        id: "msg_0fixture0005",
        time: { created: time(20), streamed: time(21), completed: time(22) },
        type: "assistant",
        agent: "build",
        model,
        content: [{ type: "text", text: "Done: notes.md is final and reviewed." }],
        finish: "stop",
        cost: 0.005,
        tokens: tokens(40, 20, 400),
      },
      { id: "msg_0fixture0006", time: { created: time(30) }, type: "idle", outcome: "succeeded" },
    ],
  });
  write("opencode/child.json", {
    info: {
      id: child,
      parentID: "ses_0fixtureparent000000000001",
      projectID: "0fixtureproject",
      agent: "general",
      model,
      cost: 0,
      tokens: tokens(50, 10, 0),
      outcome: "succeeded",
      time: { created: time(7), updated: time(19) },
      title: "Review notes",
      location: { directory: "/work/demo" },
    },
    messages: [
      {
        id: "msg_0fixturec001",
        time: { created: time(7) },
        text: "Review notes.md.",
        type: "user",
      },
      {
        id: "msg_0fixturec002",
        time: { created: time(8), completed: time(18) },
        type: "assistant",
        agent: "general",
        model,
        content: [{ type: "text", text: "Looks good." }],
        finish: "stop",
        cost: 0,
        tokens: tokens(50, 10, 0),
      },
    ],
  });

  // OpenCode 1.x export: messages are { info, parts }, and one assistant message spans several
  // LLM calls separated by step-start / step-finish parts.
  const v1Tokens = (input, output, read) => ({
    total: input + output + read,
    input,
    output,
    reasoning: 0,
    cache: { read, write: 0 },
  });
  write("opencode/session-v1.json", {
    info: {
      id: "ses_0fixturev1000000000000001",
      version: "1.18.16",
      projectID: "0fixtureproject",
      directory: "/work/demo",
      title: "Fix typo",
      time: { created: time(0), updated: time(10) },
    },
    messages: [
      {
        info: {
          id: "msg_0fixturev1u01",
          sessionID: "ses_0fixturev1000000000000001",
          role: "user",
          time: { created: time(0) },
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-5-5" },
        },
        parts: [{ id: "prt_0fixture01", type: "text", text: "Fix the typo in readme.md." }],
      },
      {
        info: {
          id: "msg_0fixturev1a01",
          sessionID: "ses_0fixturev1000000000000001",
          role: "assistant",
          time: { created: time(1), completed: time(9) },
          parentID: "msg_0fixturev1u01",
          modelID: "claude-sonnet-5-5",
          providerID: "anthropic",
          mode: "build",
          agent: "build",
          path: { cwd: "/work/demo", root: "/work/demo" },
          cost: 0.004,
          tokens: v1Tokens(30, 20, 500),
          finish: "stop",
        },
        parts: [
          { id: "prt_0fixture02", type: "step-start", snapshot: "0fixturesnap1" },
          {
            id: "prt_0fixture03",
            type: "reasoning",
            text: "Find the typo first.",
            time: { start: time(1), end: time(2) },
          },
          {
            id: "prt_0fixture04",
            type: "tool",
            callID: "toolu_0fixturegrep",
            tool: "grep",
            state: {
              status: "completed",
              input: { pattern: "teh" },
              output: "readme.md:3: teh end",
              title: "teh",
              metadata: { matches: 1 },
              time: { start: time(2), end: time(3) },
            },
          },
          {
            id: "prt_0fixture05",
            type: "step-finish",
            reason: "tool-calls",
            snapshot: "0fixturesnap1",
            cost: 0.002,
            tokens: v1Tokens(20, 10, 250),
          },
          { id: "prt_0fixture06", type: "step-start", snapshot: "0fixturesnap1" },
          {
            id: "prt_0fixture07",
            type: "tool",
            callID: "toolu_0fixtureedit",
            tool: "edit",
            state: {
              status: "completed",
              input: {
                filePath: "/work/demo/readme.md",
                oldString: "teh end",
                newString: "the end",
              },
              output: "Edit applied successfully.",
              title: "readme.md",
              metadata: {
                diff: "Index: /work/demo/readme.md\n===================================================================\n--- /work/demo/readme.md\n+++ /work/demo/readme.md\n@@ -3,1 +3,1 @@\n-teh end\n+the end\n",
              },
              time: { start: time(4), end: time(5) },
            },
          },
          {
            id: "prt_0fixture08",
            type: "tool",
            callID: "toolu_0fixturebash",
            tool: "bash",
            state: {
              status: "error",
              input: { command: "make check" },
              error: "Command exited with code 2",
              time: { start: time(5), end: time(6) },
            },
          },
          {
            id: "prt_0fixture09",
            type: "step-finish",
            reason: "tool-calls",
            snapshot: "0fixturesnap2",
            cost: 0.001,
            tokens: v1Tokens(5, 5, 125),
          },
          { id: "prt_0fixture10", type: "step-start", snapshot: "0fixturesnap2" },
          {
            id: "prt_0fixture11",
            type: "text",
            text: "Fixed the typo.",
            time: { start: time(8), end: time(8) },
          },
          {
            id: "prt_0fixture12",
            type: "step-finish",
            reason: "stop",
            snapshot: "0fixturesnap2",
            cost: 0.001,
            tokens: v1Tokens(5, 5, 125),
          },
          {
            id: "prt_0fixture13",
            type: "patch",
            hash: "0fixturesnap2",
            files: ["/work/demo/readme.md"],
          },
        ],
      },
    ],
  });
}

// Codex 0.129: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl
{
  const id = "019e0000-0000-7000-8000-00000000f1c5";
  const t = (s) => `2026-05-08T07:35:${String(s).padStart(2, "0")}.000Z`;
  const line = (s, type, payload) => ({ timestamp: t(s), type, payload });
  const tokens = (input, cached, output) => ({
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: input + output,
      },
      last_token_usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: input + output,
      },
      model_context_window: 258400,
    },
    rate_limits: null,
  });
  write("codex/rollout.jsonl", [
    line(0, "session_meta", {
      id,
      timestamp: t(0),
      cwd: "/work/demo",
      originator: "codex-tui",
      cli_version: "0.129.0",
      source: "cli",
      thread_source: "user",
      model_provider: "openai",
      base_instructions: { text: "You are Codex." },
    }),
    line(0, "event_msg", {
      type: "task_started",
      turn_id: "turn-1",
      started_at: 1778225704,
      model_context_window: 258400,
      collaboration_mode_kind: "default",
    }),
    line(0, "response_item", {
      type: "message",
      role: "developer",
      content: [
        {
          type: "input_text",
          text: "<permissions instructions>sandboxed</permissions instructions>",
        },
      ],
    }),
    line(0, "response_item", {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "<environment_context>\n  <cwd>/work/demo</cwd>\n</environment_context>",
        },
      ],
    }),
    line(0, "turn_context", {
      turn_id: "turn-1",
      cwd: "/work/demo",
      current_date: "2026-05-08",
      timezone: "UTC",
      approval_policy: "never",
      sandbox_policy: { type: "danger-full-access" },
      model: "gpt-5.5",
      summary: "none",
    }),
    line(1, "response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Rename the project in pyproject.toml to demo." }],
    }),
    line(1, "event_msg", {
      type: "user_message",
      message: "Rename the project in pyproject.toml to demo.",
      images: [],
      local_images: [],
      text_elements: [],
    }),
    line(2, "response_item", {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Look at the file first." }],
      content: null,
      encrypted_content: "gAAAAfixture",
    }),
    line(3, "event_msg", {
      type: "agent_message",
      message: "Reading the project file.",
      phase: "commentary",
      memory_citation: null,
    }),
    line(3, "response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Reading the project file." }],
      phase: "commentary",
    }),
    line(3, "response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: '{"cmd":"cat pyproject.toml","workdir":"/work/demo"}',
      call_id: "call_fixtureExec1",
    }),
    line(3, "event_msg", tokens(1500, 1000, 40)),
    line(4, "response_item", {
      type: "function_call_output",
      call_id: "call_fixtureExec1",
      output:
        'Chunk ID: 0a1b2c\nWall time: 0.0100 seconds\nProcess exited with code 0\nOriginal token count: 12\nOutput:\n[project]\nname = "old"\n',
    }),
    line(5, "response_item", {
      type: "custom_tool_call",
      status: "completed",
      call_id: "call_fixturePatch1",
      name: "apply_patch",
      input:
        '*** Begin Patch\n*** Update File: pyproject.toml\n@@\n [project]\n-name = "old"\n+name = "demo"\n*** Add File: NOTES.md\n+renamed\n*** End Patch',
    }),
    line(5, "event_msg", tokens(1700, 1500, 60)),
    line(6, "event_msg", {
      type: "patch_apply_end",
      call_id: "call_fixturePatch1",
      turn_id: "turn-1",
      stdout: "Success. Updated the following files:\nM pyproject.toml\nA NOTES.md\n",
      stderr: "",
      success: true,
      changes: {
        "/work/demo/pyproject.toml": {
          type: "update",
          unified_diff: '@@ -1,2 +1,2 @@\n [project]\n-name = "old"\n+name = "demo"\n',
          move_path: null,
        },
        "/work/demo/NOTES.md": { type: "add", content: "renamed\n" },
      },
      status: "completed",
    }),
    line(6, "response_item", {
      type: "custom_tool_call_output",
      call_id: "call_fixturePatch1",
      output:
        '{"output":"Success. Updated the following files:\\nM pyproject.toml\\nA NOTES.md\\n","metadata":{"exit_code":0,"duration_seconds":0.1}}',
    }),
    line(7, "response_item", {
      type: "reasoning",
      summary: [],
      content: null,
      encrypted_content: "gAAAAfixture2",
    }),
    line(7, "event_msg", {
      type: "web_search_end",
      call_id: "ws_fixture1",
      query: "pyproject name field",
      action: { type: "search", query: "pyproject name field" },
    }),
    line(7, "response_item", {
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "pyproject name field" },
    }),
    line(8, "response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: '{"cmd":"pytest -q"}',
      call_id: "call_fixtureExec2",
    }),
    line(8, "event_msg", tokens(1900, 1700, 30)),
    line(9, "response_item", {
      type: "function_call_output",
      call_id: "call_fixtureExec2",
      output:
        "Chunk ID: 3d4e5f\nWall time: 0.5000 seconds\nProcess exited with code 1\nOriginal token count: 5\nOutput:\n1 failed\n",
    }),
    line(10, "event_msg", {
      type: "agent_message",
      message: "Renamed; one unrelated test fails.",
      phase: "final_answer",
      memory_citation: null,
    }),
    line(10, "response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Renamed; one unrelated test fails." }],
      phase: "final_answer",
    }),
    line(10, "event_msg", tokens(2000, 1900, 15)),
    line(10, "event_msg", {
      type: "task_complete",
      turn_id: "turn-1",
      last_agent_message: "Renamed; one unrelated test fails.",
      completed_at: 1778225714,
      duration_ms: 10000,
    }),
  ]);
}

// Pi 1.3 (session format v3): ~/.pi/agent/sessions/--<path>--/<time>_<id>.jsonl
{
  const t = (s) => `2026-07-16T21:19:${String(s).padStart(2, "0")}.000Z`;
  const ms = (s) => Date.parse(t(s));
  let prev = null;
  const entry = (id, s, fields) => {
    const value = { id, parentId: prev, timestamp: t(s), ...fields };
    prev = id;
    return value;
  };
  const usage = (input, output, read) => ({
    input,
    output,
    cacheRead: read,
    cacheWrite: 0,
    totalTokens: input + output + read,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
  });
  const assistant = (id, s, content, stopReason = "toolUse") =>
    entry(id, s, {
      type: "message",
      message: {
        role: "assistant",
        content,
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        usage: usage(100, 20, 1000),
        stopReason,
        timestamp: ms(s),
      },
    });
  const lines = [
    {
      type: "session",
      version: 3,
      id: "019f0000-0000-7b42-8ccb-00000000f1c5",
      timestamp: t(0),
      cwd: "/work/demo",
    },
    entry("0a1b2c3d", 0, {
      type: "model_change",
      provider: "anthropic",
      modelId: "claude-sonnet-5-5",
    }),
    entry("1b2c3d4e", 0, { type: "thinking_level_change", thinkingLevel: "medium" }),
    entry("2c3d4e5f", 1, {
      type: "message",
      message: {
        role: "system",
        content: "",
        sections: { preamble: "You are a coding assistant." },
        toolsAdded: [{ name: "edit", description: "Edit a file", parameters: {} }],
        timestamp: ms(1),
      },
    }),
    entry("3d4e5f60", 1, {
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "Write todo.txt, then mark the first item done." }],
        timestamp: ms(1),
      },
    }),
    assistant("4e5f6071", 2, [
      { type: "thinking", thinking: "Write first.", thinkingSignature: "sig" },
      {
        type: "toolCall",
        id: "toolu_fixtureWrite",
        name: "write",
        arguments: { path: "todo.txt", content: "[ ] ship\n" },
      },
    ]),
    entry("5f607182", 3, {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "toolu_fixtureWrite",
        toolName: "write",
        content: [{ type: "text", text: "Wrote 9 bytes to todo.txt" }],
        isError: false,
        timestamp: ms(3),
      },
    }),
  ];
  const fork = prev;
  // An abandoned branch: the user navigated back and continued from `fork`.
  lines.push(assistant("60718293", 4, [{ type: "text", text: "Abandoned reply." }], "stop"));
  prev = fork;
  lines.push(
    assistant("718293a4", 5, [
      {
        type: "toolCall",
        id: "toolu_fixtureEdit",
        name: "edit",
        arguments: { path: "todo.txt", edits: [{ oldText: "[ ] ship", newText: "[x] ship" }] },
      },
    ]),
    entry("8293a4b5", 6, {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "toolu_fixtureEdit",
        toolName: "edit",
        content: [{ type: "text", text: "Successfully replaced 1 block(s) in todo.txt." }],
        details: {
          diff: "-1 [ ] ship\n+1 [x] ship",
          patch: "--- todo.txt\n+++ todo.txt\n@@ -1,1 +1,1 @@\n-[ ] ship\n+[x] ship\n",
          firstChangedLine: 1,
        },
        isError: false,
        timestamp: ms(6),
      },
    }),
    assistant("93a4b5c6", 7, [
      {
        type: "toolCall",
        id: "toolu_fixtureRead",
        name: "read",
        arguments: { path: "missing.txt" },
      },
    ]),
    entry("a4b5c6d7", 8, {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "toolu_fixtureRead",
        toolName: "read",
        content: [{ type: "text", text: "ENOENT: no such file or directory" }],
        isError: true,
        timestamp: ms(8),
      },
    }),
    assistant("b5c6d7e8", 9, [{ type: "text", text: "todo.txt is updated." }], "stop"),
  );
  write("pi/session.jsonl", lines);
}

console.log(`wrote fixtures to ${out}`);
