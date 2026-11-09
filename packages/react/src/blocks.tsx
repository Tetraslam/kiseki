import type { DiffFileInput } from "@pierre/diffs";
import { align, type PairedCall, type Patch, type ViewStep } from "@tetraslam/kiseki-core";
import {
  type ComponentType,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import { callKey, patchKey, useTrace } from "./context";
import { wordCount } from "./format";
import { derivePatch, lineCounts } from "./patches";
import { ToolCallBlock } from "./tools";
import type { PatchContent, ToolRendererProps } from "./types";

export function Chevron() {
  return (
    <svg className="kiseki-chevron" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2 6.5 5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Grows its content in place on the open curve. Closed content isn't mounted. */
export function Disclosure({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return (
    <div
      className="kiseki-disclosure"
      data-open={open || undefined}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) setMounted(false);
      }}
    >
      <div>{(open || mounted) && children}</div>
    </div>
  );
}

const markdownComponents = {
  // Streamdown's defaults carry Tailwind classes; kiseki styles plain elements instead.
  p: (props: { children?: ReactNode }) => <p>{props.children}</p>,
  ul: (props: { children?: ReactNode }) => <ul>{props.children}</ul>,
  ol: (props: { children?: ReactNode }) => <ol>{props.children}</ol>,
  li: (props: { children?: ReactNode }) => <li>{props.children}</li>,
  h1: (props: { children?: ReactNode }) => <h4>{props.children}</h4>,
  h2: (props: { children?: ReactNode }) => <h4>{props.children}</h4>,
  h3: (props: { children?: ReactNode }) => <h4>{props.children}</h4>,
  strong: (props: { children?: ReactNode }) => <strong>{props.children}</strong>,
  blockquote: (props: { children?: ReactNode }) => <blockquote>{props.children}</blockquote>,
  hr: () => <hr />,
  a: (props: { children?: ReactNode; href?: string }) => (
    <a href={props.href} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  ),
  table: (props: { children?: ReactNode }) => <table>{props.children}</table>,
  pre: (props: { children?: ReactNode }) => <pre>{props.children}</pre>,
  code: (props: { children?: ReactNode; className?: string }) => (
    <code className={props.className}>{props.children}</code>
  ),
};

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="kiseki-markdown">
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        isAnimating={streaming}
        controls={false}
        components={markdownComponents}
      >
        {text}
      </Streamdown>
    </div>
  );
});

export function Message({ text, streaming }: { text: string; view: ViewStep; streaming: boolean }) {
  return (
    <div className="kiseki-message">
      <Markdown text={text} streaming={streaming} />
    </div>
  );
}

export function Reasoning({
  text,
  expanded,
  onToggle,
}: {
  text: string;
  view: ViewStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button type="button" className="kiseki-toggle" aria-expanded={expanded} onClick={onToggle}>
        <Chevron />
        <span>thought</span>
        <span className="kiseki-num">{wordCount(text)} words</span>
      </button>
      <Disclosure open={expanded}>
        <div className="kiseki-reasoning-text">{text}</div>
      </Disclosure>
    </div>
  );
}

/** Renders the call through the host's renderer for its tool, or kiseki's built-ins. */
export function CallSlot({ view, paired }: { view: ViewStep; paired: PairedCall }) {
  const context = useTrace();
  const key = callKey(view.key, paired.call.tool_call_id);
  const expanded = context.isExpanded(key);
  const payload = usePayload(view, paired, expanded);
  const Renderer: ComponentType<ToolRendererProps> =
    context.renderers.tools?.[paired.call.tool_name] ?? context.renderers.fallback ?? ToolCallBlock;
  return (
    <Renderer
      call={paired.call}
      observation={paired.observation}
      status={paired.status}
      step={view.step}
      stepKey={view.key}
      paired={paired}
      patches={paired.patches}
      payload={payload.value}
      payloadState={payload.state}
      expanded={expanded}
      onToggle={() => context.toggle(key)}
      Default={ToolCallBlock}
    />
  );
}

/** Observation content from the record, or from `loadPayload` once the call is expanded. */
function usePayload(view: ViewStep, paired: PairedCall, expanded: boolean) {
  const { loadPayload, payloads } = useTrace();
  const inline = paired.observation?.content;
  const key = callKey(view.key, paired.call.tool_call_id);
  const [entry, setEntry] = useState(() => payloads.get(key));
  const canLoad = !!loadPayload && !!paired.observation && inline == null;
  useEffect(() => {
    if (!expanded || !canLoad || !loadPayload) return;
    const cached = payloads.get(key);
    if (cached) {
      setEntry(cached);
      return;
    }
    const loading = { state: "loading" as const };
    payloads.set(key, loading);
    setEntry(loading);
    loadPayload(view.index, paired.call.tool_call_id).then(
      (value) => {
        const done = { state: "loaded" as const, value: value ?? "" };
        payloads.set(key, done);
        setEntry(done);
      },
      () => {
        payloads.delete(key);
        setEntry({ state: "error" });
      },
    );
  }, [expanded, canLoad, loadPayload, payloads, key, view.index, paired.call.tool_call_id]);
  if (inline != null) return { value: inline, state: "loaded" as const };
  return { value: entry?.value, state: entry?.state ?? ("idle" as const) };
}

let diffsModule: Promise<typeof import("@pierre/diffs/react")> | undefined;
let diffsLoaded: typeof import("@pierre/diffs/react") | undefined;
/** @pierre/diffs loads the first time a diff is on screen. */
export function loadDiffs() {
  diffsModule ??= import("@pierre/diffs/react").then((module) => {
    diffsLoaded = module;
    return module;
  });
  return diffsModule;
}

