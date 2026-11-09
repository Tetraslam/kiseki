"use client";

import {
  parseTraces,
  type Step,
  Trace,
  type TraceHandle,
  type TraceRecord,
} from "@tetraslam/kiseki";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Element Timing entries; not in TypeScript's DOM lib yet. */
interface ElementTiming extends PerformanceEntry {
  identifier: string;
  renderTime: number;
  loadTime: number;
}

declare global {
  interface Window {
    __kiseki?: {
      ready: boolean;
      steps: number;
      held: Step[];
      handle: TraceHandle | null;
      append: (count: number) => number;
    };
  }
}

/**
 * Loads a fixture, marks `kiseki:parsed` once the record is parsed and `kiseki:painted` after the
 * first rows reach the screen. `?live=N` starts with all but the last N steps held back, for the
 * script to append.
 */
export function PerfHarness() {
  const params = useSearchParams();
  const name = params.get("fixture") ?? "synthetic-10k.jsonl";
  const held = Number(params.get("live") ?? 0);
  const overview = params.get("overview") !== "0";
  const [record, setRecord] = useState<TraceRecord | null>(null);
  const handle = useRef<TraceHandle>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(`/fixtures/${name}`);
      if (!response.ok) throw new Error(`${response.status} for ${name}`);
      const text = await response.text();
      performance.mark("kiseki:fetched");
      const parsed = parseTraces(text).records[0];
      if (!parsed || cancelled) return;
      const steps = parsed.steps ?? [];
      const keep = held ? steps.slice(0, steps.length - held) : steps;
      window.__kiseki = {
        ready: false,
        steps: steps.length,
        held: held ? steps.slice(steps.length - held) : [],
        handle: null,
        append: (count) => {
          const state = window.__kiseki;
          if (!state) return 0;
          const next = state.held.splice(0, count);
          state.handle?.append(next);
          return state.held.length;
        },
      };
      performance.mark("kiseki:parsed");
      setRecord({ ...parsed, steps: keep });
    })();
    return () => {
      cancelled = true;
    };
  }, [name, held]);

  useEffect(() => {
    if (window.__kiseki) window.__kiseki.handle = handle.current;
  });

  if (!record) return null;
  return (
    <div style={{ height: "100dvh" }}>
      <Trace
        ref={handle}
        record={record}
        live={held > 0}
        overview={overview}
        onFirstRows={() => {
          performance.mark("kiseki:committed");
          // The browser's own record of when the first row's text was painted.
          new PerformanceObserver((list, observer) => {
            const entry = (list.getEntries() as ElementTiming[]).find(
              (e) => e.identifier === "kiseki-first-row",
            );
            if (!entry) return;
            observer.disconnect();
            performance.mark("kiseki:painted", { startTime: entry.renderTime || entry.loadTime });
            if (window.__kiseki) window.__kiseki.ready = true;
          }).observe({ type: "element", buffered: true });
        }}
      />
    </div>
  );
}
