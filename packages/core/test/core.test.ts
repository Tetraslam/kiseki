import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  align,
  branchTree,
  firstDivergence,
  normalize,
  parseTraces,
  resolveGenerations,
  searchSteps,
  sideBySide,
  type TraceRecord,
  visibleRows,
} from "../src";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");
const load = (name: string) => {
  const { records, issues } = parseTraces(fixture(name));
  expect(issues).toEqual([]);
  return records[0] as TraceRecord;
};

describe("parse", () => {
  it("reads a real parc search export", () => {
    const record = load("parc-search.json");
    expect(record.agent.name).toBe("parc-search");
    expect(record.steps).toHaveLength(6);
  });

  it("reads jsonl and reports bad lines without dropping good ones", () => {
    const good = fixture("errors.json").replace(/\n\s*/g, "");
    const { records, issues } = parseTraces(`${good}\n{not json}\n${good}\n`);
    expect(records).toHaveLength(2);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("line 2");
  });

  it("drops invalid steps and keeps the rest", () => {
    const record = JSON.parse(fixture("errors.json"));
    record.steps[1].role = "robot";
    const { records, issues } = parseTraces(JSON.stringify(record));
    expect(records[0]?.steps).toHaveLength(3);
    expect(issues[0]?.path).toBe("steps.1.role");
  });

  it("flags a record from another schema version", () => {
    const record = JSON.parse(fixture("errors.json"));
    record.schema_version = "0.7.0";
    expect(parseTraces(JSON.stringify(record)).issues[0]?.path).toBe("schema_version");
  });
});

describe("generations", () => {
  it("keeps the latest generation of each session in first-seen order", () => {
    const base = load("errors.json");
    const records = [
      { ...base, session_id: "s1", generation_index: 0, trace_id: "a" },
      { ...base, session_id: "s2", trace_id: "b" },
      { ...base, session_id: "s1", generation_index: 2, trace_id: "c" },
      { ...base, session_id: "s1", generation_index: 1, trace_id: "d" },
    ];
    expect(resolveGenerations(records).map((r) => r.trace_id)).toEqual(["c", "b"]);
  });
});

describe("pairing", () => {
  it("pairs calls with observations and marks errors, missing, and stray results", () => {
    const view = normalize(load("errors.json"));
    const step1 = view.byIndex.get(1);
    expect(step1?.calls[0]?.status).toBe("error");
    const step2 = view.byIndex.get(2);
    expect(step2?.calls.map((c) => c.status)).toEqual(["missing", "error"]);
    expect(step2?.strayObservations.map((o) => o.source_call_id)).toEqual(["c9"]);
    expect(view.totals.errors).toBe(2);
  });

  it("treats unanswered calls as pending while live", () => {
    const view = normalize(load("errors.json"), { live: true });
    expect(view.byIndex.get(2)?.calls[0]?.status).toBe("pending");
  });

  it("attaches patches to their step and call", () => {
    const view = normalize(load("synthetic-300.json"));
    const patch = view.record.patches?.[0];
    expect(patch).toBeDefined();
    const step = view.byIndex.get(patch?.step_index as number);
    expect(step?.patches).toContain(patch);
    expect(step?.calls.find((c) => c.call.tool_call_id === patch?.tool_call_id)?.patches).toContain(
      patch,
    );
  });

  it("computes totals when metrics are absent", () => {
    const view = normalize(load("parc-search.json"));
    expect(view.totals.steps).toBe(6);
    expect(view.totals.inputTokens).toBeGreaterThan(0);
    expect(view.totals.toolCalls).toBeGreaterThan(0);
  });

  it("doesn't end a live trace's last step at timestamp_end", () => {
    const view = normalize(load("errors.json"), { live: true });
    expect(view.byIndex.get(3)?.durationMs).toBeUndefined();
  });

  it("computes step durations from timestamps", () => {
    const view = normalize(load("errors.json"));
    expect(view.byIndex.get(1)?.durationMs).toBe(33_000);
    expect(view.byIndex.get(3)?.durationMs).toBe(2_000);
  });
});

