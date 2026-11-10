import Link from "next/link";
import { Code } from "@/components/code";
import { CopyCommand } from "@/components/copy-command";
import { type Demo, Showcase } from "@/components/showcase";
import { ThemeToggle } from "@/components/theme-toggle";
import { fixture } from "@/lib/fixtures";
import { demos as list } from "@/lib/hero";
import { packageRendererSource } from "@/lib/snippets";

const usage = `import { Trace } from "@tetraslam/kiseki";
import "@tetraslam/kiseki/styles.css";

<Trace record={record} />`;

async function load(d: (typeof list)[number]): Promise<Demo> {
  const base = { id: d.id, label: d.label, note: d.note };
  if (d.kind === "runs") {
    const records = await Promise.all(d.files.map(fixture));
    const latest = Math.max(
      ...records
        .map((r) => Date.parse(r.timestamp_start ?? r.steps?.[0]?.timestamp ?? ""))
        .filter(Number.isFinite),
    );
    return { ...base, kind: "runs", records, now: latest + 40 * 60_000 };
  }
  if (d.kind === "evals")
    return { ...base, kind: "evals", a: await fixture(d.files[0]), b: await fixture(d.files[1]) };
  return { ...base, kind: d.kind, record: await fixture(d.file) };
}

export default async function Home() {
  const demos = await Promise.all(list.map(load));
  return (
    <>
      <Showcase
        demos={demos}
        intro={
          <div className="px-3">
            <h1 className="flex items-end gap-3">
              <span className="font-display text-[84px] font-extrabold leading-[0.82] tracking-[-0.04em]">
                軌跡
              </span>
              <span className="pb-1 text-[15px] font-medium text-white/80">kiseki</span>
            </h1>
            <p className="mt-6 text-[17px] font-medium">a react component for agent traces.</p>
            <div className="mt-4">
              <CopyCommand command="pnpm add @tetraslam/kiseki" tone="dye" />
            </div>
          </div>
        }
        footer={
          <div className="flex items-center gap-4 px-3 text-[12.5px] text-white/60">
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
      <section className="mx-auto grid w-full max-w-[1200px] gap-6 px-6 py-14 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <h2 className="text-[14px] font-semibold">use</h2>
          <Code code={usage} />
        </div>
        <div className="grid content-start gap-2">
          <h2 className="text-[14px] font-semibold">your own tools</h2>
          <Code code={packageRendererSource} />
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
