import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  layoutOverview,
  normalize,
  overviewLaneCount,
  parseTraces,
  segmentAt,
  type TraceRecord,
} from "../src";

const load = (name: string) =>
  parseTraces(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"))
    .records[0] as TraceRecord;

describe("overview", () => {
  it("puts three parallel subagents on three lanes", () => {
    const view = normalize(load("opencode-ledger-review.json"));
    const overview = layoutOverview(view);
    expect(overview.scale).toBe("time");
    expect(overview.lanes.length).toBe(4);
    expect(overview.lanes.slice(1).every((lane) => lane.depth === 1)).toBe(true);
  });

  it("marks the launching step as waiting while its subagents run", () => {
    const view = normalize(load("opencode-tally.json"));
    const overview = layoutOverview(view);
    const head = view.steps.find((s) => s.children.length);
    const segment = overview.segments.find((s) => s.key === head?.key);
    expect(segment?.wait).toBeDefined();
    const children = overview.segments.filter((s) => s.lane === 1);
    expect(segment?.wait?.end).toBeCloseTo(Math.max(...children.map((c) => c.end)), -1);
  });

  it("shares a lane between subagent runs that don't overlap", () => {
    const view = normalize(load("synthetic-300.json"));
    const overview = layoutOverview(view);
    expect(view.steps.filter((s) => s.children.length).length).toBeGreaterThan(2);
    expect(overview.lanes.length).toBe(2);
  });

  it("falls back to step order without timestamps", () => {
    const record = load("errors.json");
    record.steps = record.steps?.map(({ timestamp: _, ...s }) => s);
    const overview = layoutOverview(normalize(record));
    expect(overview.scale).toBe("steps");
    expect(overview.segments.map((s) => s.start)).toEqual([0, 1, 2, 3]);
  });

  it("marks errors and finds segments by position", () => {
    const overview = layoutOverview(normalize(load("errors.json")));
    expect(overview.segments.filter((s) => s.error).map((s) => s.key)).toEqual(["1", "2"]);
    const second = overview.segments[2];
    expect(segmentAt(overview, ((second?.start ?? 0) + (second?.end ?? 0)) / 2)?.key).toBe("2");
  });

  it("predicts the lane count without a full layout, for every fixture", () => {
    for (const name of [
      "opencode-ledger-review.json",
      "opencode-tally.json",
      "synthetic-300.json",
      "errors.json",
      "ai-sdk-package-scout.json",
      "subagent-parent.json",
    ]) {
      const view = normalize(load(name));
      for (const scale of ["auto", "time", "steps"] as const) {
        expect(overviewLaneCount(view, { scale }), `${name} ${scale}`).toBe(
          layoutOverview(view, { scale }).lanes.length,
        );
      }
    }
  });

  it("lays out 10,000 steps quickly", () => {
    const record = load("synthetic-300.json");
    const steps = record.steps ?? [];
    const many = Array.from({ length: 34 }, (_, k) =>
      steps.map((s) => ({
        ...s,
        step_index: s.step_index + k * 300,
        parent_step: s.parent_step != null ? s.parent_step + k * 300 : undefined,
      })),
    ).flat();
    const view = normalize({ ...record, steps: many, patches: [] });
    const start = performance.now();
    layoutOverview(view);
    expect(performance.now() - start).toBeLessThan(150);
  });
});
