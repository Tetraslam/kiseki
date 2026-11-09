import type { DiffFileInput } from "@pierre/diffs";
import type { PairedCall, Patch, ViewStep } from "@tetraslam/kiseki-core";
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
import { callKey, patchKey, reasoningKey, useTrace } from "./context";
import { formatDuration, oneLine, prettyJson, primaryArg, wordCount } from "./format";
import { derivePatch, lineCounts, withFileHeader } from "./patches";
import { useDelayed } from "./state";
import type { PatchContent, PatchRendererProps, ToolRendererProps } from "./types";

export function Chevron() {
  return (
    <svg className="kiseki-chevron" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2 6.5 5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** Grows its content in place on the morph curve. Closed content isn't mounted. */
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
    <div className="kiseki-message" data-role="agent">
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
        <span>reasoning</span>
        <span className="kiseki-num">{wordCount(text)} words</span>
      </button>
      <Disclosure open={expanded}>
        <div className="kiseki-reasoning-text">{text}</div>
      </Disclosure>
    </div>
  );
}

const statusLabel: Record<string, string> = {
  error: "failed",
  missing: "no result recorded",
  pending: "running",
};

/** kiseki's tool call block: one line, expanding to input, output, and any patches. */
export function ToolCallBlock(props: ToolRendererProps) {
  const { call, observation, status, expanded, onToggle, payload, payloadState, patches } = props;
  const arg = primaryArg(call.input);
  const summary =
    status === "pending"
      ? undefined
      : observation?.error
        ? oneLine(observation.output_summary || observation.error, 120)
        : observation?.output_summary
          ? oneLine(observation.output_summary, 120)
          : status === "missing"
            ? statusLabel.missing
            : undefined;
  const showLoading = useDelayed(payloadState === "loading");
  const inputText = call.input && Object.keys(call.input).length ? prettyJson(call.input) : "";
  return (
    <div className="kiseki-call" data-status={status} data-open={expanded || undefined}>
      <button
        type="button"
        className="kiseki-call-line"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="kiseki-dot" />
        <span className="kiseki-call-name">{call.tool_name}</span>
        {status === "pending" ? (
          <span className="kiseki-call-arg">
            <span className="kiseki-shimmer">{arg ? `running ${arg}` : "running…"}</span>
          </span>
        ) : (
          <span className="kiseki-call-arg">{arg}</span>
        )}
        {summary && <span className="kiseki-call-summary">{summary}</span>}
        <span className="kiseki-call-time kiseki-num">{formatDuration(call.duration_ms)}</span>
      </button>
      <Disclosure open={expanded}>
        <div className="kiseki-call-detail">
          {inputText && (
            <div className="kiseki-field">
              <span className="kiseki-field-label">input</span>
              <pre className="kiseki-pre">{inputText}</pre>
            </div>
          )}
          {observation?.error && (
            <div className="kiseki-field">
              <span className="kiseki-field-label">error</span>
              <div className="kiseki-error kiseki-mono">{observation.error}</div>
            </div>
          )}
          {observation?.output_summary && payload == null && (
            <div className="kiseki-field">
              <span className="kiseki-field-label">summary</span>
              <div>{observation.output_summary}</div>
            </div>
          )}
          {payload != null ? (
            <div className="kiseki-field">
              <span className="kiseki-field-label">output</span>
              <pre className="kiseki-pre kiseki-output">{payload || " "}</pre>
            </div>
          ) : payloadState === "loading" ? (
            <span className="kiseki-note">
              {showLoading ? <span className="kiseki-shimmer">loading output</span> : " "}
            </span>
          ) : payloadState === "error" ? (
            <span className="kiseki-note">couldn't load the output</span>
          ) : status === "pending" ? (
            <span className="kiseki-note">
              <span className="kiseki-shimmer">waiting for the result</span>
            </span>
          ) : status === "missing" ? (
            <span className="kiseki-note">the trace has no result for this call</span>
          ) : null}
          {patches.length > 0 && (
            <div className="kiseki-field">
              <span className="kiseki-field-label">
                {patches.length === 1 ? "patch" : "patches"}
              </span>
              {patches.map((patch) => (
                <PatchBlock
                  key={patch.patch_id}
                  patch={patch}
                  stepKey={props.stepKey}
                  call={props.paired}
                />
              ))}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

/** Renders the call through the host's renderer for its tool, or kiseki's default. */
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
/** @pierre/diffs loads the first time a patch opens. */
export function loadDiffs() {
  diffsModule ??= import("@pierre/diffs/react");
  return diffsModule;
}

export function PatchBlock({
  patch,
  stepKey,
  call,
}: {
  patch: Patch;
  stepKey: string;
  call?: PairedCall;
}) {
  const context = useTrace();
  const key = patchKey(stepKey, patch.patch_id);
  const expanded = context.isExpanded(key);
  const derived = derivePatch(patch, call);
  const [loaded, setLoaded] = useState<PatchContent | undefined | null>(undefined);
  useEffect(() => {
    if (!expanded || derived || !context.loadPatch || loaded !== undefined) return;
    context.loadPatch(patch).then(
      (value) => setLoaded(value ?? null),
      () => setLoaded(null),
    );
  }, [expanded, derived, context.loadPatch, loaded, patch]);
  // A patch on screen is one click from opening: warm the diff renderer while the browser idles.
  useEffect(() => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (idle) idle(() => void loadDiffs().catch(() => {}));
  }, []);
  const content = derived ?? loaded ?? undefined;
  const counts = content ? lineCounts(content) : undefined;
  const Custom = context.renderers.patch;
  return (
    <div className="kiseki-patch">
      <button
        type="button"
        className="kiseki-patch-line"
        aria-expanded={expanded}
        onClick={() => context.toggle(key)}
      >
        <Chevron />
        <span className="kiseki-patch-path">
          <bdi dir="ltr">{patch.file_path}</bdi>
        </span>
        {counts && (
          <span className="kiseki-num">
            <span className="kiseki-add">+{counts.added}</span>{" "}
            <span className="kiseki-del">−{counts.removed}</span>
          </span>
        )}
      </button>
      <Disclosure open={expanded}>
        <div className="kiseki-patch-body">
          {Custom ? (
            <Custom patch={patch} call={call} content={content} />
          ) : content ? (
            <DiffView patch={patch} content={content} />
          ) : (
            <div className="kiseki-call-detail kiseki-note">
              {context.loadPatch && loaded === undefined
                ? " "
                : "no diff content for this patch (snapshots only)"}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

function DiffView({ patch, content }: PatchRendererProps & { content: PatchContent }) {
  const [module, setModule] = useState<Awaited<ReturnType<typeof loadDiffs>>>();
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  useLayoutEffect(() => {
    if (ref.current) {
      setScheme(getComputedStyle(ref.current).colorScheme.includes("dark") ? "dark" : "light");
    }
  }, []);
  useEffect(() => {
    loadDiffs().then(setModule, () => setFailed(true));
  }, []);
  const showWait = useDelayed(!module && !failed);
  const options = useMemo(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: scheme,
      diffStyle: "unified" as const,
      overflow: "wrap" as const,
      disableFileHeader: true,
    }),
    [scheme],
  );
  const files = useMemo((): DiffFileInput => {
    const file = (contents: string) => ({ name: patch.file_path, contents });
    if (content.before == null) return { oldFile: null, newFile: file(content.after ?? "") };
    if (content.after == null) return { oldFile: file(content.before), newFile: null };
    return { oldFile: file(content.before), newFile: file(content.after) };
  }, [content.before, content.after, patch.file_path]);
  return (
    <div ref={ref}>
      {failed ? (
        <pre className="kiseki-pre">
          {content.patch ?? `${content.before ?? ""}\n→\n${content.after ?? ""}`}
        </pre>
      ) : !module ? (
        <div className="kiseki-call-detail kiseki-note">
          {showWait ? <span className="kiseki-shimmer">loading diff</span> : " "}
        </div>
      ) : content.patch != null ? (
        <module.PatchDiff
          patch={withFileHeader(content.patch, patch.file_path)}
          options={options}
        />
      ) : (
        <module.MultiFileDiff {...files} options={options} />
      )}
    </div>
  );
}

export { reasoningKey };