describe("tree", () => {
  const view = normalize(load("synthetic-300.json"));
  const head = view.steps.find((s) => s.children.length > 0);

  it("builds branches from parent_step", () => {
    expect(head).toBeDefined();
    for (const index of head?.children ?? []) {
      const child = view.byIndex.get(index);
      expect(child?.step.call_type).toBe("subagent");
      expect(child?.depth).toBe(1);
    }
  });

  it("folds branches by default and unfolds them on request", () => {
    const folded = visibleRows(view, { unfolded: new Set() });
    expect(folded.every((row) => row.depth === 0)).toBe(true);
    const open = visibleRows(view, { unfolded: new Set([head?.key as string]) });
    expect(open.length).toBe(folded.length + (head?.children.length ?? 0));
    const at = open.findIndex((row) => row.view === head);
    expect(open[at + 1]?.view.index).toBe(head?.children[0]);
  });

  it("ignores a parent that comes later, so cycles cannot form", () => {
    const record = load("errors.json");
    record.steps = record.steps?.map((s) => (s.step_index === 1 ? { ...s, parent_step: 2 } : s));
    const v = normalize(record);
    expect(v.roots).toContain(1);
  });

  it("nests a loaded subagent trace under its reference", () => {
    const parent = normalize(load("subagent-parent.json"));
    const child = normalize(load("subagent-child.json"), { keyPrefix: "child/" });
    const loaded = new Map([["child", child]]);
    const rows = visibleRows(parent, { unfolded: new Set(["1"]), loaded });
    expect(rows.map((r) => r.view.key)).toEqual(["0", "1", "child/0", "child/1", "2"]);
    expect(rows[2]?.depth).toBe(1);
    expect(branchTree(parent, loaded)[0]?.size).toBe(2);
  });
});

describe("search", () => {
  it("matches content, tool names, inputs, and summaries", () => {
    const view = normalize(load("errors.json"));
    expect(searchSteps(view.steps, "smokeTest").map((s) => s.index)).toEqual([2]);
    expect(searchSteps(view.steps, "vercel deploy").map((s) => s.index)).toEqual([1]);
    expect(searchSteps(view.steps, "ECONNREFUSED").map((s) => s.index)).toEqual([2]);
    expect(searchSteps(view.steps, "")).toEqual([]);
  });
});

describe("align", () => {
  it("aligns identical runs one to one", () => {
    const pairs = align(["a", "b", "c"], ["a", "b", "c"]);
    expect(pairs).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 1 },
      { a: 2, b: 2 },
    ]);
    expect(firstDivergence(pairs)).toBe(-1);
  });

  it("finds a longest common subsequence", () => {
    const a = ["u", "s", "x", "e", "p", "f"];
    const b = ["u", "s", "y", "y", "e", "p", "f"];
    const pairs = align(a, b);
    const matched = pairs.filter((p) => p.a != null && p.b != null);
    expect(matched.length).toBe(5);
    for (const p of matched) expect(a[p.a as number]).toBe(b[p.b as number]);
    // Every element appears exactly once, in order.
    expect(pairs.flatMap((p) => (p.a != null ? [p.a] : []))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pairs.flatMap((p) => (p.b != null ? [p.b] : []))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(firstDivergence(pairs)).toBe(2);
  });

  it("aligns the compare fixtures around their divergent middle", () => {
    const a = normalize(load("compare-a.json"));
    const b = normalize(load("compare-b.json"));
    const pairs = align(
      a.steps.map((s) => s.signature),
      b.steps.map((s) => s.signature),
    );
    expect(pairs[0]).toEqual({ a: 0, b: 0 });
    expect(pairs.at(-1)).toEqual({ a: a.steps.length - 1, b: b.steps.length - 1 });
    expect(firstDivergence(pairs)).toBeGreaterThan(0);
  });

  it("handles random inputs against a brute-force lcs length", () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let trial = 0; trial < 200; trial++) {
      const a = Array.from(
        { length: Math.floor(rand() * 12) },
        () => "abc"[Math.floor(rand() * 3)] as string,
      );
      const b = Array.from(
        { length: Math.floor(rand() * 12) },
        () => "abc"[Math.floor(rand() * 3)] as string,
      );
      const matched = align(a, b).filter((p) => p.a != null && p.b != null).length;
      expect(matched).toBe(lcs(a, b));
    }
  });

  it("pairs replaced blocks side by side", () => {
    const pairs = sideBySide(align(["u", "x", "y", "e"], ["u", "z", "e"]));
    expect(pairs).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 1, changed: true },
      { a: 2 },
      { a: 3, b: 2 },
    ]);
    expect(firstDivergence(pairs)).toBe(1);
  });

  it("aligns 10,000-step runs quickly", () => {
    const a = Array.from({ length: 10_000 }, (_, i) => `s${i % 7}`);
    const b = [...a];
    b.splice(5000, 50, ...Array.from({ length: 80 }, () => "other"));
    const start = performance.now();
    const pairs = align(a, b);
    expect(performance.now() - start).toBeLessThan(500);
    expect(pairs.filter((p) => p.a != null && p.b != null).length).toBe(9950);
  });
});

function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (dp[i] as number[])[j] =
        a[i - 1] === b[j - 1]
          ? (dp[i - 1]?.[j - 1] as number) + 1
          : Math.max(dp[i - 1]?.[j] as number, dp[i]?.[j - 1] as number);
  return dp[a.length]?.[b.length] as number;
}
