"use client";

import { Trace, TraceCompare, type TraceRecord } from "@tetraslam/kiseki";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Dropped, readTraceFile } from "@/lib/read-file";
import { packageRenderers } from "@/lib/renderers";
import { DropField, OpenFile } from "./drop-field";

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
 * The first screen: the dyed panel (name, line, the demo picker) and the trace in a window
 * beside it, the way it sits inside a chat or a tool. Nothing on this screen scrolls the page.
 */
export function Showcase({
  demos,
  intro,
  footer,
}: {
  demos: Demo[];
  intro: ReactNode;
  footer: ReactNode;
}) {
  const [tab, setTab] = useState(demos[0]?.id ?? "");
  const [dropped, setDropped] = useState<Dropped | null>(null);

  const onFile = useCallback(async (file: File) => {
    const id = toast.loading(`reading ${file.name}`);
    try {
      const result = await readTraceFile(file);
      setDropped(result);
      setTab("file");
      toast.success(
        `${result.format}: ${result.records[0]?.steps?.length ?? 0} steps${result.issues.length ? `, ${result.issues.length} issues` : ""}`,
        { id },
      );
    } catch (error) {
      toast.error((error as Error).message, { id });
    }
  }, []);

  const demo = demos.find((d) => d.id === tab);
  return (
    <DropField onFile={onFile}>
      <div className="grid min-h-dvh gap-3 p-3 lg:h-dvh lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        <aside className="aizome relative flex flex-col overflow-hidden rounded-[14px] p-7 text-white">
          {intro}
          <nav className="mt-8 grid gap-0.5" aria-label="demos">
            <span className="mb-1.5 text-[11px] tracking-[0.08em] text-white/50">real runs</span>
            {demos.map((d) => (
              <DemoButton
                key={d.id}
                active={tab === d.id}
                onClick={() => setTab(d.id)}
                label={d.label}
                note={d.note}
              />
            ))}
            {dropped && (
              <DemoButton
                active={tab === "file"}
                onClick={() => setTab("file")}
                label={dropped.name}
                note={`${dropped.format}, read in your browser`}
              />
            )}
          </nav>
          <p className="mt-5 text-[12.5px] leading-relaxed text-white/60">
            or drop your own: opentraces, claude code, opencode, codex, pi.{" "}
            <OpenFile onFile={onFile}>open a file</OpenFile>. nothing leaves your browser.
          </p>
          <div className="mt-auto pt-8">{footer}</div>
        </aside>
        <section
          className="h-[78dvh] min-h-0 overflow-hidden rounded-[14px] ring-1 ring-line lg:h-auto"
          aria-label="trace"
        >
          {tab === "file" && dropped?.records[0] ? (
            <Trace key={`file:${dropped.name}`} record={dropped.records[0]} />
          ) : demo?.compare ? (
            <TraceCompare a={demo.compare[0]} b={demo.compare[1]} />
          ) : demo?.live && demo.record ? (
            <LiveReplay source={demo.record} />
          ) : demo?.record ? (
            <Trace
              key={demo.id}
              record={demo.record}
              renderers={demo.custom ? packageRenderers : undefined}
            />
          ) : null}
        </section>
      </div>
    </DropField>
  );
}

function DemoButton({
  active,
  onClick,
  label,
  note,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  note: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="group grid gap-0.5 rounded-[8px] px-3 py-2 text-left transition-colors duration-[90ms] ease-track hover:bg-white/[0.07] aria-pressed:bg-white/[0.12]"
    >
      <span className="flex items-center gap-2 text-[14px] font-medium">
        <span className="size-1.5 rounded-full bg-white/25 transition-colors group-aria-pressed:bg-white" />
        {label}
      </span>
      <span className="line-clamp-2 pl-3.5 text-[12px] leading-snug text-white/55 group-aria-pressed:text-white/75">
        {note}
      </span>
    </button>
  );
}

/** Replays a recorded run at its own pace, the way a host passes a growing record. */
function LiveReplay({ source }: { source: TraceRecord }) {
  const [count, setCount] = useState(1);
  const [run, setRun] = useState(0);
  const total = source.steps?.length ?? 0;
  useEffect(() => {
    if (count >= total) {
      // Pause on the finished run, then play it again.
      const again = setTimeout(() => {
        setCount(1);
        setRun((r) => r + 1);
      }, 6000);
      return () => clearTimeout(again);
    }
    const step = source.steps?.[count - 1];
    const next = source.steps?.[count];
    const gap =
      step?.timestamp && next?.timestamp
        ? Date.parse(next.timestamp) - Date.parse(step.timestamp)
        : 800;
    const timer = setTimeout(() => setCount((c) => c + 1), Math.min(1600, Math.max(250, gap)));
    return () => clearTimeout(timer);
  }, [source, count, total]);
  const running = count < total;
  const steps = (source.steps ?? []).slice(0, count);
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
  return <Trace key={run} record={record} live={running} />;
}
