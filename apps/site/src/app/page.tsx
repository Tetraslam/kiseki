import Link from "next/link";
import { Code } from "@/components/code";
import { CopyCommand } from "@/components/copy-command";
import { Showcase } from "@/components/showcase";
import { SiteBar } from "@/components/site-bar";
import { fixture } from "@/lib/fixtures";
import { hero } from "@/lib/hero";
import perf from "../../../../docs/perf-results.json";

const usage = `
import { Trace } from "@tetraslam/kiseki";
import "@tetraslam/kiseki/styles.css";

<Trace
  record={record}
  renderers={{ tools: { searchProfiles: PeopleCards } }}
  loadPayload={(step, callId) => fetchOutput(step, callId)}
/>
`;

export default async function Home() {
  const [main, parc, errors, subagent, compareA, compareB] = await Promise.all([
    fixture(hero.file),
    fixture("parc-search.json"),
    fixture("errors.json"),
    fixture("subagent-parent.json"),
    fixture("compare-a.json"),
    fixture("compare-b.json"),
  ]);
  const demos = [
    { id: "agent", label: hero.label, record: main },
    {
      id: "parc",
      label: "search agent",
      record: parc,
      note: "a real parc search trace. parc stores summaries, not payloads, so outputs stay private.",
    },
    {
      id: "errors",
      label: "failures",
      record: errors,
      note: "failed calls, a call that never returned, and a result for a call nobody made.",
    },
    {
      id: "subagent",
      label: "subagent",
      record: subagent,
      note: "a subagent stored as its own trace. unfolding the branch calls loadTrace.",
    },
    {
      id: "live",
      label: "live",
      src: "/fixtures/synthetic-300.json",
      note: "a generated 300-step session replayed as a growing record. scroll up and it stops following.",
    },
  ];
  return (
    <div className="grain min-h-dvh">
      <SiteBar />
      <main className="mx-auto w-full max-w-[1120px] px-6 pb-24">
        <section className="pb-10 pt-14 sm:pt-20">
          <h1 className="font-display text-[clamp(72px,13vw,148px)] font-extrabold leading-[0.9] tracking-[-0.02em]">
            軌跡
          </h1>
          <p className="mt-6 max-w-[34ch] text-[clamp(22px,2.6vw,30px)] font-medium leading-[1.2] tracking-[-0.015em]">
            kiseki renders agent traces.{" "}
            <span className="text-ink-3">
              turns, reasoning, tool calls, subagents, and edits, live or after the fact.
            </span>
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CopyCommand command="pnpm add @tetraslam/kiseki" />
            <Link
              href="/docs"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity duration-140 hover:opacity-90"
            >
              read the docs
            </Link>
            <Link
              href="/llms.txt"
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-ink-2 ring-1 ring-line transition-colors duration-140 hover:bg-muted"
            >
              for agents
            </Link>
          </div>
        </section>

        <Showcase demos={demos} compare={[compareA, compareB]} caption={hero.caption} />

        <section className="mt-24 grid gap-x-10 gap-y-12 md:grid-cols-3">
          <Point n="1" title="one data model">
            kiseki reads{" "}
            <a
              className="underline decoration-line underline-offset-2 hover:decoration-current"
              href="https://www.opentraces.ai/schema/latest"
            >
              OpenTraces 0.9
            </a>
            . ai sdk steps, claude code, opencode, codex, and pi sessions come in through adapters
            that produce the same record.
          </Point>
          <Point n="2" title="your app owns the job">
            kiseki renders agent semantics. you bring renderers per tool name, storage, and auth, so
            a search product shows people cards and an rl harness leads with reward.
          </Point>
          <Point n="3" title="10,000 steps, nothing moves">
            the timeline is virtualized and measured. in the perf run, a{" "}
            {perf.steps.toLocaleString()}-step trace paints its first rows{" "}
            {Math.round(perf.firstRowsMedianMs)}ms after the record arrives, with a layout shift of{" "}
            {perf.cls.toFixed(3)}.
          </Point>
        </section>

        <section className="mt-20 grid items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="max-w-[44ch]">
            <h2 className="text-lg font-semibold tracking-tight">one component</h2>
            <p className="mt-3 leading-relaxed text-ink-2">
              pass a record. selection, expansion, and search are controllable props, so a permalink
              can live in your url. heavy tool output loads only when someone opens the call.
            </p>
            <p className="mt-3 leading-relaxed text-ink-2">
              press <Kbd>j</Kbd> <Kbd>k</Kbd> to move, <Kbd>enter</Kbd> to open, <Kbd>[</Kbd>{" "}
              <Kbd>]</Kbd> to fold subagents, <Kbd>/</Kbd> to search, and <Kbd>c</Kbd> to copy a
              link to the step.
            </p>
          </div>
          <Code code={usage} />
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap gap-x-6 gap-y-2 px-6 pb-10 text-xs text-ink-3">
        <span>mit</span>
        <a href="https://github.com/tetraslam/kiseki" className="hover:text-foreground">
          github.com/tetraslam/kiseki
        </a>
        <span>made by tetraslam, in the spirit of diffs.com</span>
      </footer>
    </div>
  );
}

function Point({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-ink-3">{n}</span>
        <h2 className="font-semibold tracking-tight">{title}</h2>
      </div>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded px-1 font-mono text-[11px] text-ink-2 ring-1 ring-line">
      {children}
    </kbd>
  );
}
