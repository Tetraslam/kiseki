import Link from "next/link";
import { Code } from "@/components/code";
import { CopyCommand } from "@/components/copy-command";
import { type Demo, Showcase } from "@/components/showcase";
import { SiteBar } from "@/components/site-bar";
import { fixture } from "@/lib/fixtures";
import { demos as list } from "@/lib/hero";
import { packageRendererSource } from "@/lib/snippets";
import perf from "../../../../docs/perf-results.json";

const usage = `import { Trace } from "@tetraslam/kiseki";
import "@tetraslam/kiseki/styles.css";

<Trace record={record} scroll="page" />`;

export default async function Home() {
  const demos: Demo[] = await Promise.all(
    list.map(async (d) => ({
      id: d.id,
      label: d.label,
      note: d.note,
      custom: "custom" in d ? d.custom : undefined,
      live: "live" in d ? d.live : undefined,
      record: "file" in d ? await fixture(d.file) : undefined,
      compare:
        "files" in d
          ? ([await fixture(d.files[0]), await fixture(d.files[1])] as Demo["compare"])
          : undefined,
    })),
  );
  return (
    <div className="min-h-dvh">
      <SiteBar />
      <main className="mx-auto w-full max-w-[1160px] px-5 pb-24">
        <section className="grid gap-6 pb-10 pt-12 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-end md:pt-16">
          <div>
            <h1 className="max-w-[18ch] text-[clamp(32px,4.6vw,50px)] font-semibold leading-[1.05] tracking-[-0.03em]">
              see what your agent actually did.
            </h1>
            <p className="mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-ink-2">
              kiseki is a react component for reading agent runs. it draws the run&apos;s
              trajectory, then the transcript: where the time went, what failed, and what changed,
              with a diff for every edit. embed it in your admin page, eval harness, or local tool.
            </p>
          </div>
          <div className="grid gap-3 md:justify-items-end">
            <CopyCommand command="pnpm add @tetraslam/kiseki" />
            <div className="flex gap-2">
              <Link
                href="/docs"
                className="inline-flex h-8 items-center rounded-[4px] bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity duration-[90ms] hover:opacity-90"
              >
                docs
              </Link>
              <Link
                href="/llms.txt"
                className="inline-flex h-8 items-center rounded-[4px] px-3 text-[13px] text-ink-2 ring-1 ring-line transition-colors duration-[90ms] hover:bg-muted"
              >
                for agents
              </Link>
            </div>
          </div>
        </section>

        <Showcase demos={demos} />

        <section className="mt-20 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="max-w-[46ch]">
            <h2 className="text-[17px] font-semibold tracking-tight">your app keeps the job</h2>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-2">
              kiseki has built-in views for the tools every agent has: edits as diffs, shell runs
              with their exit status and test counts, reads, searches, and writes. for your own
              tools, pass a component per tool name. it gets the call, its result, and kiseki&apos;s
              own view to fall back on. the custom renderer demo above uses exactly this.
            </p>
          </div>
          <Code code={packageRendererSource} />
        </section>

        <section className="mt-16 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="max-w-[46ch]">
            <h2 className="text-[17px] font-semibold tracking-tight">any run, one record</h2>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-2">
              kiseki reads{" "}
              <a
                className="underline decoration-line-2 underline-offset-2 hover:decoration-current"
                href="https://www.opentraces.ai/schema/latest"
              >
                opentraces 0.9
              </a>
              . adapters convert ai sdk steps (record them from{" "}
              <code className="font-mono text-[13px]">onStepFinish</code>), claude code, opencode,
              codex, and pi sessions. drop one of those files on this page to read it here; nothing
              is uploaded.
            </p>
          </div>
          <Code code={usage} />
        </section>

        <section className="mt-16 max-w-[72ch]">
          <h2 className="text-[17px] font-semibold tracking-tight">measured, not claimed</h2>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-2">
            on a generated {perf.steps.toLocaleString()}-step trace, the first rows paint{" "}
            <span className="font-mono text-foreground">
              {Math.round(perf.firstRowsMedianMs)}ms
            </span>{" "}
            after the record is parsed, and nothing shifts while scrolling, expanding, or streaming
            (layout shift <span className="font-mono text-foreground">{perf.cls.toFixed(3)}</span>).
            diffs load only when one is on screen. the perf script and its results are in the repo.
          </p>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-[1160px] flex-wrap gap-x-6 gap-y-2 px-5 pb-10 text-xs text-ink-3">
        <span>mit</span>
        <a href="https://github.com/tetraslam/kiseki" className="hover:text-foreground">
          github.com/tetraslam/kiseki
        </a>
        <Link href="/docs" className="hover:text-foreground">
          docs
        </Link>
      </footer>
    </div>
  );
}
