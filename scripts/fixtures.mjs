// Generates the synthetic fixtures. Deterministic: the same seed writes the same bytes.
// Usage: node scripts/fixtures.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "fixtures";
mkdirSync(out, { recursive: true });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const files = [
  "src/parse.ts",
  "src/normalize.ts",
  "src/tree.ts",
  "src/search.ts",
  "src/server/routes.ts",
  "src/ui/timeline.tsx",
  "README.md",
  "package.json",
];
const thoughts = [
  "The failing test points at the pairing logic. I should read normalize before changing anything.",
  "Two observations share a call id here, so the later one must win. Let me check how the map is filled.",
  "The user asked for the smallest change. An early return covers it without touching the tree.",
  "Running the suite again to see whether the timeout was flaky or real.",
  "This grep found three call sites. Only the second one passes a live flag.",
];
const answers = [
  "I found the problem. `pairCalls` keeps the **first** observation for a call id, but retries append a second one.\n\n- read `src/normalize.ts`\n- changed the map to keep the last observation\n- added a test for the retry case",
  "The suite passes now:\n\n```sh\npnpm test\n✓ 48 passed\n```\n\nThe flaky case was a real race, fixed by awaiting the write.",
  "Here's the plan:\n\n1. reproduce with the fixture\n2. bisect the change\n3. fix and add a regression test",
  "Done. The route returns `404` for unknown ids instead of throwing.",
];

function bigOutput(rand, lines) {
  const parts = [];
  for (let i = 0; i < lines; i++) {
    parts.push(
      `${String(i + 1).padStart(5)}  ${files[Math.floor(rand() * files.length)]}: ${"lorem ipsum dolor sit amet ".repeat(1 + Math.floor(rand() * 4))}`,
    );
  }
  return parts.join("\n");
}

/** A long coding-agent session with subagent branches, edits, and heavy payloads. */
function synthetic(count, seed) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const steps = [];
  const patches = [];
  let time = Date.parse("2026-11-01T09:00:00Z");
  let call = 0;
  const tick = (ms) => {
    time += ms;
    return new Date(time).toISOString();
  };
  steps.push({
    step_index: 0,
    role: "system",
    content: "You are a coding agent working in the kiseki repository.",
    timestamp: tick(0),
  });
  while (steps.length < count) {
    const index = steps.length;
    const roll = rand();
    if (roll < 0.04) {
      steps.push({
        step_index: index,
        role: "user",
        content: pick([
          "fix the failing pairing test",
          "now make it faster",
          "can you also add docs?",
          "looks good, ship it",
        ]),
        timestamp: tick(4000 + rand() * 20000),
      });
      continue;
    }
    if (roll < 0.07 && count - steps.length > 40) {
      // A subagent branch: the parent step calls Task, then the branch's steps point back at it.
      const id = `call_${call++}`;
      const parent = index;
      steps.push({
        step_index: parent,
        role: "agent",
        call_type: "main",
        agent_role: "main",
        content: "I'll send an explore agent to map the call sites.",
        model: "anthropic/claude-sonnet-5-5",
        tool_calls: [
          {
            tool_call_id: id,
            tool_name: "Task",
            input: { description: "map call sites of pairCalls", subagent_type: "explore" },
            duration_ms: 0,
          },
        ],
        observations: [
          { source_call_id: id, output_summary: "explore agent finished: 3 call sites" },
        ],
        token_usage: { input_tokens: 12000 + Math.floor(rand() * 8000), output_tokens: 200 },
        timestamp: tick(1500),
      });
      const size = 5 + Math.floor(rand() * 25);
      for (let j = 0; j < size; j++) {
        const sub = `call_${call++}`;
        steps.push({
          step_index: steps.length,
          role: "agent",
          call_type: "subagent",
          agent_role: "explore",
          parent_step: parent,
          model: "anthropic/claude-haiku-5-5",
          reasoning_content: rand() < 0.4 ? pick(thoughts) : undefined,
          tool_calls: [
            {
              tool_call_id: sub,
              tool_name: pick(["Grep", "Read", "Glob"]),
              input: { pattern: "pairCalls", path: pick(files) },
              duration_ms: 20 + Math.floor(rand() * 300),
            },
          ],
          observations: [
            { source_call_id: sub, output_summary: `${1 + Math.floor(rand() * 9)} matches` },
          ],
          token_usage: { input_tokens: 3000 + Math.floor(rand() * 3000), output_tokens: 80 },
          timestamp: tick(400 + rand() * 1500),
        });
      }
      continue;
    }
    const step = {
      step_index: index,
      role: "agent",
      call_type: "main",
      agent_role: "main",
      model: "anthropic/claude-sonnet-5-5",
      token_usage: {
        input_tokens: 20000 + Math.floor(rand() * 40000),
        output_tokens: 100 + Math.floor(rand() * 900),
        cache_read_tokens: 18000,
      },
      timestamp: tick(800 + rand() * 6000),
    };
    if (rand() < 0.5) step.reasoning_content = pick(thoughts);
    if (rand() < 0.3) step.content = pick(answers);
    const calls = rand() < 0.8 ? 1 + Math.floor(rand() * 2) : 0;
    step.tool_calls = [];
    step.observations = [];
    for (let j = 0; j < calls; j++) {
      const id = `call_${call++}`;
      const tool = pick(["Read", "Edit", "Bash", "Grep", "Read", "Bash"]);
      const file = pick(files);
      let input;
      let observation;
      if (tool === "Edit") {
        const n = Math.floor(rand() * 200);
        input = {
          file_path: file,
          old_string: `const limit = ${n};\nreturn pair(calls);`,
          new_string: `const limit = ${n + 1};\nreturn pair(calls, { keep: "last" });`,
        };
        observation = {
          source_call_id: id,
          output_summary: `edited ${file}`,
          content: "The file has been updated.",
        };
        patches.push({
          patch_id: `p_${id}`,
          file_path: file,
          step_index: index,
          tool_call_id: id,
          capture_method: ["hook_posttooluse"],
        });
      } else if (tool === "Bash") {
        const failing = rand() < 0.08;
        input = { command: pick(["pnpm test", "pnpm build", "git status", "rg pairCalls src"]) };
        observation = failing
          ? {
              source_call_id: id,
              output_summary: "exit 1: 2 tests failed",
              error: "Process exited with code 1",
            }
          : {
              source_call_id: id,
              output_summary: "exit 0",
              content: bigOutput(rand, 4 + Math.floor(rand() * 30)),
            };
      } else if (tool === "Read") {
        input = { file_path: file };
        const lines = rand() < 0.05 ? 1500 : 20 + Math.floor(rand() * 120);
        observation = {
          source_call_id: id,
          output_summary: `${lines} lines`,
          content: rand() < 0.5 ? bigOutput(rand, lines) : undefined,
        };
      } else {
        input = { pattern: "pair", path: "src" };
        observation = {
          source_call_id: id,
          output_summary: `${Math.floor(rand() * 20)} matches`,
          content: bigOutput(rand, 6),
        };
      }
      step.tool_calls.push({
        tool_call_id: id,
        tool_name: tool,
        input,
        duration_ms: 10 + Math.floor(rand() * 2000),
      });
      step.observations.push(observation);
    }
    steps.push(step);
  }
  return {
    schema_version: "0.9.0",
    trace_id: `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`,
    session_id: `synthetic-${seed}`,
    timestamp_start: steps[0].timestamp,
    timestamp_end: tick(2000),
    task: {
      description: "fix the failing pairing test, then make it faster",
      repository: "tetraslam/kiseki",
      source: "user_prompt",
    },
    agent: { name: "synthetic-agent", version: "1.0.0", model: "anthropic/claude-sonnet-5-5" },
    execution_context: "devtime",
    steps,
    patches,
    outcome: {
      success: true,
      signal_source: "deterministic",
      signal_confidence: "derived",
      terminal_state: "goal_reached",
      description: "tests pass",
      committed: true,
      commit_sha: "f5e6d7c8",
    },
    metrics: { estimated_cost_usd: Math.round(count * 0.0213 * 100) / 100 },
  };
}

