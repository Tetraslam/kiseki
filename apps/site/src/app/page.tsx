import Link from "next/link";
import { Code } from "@/components/code";
import { CopyCommand } from "@/components/copy-command";
import { type Demo, Showcase } from "@/components/showcase";
import { ThemeToggle } from "@/components/theme-toggle";
import { fixture } from "@/lib/fixtures";
import { demos as list } from "@/lib/hero";
import { packageRendererSource } from "@/lib/snippets";
import perf from "../../../../docs/perf-results.json";

const usage = `import { Trace } from "@tetraslam/kiseki";
import "@tetraslam/kiseki/styles.css";

<div style={{ height: 560 }}>
  <Trace record={record} />
</div>`;

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
    <>
      <Showcase
        demos={demos}
        intro={
          <div>
            <h1 className="flex items-end gap-3">
              <span className="font-display text-[88px] font-extrabold leading-[0.82] tracking-[-0.04em]">
                軌跡
              </span>
              <span className="pb-1 text-[15px] font-medium tracking-tight text-white/80">
                kiseki
              </span>
            </h1>
            <p className="mt-6 text-[19px] font-medium leading-[1.3] tracking-[-0.01em]">
              the trace an agent leaves behind, made readable.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/65">
              a react component for agent runs: every turn, its reasoning, the tools it called, and
              the diffs it made. drop it into your chat, admin page, or eval harness.
            </p>
            <div className="mt-5">
              <CopyCommand command="pnpm add @tetraslam/kiseki" tone="dye" />
            </div>
          </div>
        }
        footer={
          <div className="flex items-center gap-4 text-[12.5px] text-white/60">
            <Link href="/docs" className="hover:text-white">
              docs
            </Link>
            <a href="https://github.com/tetraslam/kiseki" className="hover:text-white">
              github
            </a>
            <Link href="/llms.txt" className="hover:text-white">
              for agents
            </Link>
            <span className="ml-auto">
              <ThemeToggle />
            </span>
          </div>
        }
      />
      <section className="mx-auto grid w-full max-w-[1200px] gap-8 px-6 py-14 md:grid-cols-3">
        <div className="max-w-[44ch]">
          <h2 className="text-[15px] font-semibold tracking-tight">your app keeps the job</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            edits render as diffs, shell runs as pass and fail, reads as line ranges. your own tools
            get your own components; the custom renderer demo draws npm results as cards.
          </p>
        </div>
        <div className="md:col-span-2">
          <Code code={packageRendererSource} />
        </div>
        <div className="max-w-[44ch]">
          <h2 className="text-[15px] font-semibold tracking-tight">one component, sized by you</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            it fills the box you give it and scrolls inside, virtualized: 10,000 steps paint their
            first rows in{" "}
            <span className="font-mono text-foreground">
              {Math.round(perf.firstRowsMedianMs)}ms
            </span>
            , and nothing shifts.
          </p>
        </div>
        <div className="md:col-span-2">
          <Code code={usage} />
        </div>
      </section>
      <footer className="mx-auto flex w-full max-w-[1200px] gap-6 px-6 pb-10 text-xs text-ink-3">
        <span>mit</span>
        <a href="https://github.com/tetraslam/kiseki" className="hover:text-foreground">
          github.com/tetraslam/kiseki
        </a>
      </footer>
    </>
  );
}
