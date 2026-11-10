"use client";

import { Trace, TraceCompare, TraceList, type TraceRecord } from "@tetraslam/kiseki";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { type Dropped, readTraceFile } from "@/lib/read-file";
import { packageRenderers } from "@/lib/renderers";
import { Composer } from "./composer";
import { DropField, OpenFile } from "./drop-field";
import { researchRenderers } from "./research";
import { useStreamed } from "./stream";

export type Demo =
  | { id: string; label: string; kind: "chat"; record: TraceRecord }
  | { id: string; label: string; kind: "coding"; record: TraceRecord }
  | { id: string; label: string; kind: "runs"; records: TraceRecord[]; now: number }
  | { id: string; label: string; kind: "evals"; a: TraceRecord; b: TraceRecord }
  | { id: string; label: string; kind: "custom"; record: TraceRecord };

/** The first screen: the dyed panel with the demo picker, and kiseki inside a host interface. */
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
      toast.success(`${result.format}, ${result.records[0]?.steps?.length ?? 0} steps`, { id });
    } catch (error) {
      toast.error((error as Error).message, { id });
    }
  }, []);

  const demo = demos.find((d) => d.id === tab);
  return (
    <DropField onFile={onFile}>
      <div className="grid min-h-dvh gap-3 p-3 lg:h-dvh lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <aside className="aizome relative flex flex-col overflow-hidden rounded-[14px] p-7 text-white">
          {intro}
          <nav className="mt-9 grid gap-0.5" aria-label="demos">
            {demos.map((d) => (
              <DemoButton
                key={d.id}
                active={tab === d.id}
                onClick={() => setTab(d.id)}
                label={d.label}
              />
            ))}
            {dropped && (
              <DemoButton
                active={tab === "file"}
                onClick={() => setTab("file")}
                label={dropped.name}
              />
            )}
          </nav>
          <p className="mt-3 px-3 text-[13px] text-white/60">
            <OpenFile onFile={onFile}>open a trace</OpenFile>
          </p>
          <div className="mt-auto pt-8">{footer}</div>
        </aside>
        <section
          className="flex h-[82dvh] min-h-0 flex-col overflow-hidden rounded-[14px] ring-1 ring-line lg:h-auto"
          aria-label="trace"
        >
          {tab === "file" && dropped?.records[0] ? (
            <Trace key={`file:${dropped.name}`} record={dropped.records[0]} />
          ) : demo?.kind === "chat" ? (
            <Chat key={demo.id} record={demo.record} />
          ) : demo?.kind === "coding" ? (
            <>
              <div className="min-h-0 flex-1">
                <Trace key={demo.id} record={demo.record} />
              </div>
              <Composer placeholder="ask a follow-up" />
            </>
          ) : demo?.kind === "runs" ? (
            <Runs key={demo.id} records={demo.records} now={demo.now} />
          ) : demo?.kind === "evals" ? (
            <TraceCompare key={demo.id} a={demo.a} b={demo.b} />
          ) : demo?.kind === "custom" ? (
            <Custom key={demo.id} record={demo.record} />
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="rounded-[8px] px-3 py-1.5 text-left transition-colors duration-[90ms] ease-track hover:bg-white/[0.07] aria-pressed:bg-white/[0.12]"
    >
      <span className="text-[14px] font-medium">{label}</span>
    </button>
  );
}

/** A chat app: the run streams in as the agent works. Send runs it again. */
function Chat({ record }: { record: TraceRecord }) {
  const [playing, setPlaying] = useState(true);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const onDone = useCallback(() => setDone(true), []);
  const streamed = useStreamed(record, playing, onDone);
  const prompt = record.steps?.find((s) => s.role === "user")?.content ?? "";
  return (
    <>
      <div className="min-h-0 flex-1">
        <Trace
          key={run}
          record={streamed.record}
          live={streamed.live}
          renderers={packageRenderers}
          overview={false}
        />
      </div>
      <Composer
        prompt={done ? prompt : ""}
        running={streamed.live}
        onStop={() => {
          setPlaying(false);
          setDone(true);
        }}
        onSend={() => {
          setDone(false);
          setPlaying(false);
          setRun((r) => r + 1);
          requestAnimationFrame(() => setPlaying(true));
        }}
      />
    </>
  );
}

/** A run inbox: every run with its outcome and signals; open one to read it. */
function Runs({ records, now }: { records: TraceRecord[]; now: number }) {
  const [selected, setSelected] = useState(records[0]?.trace_id ?? null);
  const record = records.find((r) => r.trace_id === selected);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r border-line">
        <div className="flex h-[45px] flex-none items-center gap-2 border-b border-line px-4 text-[13px]">
          <span className="font-medium">runs</span>
          <span className="font-mono text-[11px] text-ink-3">{records.length}</span>
        </div>
        <TraceList
          records={records}
          selected={selected}
          onSelect={setSelected}
          now={now}
          className="min-h-0 flex-1"
        />
      </div>
      <div className="min-h-0">{record && <Trace key={record.trace_id} record={record} />}</div>
    </div>
  );
}

function Custom({ record }: { record: TraceRecord }) {
  const renderers = useMemo(() => researchRenderers(record), [record]);
  return (
    <div className="min-h-0 flex-1">
      <Trace record={record} renderers={renderers} />
    </div>
  );
}
