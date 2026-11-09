"use client";

import { Trace, TraceCompare, type TraceRecord } from "@tetraslam/kiseki";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Dropped, readTraceFile } from "@/lib/read-file";
import { packageRenderers } from "@/lib/renderers";
import { DropField } from "./drop-field";

export interface Demo {
  id: string;
  label: string;
  /** What to look at, in one line. */
  note: string;
  record?: TraceRecord;
  compare?: [TraceRecord, TraceRecord];
  custom?: boolean;
  live?: boolean;
}

/**
 * The demos, each a real recorded run. The trace scrolls with the page; its trajectory and
 * search stay pinned while you read.
 */
export function Showcase({ demos }: { demos: Demo[] }) {
  const [tab, setTab] = useState(demos[0]?.id ?? "");
  const [dropped, setDropped] = useState<Dropped | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const onFile = useCallback(async (file: File) => {
    const id = toast.loading(`reading ${file.name}`);
    try {
      const result = await readTraceFile(file);
      setDropped(result);
      setTab("file");
      top.current?.scrollIntoView({ block: "start" });
      toast.success(
        `${result.format}: ${result.records[0]?.steps?.length ?? 0} steps${result.issues.length ? `, ${result.issues.length} issues` : ""}`,
        { id },
      );
    } catch (error) {
      toast.error((error as Error).message, { id });
    }
  }, []);

  const demo = demos.find((d) => d.id === tab);
  const note = tab === "file" ? `${dropped?.format} file, read in your browser.` : demo?.note;
  return (
    <DropField onFile={onFile}>
      <div ref={top} className="scroll-mt-4">
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList className="flex-wrap">
            {demos.map((d) => (
              <TabsTrigger key={d.id} value={d.id}>
                {d.label}
              </TabsTrigger>
            ))}
            {dropped && <TabsTrigger value="file">{dropped.name}</TabsTrigger>}
          </TabsList>
        </Tabs>
        <p className="mt-2 mb-3 max-w-[80ch] text-[13px] text-ink-3">{note}</p>
      </div>
      <div className="overflow-clip rounded-[10px] ring-1 ring-line">
        {tab === "file" && dropped?.records[0] ? (
          <Trace key={`file:${dropped.name}`} record={dropped.records[0]} scroll="page" />
        ) : demo?.compare ? (
          <TraceCompare a={demo.compare[0]} b={demo.compare[1]} scroll="page" />
        ) : demo?.live && demo.record ? (
          <LiveReplay source={demo.record} />
        ) : demo?.record ? (
          <Trace
            key={demo.id}
            record={demo.record}
            scroll="page"
            renderers={demo.custom ? packageRenderers : undefined}
          />
        ) : null}
      </div>
    </DropField>
  );
}

/** Replays a recorded run at its own pace, the way a host passes a growing record. */
function LiveReplay({ source }: { source: TraceRecord }) {
  const [count, setCount] = useState(1);
  const [run, setRun] = useState(0);
  const total = source.steps?.length ?? 0;
  useEffect(() => {
    if (count >= total) return;
    const step = source.steps?.[count - 1];
    const next = source.steps?.[count];
    // Real gaps between steps, capped so the replay doesn't stall.
    const gap =
      step?.timestamp && next?.timestamp
        ? Date.parse(next.timestamp) - Date.parse(step.timestamp)
        : 800;
    const timer = setTimeout(() => setCount((c) => c + 1), Math.min(1600, Math.max(250, gap)));
    return () => clearTimeout(timer);
  }, [source, count, total]);
  const running = count < total;
  const steps = (source.steps ?? []).slice(0, count);
  // The newest step's calls are still running: hold back their results.
  const growing = steps.map((step, i) =>
    i === steps.length - 1 && running ? { ...step, observations: [] } : step,
  );
  const record = running
    ? {
        ...source,
        steps: growing,
        outcome: undefined,
        timestamp_end: undefined,
        metrics: undefined,
      }
    : source;
  return (
    <div>
      <Trace key={run} record={record} live={running} scroll="page" />
      {!running && (
        <div className="flex justify-end border-t border-line px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCount(1);
              setRun((r) => r + 1);
            }}
          >
            replay
          </Button>
        </div>
      )}
    </div>
  );
}