/** Calls that failed, calls that never got a result, and a result with no call. */
function errors() {
  const t = (s) => new Date(Date.parse("2026-11-02T10:00:00Z") + s * 1000).toISOString();
  return {
    schema_version: "0.9.0",
    trace_id: "00000000-0000-4000-8000-0000000e1104",
    session_id: "errors",
    timestamp_start: t(0),
    timestamp_end: t(60),
    task: { description: "deploy the preview and run the smoke test" },
    agent: { name: "synthetic-agent", model: "openai/gpt-6" },
    steps: [
      {
        step_index: 0,
        role: "user",
        content: "deploy the preview and run the smoke test",
        timestamp: t(0),
      },
      {
        step_index: 1,
        role: "agent",
        content: "Deploying first.",
        tool_calls: [
          {
            tool_call_id: "c1",
            tool_name: "Bash",
            input: { command: "vercel deploy" },
            duration_ms: 31000,
          },
        ],
        observations: [
          {
            source_call_id: "c1",
            output_summary: "build failed",
            error:
              "Error: Command \"pnpm build\" exited with 1\n  > Type error: Property 'live' does not exist on type 'Options'.",
            content:
              "Running build in Washington, D.C.\n...\nType error: Property 'live' does not exist on type 'Options'.",
          },
        ],
        token_usage: { input_tokens: 8000, output_tokens: 120 },
        timestamp: t(2),
      },
      {
        step_index: 2,
        role: "agent",
        reasoning_content:
          "The build fails on a type error. I'll fetch the logs and run the smoke test in parallel, but the log fetch might hang.",
        tool_calls: [
          { tool_call_id: "c2", tool_name: "fetchLogs", input: { deployment: "dpl_123" } },
          {
            tool_call_id: "c3",
            tool_name: "smokeTest",
            input: { url: "https://preview.example.com" },
          },
        ],
        observations: [
          { source_call_id: "c3", output_summary: "0 of 4 checks passed", error: "ECONNREFUSED" },
          { source_call_id: "c9", output_summary: "stray result for a call this step never made" },
        ],
        token_usage: { input_tokens: 9000, output_tokens: 300 },
        timestamp: t(35),
      },
      {
        step_index: 3,
        role: "agent",
        content:
          "The deploy failed on a type error in `Options`, and the log fetch never returned. I stopped here.",
        timestamp: t(58),
      },
    ],
    outcome: {
      success: false,
      terminal_state: "error",
      signal_source: "deterministic",
      description: "build failed",
    },
  };
}

