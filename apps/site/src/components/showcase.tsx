"use client";

import { Trace, TraceCompare, type TraceRecord } from "@tetraslam/kiseki";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Dropped, readTraceFile } from "@/lib/read-file";
import { DropField } from "./drop-field";

export interface Demo {
  id: string;
  label: string;
  /** Inlined into the page so the first paint is the real trace. */
  record?: TraceRecord;
  /** Fetched on hover or focus of the tab, before the click. */
  src?: string;
  /** A line under the frame saying what the trace is. */
  note?: string;
}

const subagents: Record<string, string> = { child: "/fixtures/subagent-child.json" };

async function fetchRecord(src: string): Promise<TraceRecord> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`${response.status} for ${src}`);
  return response.json();
}

const cache = new Map<string, Promise<TraceRecord>>();
const warm = (src: string) => {
  let pending = cache.get(src);
  if (!pending) {
    pending = fetchRecord(src);
    cache.set(src, pending);
  }
  return pending;
};

export function Showcase({
  demos,
  compare,
  caption,
}: {
  demos: Demo[];
  compare: [TraceRecord, TraceRecord];
  caption: string;
}) {
  const [tab, setTab] = useState(demos[0]?.id ?? "");
  const [records, setRecords] = useState<Record<string, TraceRecord>>(() =>
    Object.fromEntries(demos.flatMap((d) => (d.record ? [[d.id, d.record]] : []))),
  );
  const [dropped, setDropped] = useState<Dropped | null>(null);

  const open = useCallback(
    (id: string) => {
      setTab(id);
      const demo = demos.find((d) => d.id === id);
      if (demo?.src && !records[id]) {
        warm(demo.src).then(
          (record) => setRecords((prev) => ({ ...prev, [id]: record })),
          () => toast.error("couldn't load that trace"),
        );
      }
    },
    [demos, records],
  );

  const onFile = useCallback(async (file: File) => {
    const id = toast.loading(`reading ${file.name}`);
    try {
      const result = await readTraceFile(file);
      setDropped(result);
      setTab("file");
      toast.success(
        `${result.format}: ${result.records[0]?.steps?.length ?? 0} steps${
          result.issues.length ? `, ${result.issues.length} issues` : ""
        }`,
        { id },
      );
    } catch (error) {
      toast.error((error as Error).message, { id });
    }
  }, []);

  const current = tab === "file" ? dropped?.records[0] : records[tab];

  return (
    <DropField onFile={onFile}>
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <Tabs value={tab} onValueChange={(value) => open(String(value))}>
          <TabsList>
            {demos.map((demo) => (
              <TabsTrigger
                key={demo.id}
                value={demo.id}
                onPointerEnter={() => demo.src && void warm(demo.src)}
                onFocus={() => demo.src && void warm(demo.src)}
              >
                {demo.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="compare">compare</TabsTrigger>
            {dropped && <TabsTrigger value="file">{dropped.name}</TabsTrigger>}
          </TabsList>
        </Tabs>
      </div>
      <div className="crop">
        <div className="h-[min(680px,78dvh)] overflow-hidden rounded-lg shadow-[0_1px_0_var(--line),0_12px_40px_-12px_rgb(0_0_0/0.18)] ring-1 ring-line">
          {tab === "compare" ? (
            <TraceCompare a={compare[0]} b={compare[1]} />
          ) : tab === "live" ? (
            <LiveReplay source={records.live} />
          ) : current ? (
            <Trace
              key={tab === "file" ? `file:${dropped?.name}` : tab}
              record={current}
              loadTrace={(ref) => {
                const src = subagents[ref];
                return src ? warm(src) : Promise.reject(new Error(`no trace for ${ref}`));
              }}
            />
          ) : (
            <div className="kiseki h-full" />
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-3">
        {tab === "agent"
          ? caption
          : tab === "compare"
            ? "two runs of one search task, aligned by step signature. tinted rows are steps only one run took."
            : tab === "file"
              ? `${dropped?.format} file, read in your browser.`
              : (demos.find((d) => d.id === tab)?.note ?? "")}
      </p>
    </DropField>
  );
}

/** Replays a finished trace step by step, the way a host passes a growing record. */
function LiveReplay({ source }: { source?: TraceRecord }) {
  const [count, setCount] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const total = source?.steps?.length ?? 0;
  useEffect(() => {
    if (!source || count >= total) return;
    const next = source.steps?.[count];
    // Pace by the step's own size, so tool-heavy steps feel like work.
    const delay = 350 + Math.min(900, (next?.tool_calls?.length ?? 0) * 260);
    timer.current = setTimeout(() => setCount((c) => c + 1), delay);
    return () => clearTimeout(timer.current);
  }, [source, count, total]);
  if (!source) return <div className="kiseki h-full" />;
  const steps = source.steps?.slice(0, count) ?? [];
  // The newest step's calls are still running: drop its observations.
  const growing = steps.map((step, i) =>
    i === steps.length - 1 && count < total ? { ...step, observations: [] } : step,
  );
  const running = count < total;
  const record = running
    ? {
        ...source,
        steps: growing,
        outcome: undefined,
        timestamp_end: undefined,
        metrics: undefined,
      }
    : source;
  return <Trace record={record} live={running} />;
}