/** A patch the record has but no call claims: a line that opens to its diff. */
export function PatchBlock({
  patch,
  stepKey,
}: {
  patch: Patch;
  stepKey: string;
  call?: PairedCall;
}) {
  const context = useTrace();
  const key = patchKey(stepKey, patch.patch_id);
  const expanded = context.isExpanded(key);
  const derived = derivePatch(patch);
  const [loaded, setLoaded] = useState<PatchContent | undefined | null>(undefined);
  useEffect(() => {
    if (!expanded || derived || !context.loadPatch || loaded !== undefined) return;
    context.loadPatch(patch).then(
      (value) => setLoaded(value ?? null),
      () => setLoaded(null),
    );
  }, [expanded, derived, context.loadPatch, loaded, patch]);
  const content = derived ?? loaded ?? undefined;
  const counts = content ? lineCounts(content) : undefined;
  const Custom = context.renderers.patch;
  return (
    <div className="kiseki-call">
      <button
        type="button"
        className="kiseki-call-line"
        aria-expanded={expanded}
        onClick={() => context.toggle(key)}
      >
        <Chevron />
        <span className="kiseki-result">
          {counts ? (
            <>
              changed <span className="kiseki-add">+{counts.added}</span>{" "}
              <span className="kiseki-del">−{counts.removed}</span>
            </>
          ) : (
            "changed"
          )}
        </span>
        <span className="kiseki-target kiseki-patch-path">
          <bdi dir="ltr">{patch.file_path}</bdi>
        </span>
        <span className="kiseki-tool-name">patch</span>
      </button>
      <Disclosure open={expanded}>
        <div className="kiseki-call-body">
          {Custom ? (
            <Custom patch={patch} content={content} />
          ) : content ? (
            <div className="kiseki-diff">
              <DiffView path={patch.file_path} content={content} />
            </div>
          ) : (
            <span className="kiseki-note">
              {context.loadPatch && loaded === undefined
                ? " "
                : "no diff content for this patch (snapshots only)"}
            </span>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

/** Pixels per diff line, and the padding around them, matching @pierre/diffs' unwrapped layout. */
export const DIFF_LINE = 19;
export const DIFF_PAD = 16;

/** Any patch content as the two sides of one snippet, so every diff lays out the same way. */
export function diffSides(content: PatchContent): { before: string | null; after: string | null } {
  if (content.patch == null) return { before: content.before, after: content.after };
  const before: string[] = [];
  const after: string[] = [];
  for (const line of content.patch.split("\n")) {
    if (/^(diff --git|index |Index: |===|--- |\+\+\+ |@@|\\ No newline)/.test(line)) continue;
    if (line.startsWith("-")) before.push(line.slice(1));
    else if (line.startsWith("+")) after.push(line.slice(1));
    else {
      before.push(line.slice(1));
      after.push(line.slice(1));
    }
  }
  while (before.at(-1) === "" && after.at(-1) === "") {
    before.pop();
    after.pop();
  }
  return { before: before.join("\n"), after: after.join("\n") };
}

/** How many lines the unified view shows: every line of both sides, shared ones once. */
export function diffLines(sides: { before: string | null; after: string | null }): number {
  const a = sides.before == null ? [] : sides.before.replace(/\n$/, "").split("\n");
  const b = sides.after == null ? [] : sides.after.replace(/\n$/, "").split("\n");
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  return align(a, b).length;
}

/**
 * A diff through @pierre/diffs, every line shown and none wrapped, so its height is known before
 * it renders. Until the module arrives, the same lines show as plain text in a box of exactly
 * that height: the swap moves nothing.
 */
export function DiffView({ path, content }: { path: string; content: PatchContent }) {
  const [module, setModule] = useState(diffsLoaded);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  useLayoutEffect(() => {
    if (ref.current) {
      setScheme(getComputedStyle(ref.current).colorScheme.includes("dark") ? "dark" : "light");
    }
  }, []);
  useEffect(() => {
    if (!module) loadDiffs().then(setModule, () => setFailed(true));
  }, [module]);
  const sides = useMemo(() => diffSides(content), [content]);
  const height = useMemo(() => diffLines(sides) * DIFF_LINE + DIFF_PAD, [sides]);
  const options = useMemo(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: scheme,
      diffStyle: "unified" as const,
      overflow: "scroll" as const,
      expandUnchanged: true,
      disableFileHeader: true,
      lineDiffType: "word" as const,
    }),
    [scheme],
  );
  const files = useMemo((): DiffFileInput => {
    // A trailing newline on both sides, so no "no newline at end of file" row appears.
    const file = (contents: string) => ({
      name: path,
      contents: contents.endsWith("\n") ? contents : `${contents}\n`,
    });
    if (sides.before == null) return { oldFile: null, newFile: file(sides.after ?? "") };
    if (sides.after == null) return { oldFile: file(sides.before), newFile: null };
    return { oldFile: file(sides.before), newFile: file(sides.after) };
  }, [sides, path]);
  return (
    <div ref={ref} className="kiseki-diff-box" style={{ height }}>
      {!module || failed ? (
        <pre className="kiseki-diff-wait" style={{ height }}>
          {plainDiff(sides)}
        </pre>
      ) : (
        <module.MultiFileDiff {...files} options={options} />
      )}
    </div>
  );
}

function plainDiff(sides: { before: string | null; after: string | null }): string {
  const a = sides.before == null ? [] : sides.before.split("\n");
  const b = sides.after == null ? [] : sides.after.split("\n");
  if (!a.length) return b.map((l) => `+ ${l}`).join("\n");
  if (!b.length) return a.map((l) => `- ${l}`).join("\n");
  return align(a, b)
    .map((p) =>
      p.a != null && p.b != null
        ? `  ${a[p.a]}`
        : p.a != null
          ? `- ${a[p.a]}`
          : `+ ${b[p.b as number]}`,
    )
    .join("\n");
}