/** Two runs of the same task that agree, diverge in the middle, and agree again. */
function comparePair() {
  const base = (id, middle) => {
    const t = (s) => new Date(Date.parse("2026-11-03T12:00:00Z") + s * 1000).toISOString();
    const steps = [
      {
        step_index: 0,
        role: "user",
        content: "find people who have built fpga projects",
        timestamp: t(0),
      },
    ];
    const add = (tools, content) => {
      const index = steps.length;
      steps.push({
        step_index: index,
        role: "agent",
        content,
        tool_calls: tools.map((tool, j) => ({
          tool_call_id: `${id}-${index}-${j}`,
          tool_name: tool,
          input: { query: "fpga" },
        })),
        observations: tools.map((tool, j) => ({
          source_call_id: `${id}-${index}-${j}`,
          output_summary: `${tool} returned ${2 + j} results`,
        })),
        token_usage: { input_tokens: 4000 * index, output_tokens: 150 },
        timestamp: t(index * 3),
      });
    };
    add(["searchPeople"]);
    add(["searchEvidence"]);
    for (const tools of middle) add(tools);
    add(["listProjects"]);
    add([], "Two people have shipped FPGA work: a raytracer and a soft CPU.");
    return {
      schema_version: "0.9.0",
      trace_id: `00000000-0000-4000-8000-00000000c0${id === "a" ? "0a" : "0b"}`,
      session_id: `compare-${id}`,
      task: { description: "find people who have built fpga projects" },
      agent: {
        name: "parc-search",
        model: id === "a" ? "deepseek/deepseek-v4.1-flash" : "anthropic/claude-haiku-5-5",
      },
      steps,
      outcome: {
        success: id === "a",
        signal_source: "interaction",
        signal_confidence: "inferred",
        description: id === "a" ? "clicked" : "rephrased",
      },
    };
  };
  return [
    base("a", [["searchPeople", "listUpdates"], ["searchEvidence"]]),
    base("b", [["searchPeople"], ["searchPeople"], ["fetchProfile"], ["searchEvidence"]]),
  ];
}

/** A parent trace whose subagent lives in its own record, resolved through loadTrace. */
function subagentRef() {
  const t = (s) => new Date(Date.parse("2026-11-04T08:00:00Z") + s * 1000).toISOString();
  const parent = {
    schema_version: "0.9.0",
    trace_id: "00000000-0000-4000-8000-0000000005a1",
    session_id: "parent",
    task: { description: "summarize the open issues" },
    agent: { name: "synthetic-agent", model: "anthropic/claude-sonnet-5-5" },
    timestamp_start: t(0),
    timestamp_end: t(40),
    steps: [
      { step_index: 0, role: "user", content: "summarize the open issues", timestamp: t(0) },
      {
        step_index: 1,
        role: "agent",
        content: "Delegating the triage to a subagent.",
        subagent_trajectory_ref: "child",
        tool_calls: [
          { tool_call_id: "t1", tool_name: "Task", input: { description: "triage issues" } },
        ],
        observations: [{ source_call_id: "t1", output_summary: "12 issues triaged" }],
        timestamp: t(1),
      },
      {
        step_index: 2,
        role: "agent",
        content: "There are **12** open issues; 3 are bugs.",
        timestamp: t(38),
      },
    ],
  };
  const child = {
    schema_version: "0.9.0",
    trace_id: "00000000-0000-4000-8000-0000000005a2",
    session_id: "child",
    agent: { name: "synthetic-agent", model: "anthropic/claude-haiku-5-5" },
    steps: [
      {
        step_index: 0,
        role: "agent",
        agent_role: "triage",
        tool_calls: [{ tool_call_id: "x1", tool_name: "listIssues", input: { state: "open" } }],
        observations: [{ source_call_id: "x1", output_summary: "12 issues" }],
        timestamp: t(2),
      },
      {
        step_index: 1,
        role: "agent",
        agent_role: "triage",
        content: "3 bugs, 7 features, 2 questions.",
        timestamp: t(30),
      },
    ],
  };
  return { parent, child };
}

const write = (name, value) =>
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);
writeFileSync(join(out, "synthetic-10k.jsonl"), `${JSON.stringify(synthetic(10000, 7))}\n`);
write("synthetic-300.json", synthetic(300, 3));
write("errors.json", errors());
const [a, b] = comparePair();
write("compare-a.json", a);
write("compare-b.json", b);
const { parent, child } = subagentRef();
write("subagent-parent.json", parent);
write("subagent-child.json", child);
console.log(`fixtures written to ${out}`);
