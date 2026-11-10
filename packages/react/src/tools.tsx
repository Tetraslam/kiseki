import { testCounts as coreTestCounts, type PairedCall } from "@tetraslam/kiseki-core";
import { type ReactNode, useState } from "react";
import { Attachments } from "./attachments";
import { DiffView } from "./blocks";
import { useTrace } from "./context";
import { formatDuration, oneLine, prettyJson } from "./format";
import { Reveal } from "./motion";
import { derivePatch, lineCounts } from "./patches";
import { useDelayed } from "./state";
import type { PatchContent, ToolRendererProps } from "./types";

export type ToolKind =
  | "edit"
  | "write"
  | "shell"
  | "read"
  | "grep"
  | "glob"
  | "task"
  | "fetch"
  | "generic";

const names: Record<Exclude<ToolKind, "generic">, string[]> = {
  edit: [
    "edit",
    "multiedit",
    "str_replace",
    "str_replace_editor",
    "str_replace_based_edit_tool",
    "apply_patch",
    "patch",
    "replace",
  ],
  write: ["write", "create", "create_file", "write_file"],
  shell: [
    "bash",
    "shell",
    "exec",
    "exec_command",
    "run",
    "terminal",
    "command",
    "local_shell",
    "run_terminal_cmd",
    "run_command",
  ],
  read: ["read", "view", "cat", "read_file", "open"],
  grep: ["grep", "search", "rg", "ripgrep", "codesearch", "search_files", "code_search"],
  glob: ["glob", "ls", "list", "list_files", "list_directory", "find", "find_files"],
  task: ["task", "agent", "subagent", "delegate", "dispatch_agent"],
  fetch: ["webfetch", "fetch", "web_fetch", "websearch", "web_search", "http", "browse"],
};

/** Which built-in renderer fits a tool, by its name and then by the shape of its input. */
export function toolKind(name: string, input?: Record<string, unknown>): ToolKind {
  const bare = name.split(/__|\./).at(-1)?.toLowerCase() ?? "";
  for (const [kind, list] of Object.entries(names))
    if (list.includes(bare)) return kind as ToolKind;
  if (input) {
    if ("old_string" in input || "oldString" in input || "edits" in input) return "edit";
    if ("command" in input || "cmd" in input) return "shell";
    if ("pattern" in input && ("path" in input || "glob" in input)) return "grep";
  }
  return "generic";
}

const str = (input: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.join(" ");
  }
  return undefined;
};

/** The call's output: loaded payload, then content, then the summary. */
function outputOf(props: ToolRendererProps): string | undefined {
  return props.payload ?? props.observation?.content ?? props.observation?.output_summary;
}

/** Counts from common test runners, with a fallback that counts ✔ and ✖ marks. */
export function testCounts(text: string): { passed: number; failed: number } | undefined {
  const counted = coreTestCounts(text);
  if (counted) return counted;
  const marks = {
    ok: (text.match(/^\s*[✔✓] /gm) ?? []).length,
    bad: (text.match(/^\s*[✖✗×] /gm) ?? []).length,
  };
  if (marks.ok + marks.bad >= 2) return { passed: marks.ok, failed: marks.bad };
  return undefined;
}

/** Lines naming failed tests, across the common runners. */
function failures(text: string): string[] {
  return lines(text)
    .filter((line) => /^\s*([✖✗×]|FAIL\b|not ok\b|FAILED\b|--- FAIL)/.test(line))
    .filter((line) => !/failing tests:?\s*$/i.test(line))
    .map((line) => line.replace(/\s*\(\d+(\.\d+)?m?s\)\s*$/, ""))
    .filter((line, i, all) => all.indexOf(line) === i)
    .slice(0, 14);
}

function failedNames(output: string): string {
  const names = failures(output).map((line) =>
    line.replace(/^\s*([✖✗×]|FAIL|not ok \d*|FAILED|--- FAIL:?)\s*/, ""),
  );
  if (!names.length) return "";
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown}, +${names.length - 2} more` : shown;
}

export function exitCode(text: string | undefined, error?: string): number | undefined {
  const source = `${error ?? ""}\n${text ?? ""}`;
  const match = /exit(?:ed)?(?: with)?(?: code|status)?[:\s]+(-?\d+)/i.exec(source);
  if (match) return Number(match[1]);
  return error ? 1 : undefined;
}

/** Paths relative to the run's working directory, when the trace has one. */
function useRelative() {
  const { workdir: base } = useTrace();
  return (path: string | undefined) => {
    if (!path) return "";
    if (base && path.startsWith(`${base}/`)) return path.slice(base.length + 1);
    if (base && path === base) return ".";
    return path;
  };
}

function lines(text: string): string[] {
  const all = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return all.length === 1 && all[0] === "" ? [] : all;
}

interface FrameProps {
  props: ToolRendererProps;
  result: ReactNode;
  target?: ReactNode;
  failed?: boolean;
  /** Body shown without expanding. The head then toggles the full view instead. */
  children?: (open: boolean) => ReactNode;
  /** Whether the body shows before anyone clicks. */
  defaultOpen?: boolean;
  /**
   * The result carries information worth its own line (failures, errors, matches). Otherwise it
   * sits on the right of the call line, quiet.
   */
  detail?: boolean;
}

/**
 * One tool call as one compact line: a toggle, the tool's name in receded mono, what it acted
 * on, a trivial result, and how long it took. Results that carry information (failures, errors,
 * matches) get a quiet second line; the full output opens on demand.
 */
function Frame({
  props,
  result,
  target,
  failed,
  children,
  defaultOpen = false,
  detail,
}: FrameProps) {
  const open = defaultOpen !== props.expanded;
  const hasBody = children != null;
  const hasResult = result != null && result !== "";
  const below = hasResult && (detail || failed || props.status === "error");
  return (
    <div className="kiseki-call" data-status={props.status} data-failed={failed || undefined}>
      <button
        type="button"
        className="kiseki-call-line"
        aria-expanded={hasBody ? open : undefined}
        onClick={props.onToggle}
      >
        <span className="kiseki-call-toggle" aria-hidden="true">
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path d="M3.5 2 6.5 5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </span>
        <span className="kiseki-tool">{props.call.tool_name}</span>
        <span className="kiseki-target">{target}</span>
        {hasResult && !below && <span className="kiseki-inline-result">{result}</span>}
        <span className="kiseki-call-time kiseki-num">
          {formatDuration(props.call.duration_ms)}
        </span>
      </button>
      {below && (
        <div className="kiseki-result">
          <Glyph status={props.status} failed={failed} />
          <span className="kiseki-result-text">{result}</span>
        </div>
      )}
      {props.observation?.attachments?.length ? (
        <div className="kiseki-call-attachments">
          <Attachments items={props.observation.attachments} />
        </div>
      ) : null}
      {children && <Reveal open={open}>{(shown) => children(shown)}</Reveal>}
    </div>
  );
}

function Glyph({ status, failed }: { status: string; failed?: boolean }) {
  const path =
    status === "pending"
      ? "M6 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"
      : status === "missing"
        ? "M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"
        : status === "error" || failed
          ? "M3.5 3.5l5 5M8.5 3.5l-5 5"
          : "M2.8 6.2l2.1 2.1 4.3-4.6";
  return (
    <span className="kiseki-glyph" role="img" aria-label={failed ? "failed" : status}>
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d={path}
          fill={status === "pending" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function ErrorBlock({ props }: { props: ToolRendererProps }) {
  const error = props.observation?.error;
  return error ? <div className="kiseki-error">{error}</div> : null;
}

function Pending({ props, label }: { props: ToolRendererProps; label: string }) {
  if (props.status === "pending") return <span className="kiseki-shimmer">{label}</span>;
  if (props.status === "missing") return <span className="kiseki-dim">no result recorded</span>;
  return null;
}

/** Output text with the last lines shown and the rest a click away. */
function Output({
  text,
  open,
  tail = 8,
  highlight,
}: {
  text: string;
  open: boolean;
  tail?: number;
  highlight?: RegExp;
}) {
  const all = lines(text);
  if (!all.length) return null;
  const shown = open || all.length <= tail + 2 ? all : all.slice(-tail);
  const hidden = all.length - shown.length;
  return (
    <>
      {hidden > 0 && <span className="kiseki-note">{hidden} earlier lines</span>}
      <pre className="kiseki-out" data-scroll={open || undefined}>
        {highlight
          ? shown.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: output lines never reorder.
              <Line key={i} line={line} pattern={highlight} />
            ))
          : shown.join("\n")}
      </pre>
    </>
  );
}

function Line({ line, pattern }: { line: string; pattern: RegExp }) {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  for (let match = re.exec(line); match; match = re.exec(line)) {
    if (!match[0]) break;
    parts.push(line.slice(last, match.index), <mark key={match.index}>{match[0]}</mark>);
    last = match.index + match[0].length;
  }
  parts.push(line.slice(last), "\n");
  return <>{parts}</>;
}

export function ShellCall(props: ToolRendererProps) {
  const command = (str(props.call.input, "command", "cmd", "script") ?? "").replace(
    /^cd \S+ && /,
    "",
  );
  const output = outputOf(props) ?? "";
  const tests = testCounts(output);
  const code = exitCode(output, props.observation?.error);
  const failed = (tests?.failed ?? 0) > 0 || (code != null && code !== 0);
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="running" />
    ) : tests ? (
      tests.failed ? (
        <>
          {`${tests.failed} failed · ${tests.passed} passed`}
          <span className="kiseki-dim"> {failedNames(output)}</span>
        </>
      ) : (
        `${tests.passed} passed`
      )
    ) : code != null ? (
      `exit ${code}`
    ) : output ? (
      "ran"
    ) : (
      "no output"
    );
  return (
    <Frame
      props={props}
      result={result}
      target={<span className="kiseki-command">{command}</span>}
      failed={failed}
    >
      {(open) =>
        open && (output.trim() || props.observation?.error) ? (
          <div className="kiseki-call-body">
            <ErrorBlock props={props} />
            {output.trim() && <Output text={output} open tail={400} />}
          </div>
        ) : null
      }
    </Frame>
  );
}

export function ReadCall(props: ToolRendererProps) {
  const relative = useRelative();
  const path = str(props.call.input, "file_path", "filePath", "path", "file", "target_file");
  const output = outputOf(props) ?? "";
  const offset = props.call.input?.offset ?? props.call.input?.start_line ?? props.call.input?.line;
  const limit = props.call.input?.limit;
  const range = /lines? (\d+)\s*[-–]\s*(\d+)/i.exec(output);
  const entries = /entries (\d+)\s*[-–]\s*(\d+)/i.exec(output);
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="reading" />
    ) : props.observation?.error ? (
      "couldn't read"
    ) : entries ? (
      `${Number(entries[2]) - Number(entries[1]) + 1} entries`
    ) : range ? (
      range[1] === range[2] ? (
        `line ${range[1]}`
      ) : (
        `lines ${range[1]}–${range[2]}`
      )
    ) : typeof offset === "number" ? (
      `from line ${offset}${typeof limit === "number" ? `, ${limit} lines` : ""}`
    ) : (
      "done"
    );
  return (
    <Frame props={props} result={result} target={relative(path)}>
      {(open) =>
        open ? (
          <div className="kiseki-call-body">
            <ErrorBlock props={props} />
            {output && (
              <Output
                text={output.replace(/^Read (file|directory) [^\n]*\n/, "")}
                open
                tail={400}
              />
            )}
          </div>
        ) : null
      }
    </Frame>
  );
}

export function GrepCall(props: ToolRendererProps) {
  const relative = useRelative();
  const pattern = str(props.call.input, "pattern", "query", "regex", "q") ?? "";
  const where = str(props.call.input, "path", "include", "glob", "directory");
  const output = outputOf(props) ?? "";
  const matches = lines(output).filter(
    (line) => line.trim() && !/^(found|no) \d* ?(matches|files)/i.test(line),
  );
  const counted = /(\d+) (?:matches|results|files)/i.exec(
    props.observation?.output_summary ?? output,
  );
  const count = counted ? Number(counted[1]) : matches.length;
  let highlight: RegExp | undefined;
  try {
    highlight = pattern ? new RegExp(pattern, "i") : undefined;
  } catch {}
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="searching" />
    ) : count === 0 ? (
      "no matches"
    ) : (
      <>
        {`${count} ${count === 1 ? "match" : "matches"}`}
        {matches[0] && (
          <span className="kiseki-dim kiseki-mono">
            {" "}
            {oneLine(relativeLine(matches[0], relative), 110)}
          </span>
        )}
      </>
    );
  return (
    <Frame
      props={props}
      result={result}
      detail={count > 0 && matches.length > 0}
      target={
        <>
          {pattern}
          {where && <span className="kiseki-dim"> in {relative(where)}</span>}
        </>
      }
    >
      {(open) =>
        open && matches.length ? (
          <div className="kiseki-call-body">
            <Output
              text={matches.map((m) => relativeLine(m, relative)).join("\n")}
              open={props.expanded}
              tail={5}
              highlight={highlight}
            />
          </div>
        ) : null
      }
    </Frame>
  );
}

function relativeLine(line: string, relative: (path: string) => string) {
  return line.replace(/^(\/[^\s:]+)/, (path) => relative(path));
}

export function GlobCall(props: ToolRendererProps) {
  const relative = useRelative();
  const pattern = str(props.call.input, "pattern", "glob", "path", "directory") ?? "";
  const output = outputOf(props) ?? "";
  const files = lines(output).filter((line) => line.trim());
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="listing" />
    ) : (
      `${files.length} ${files.length === 1 ? "file" : "files"}`
    );
  return (
    <Frame props={props} result={result} target={relative(pattern)}>
      {(open) =>
        open && files.length ? (
          <div className="kiseki-call-body">
            <Output text={files.map((f) => relative(f)).join("\n")} open tail={400} />
          </div>
        ) : null
      }
    </Frame>
  );
}

/** Patches for an edit: the ones the record links to the call, or one derived from its input. */
function patchesOf(
  props: ToolRendererProps,
): { key: string; path: string; content?: PatchContent }[] {
  if (props.patches.length) {
    return props.patches.map((patch) => ({
      key: patch.patch_id,
      path: patch.file_path,
      content: derivePatch(patch, props.paired),
    }));
  }
  const path = str(props.call.input, "file_path", "filePath", "path", "file") ?? "";
  const content = derivePatch({ patch_id: props.call.tool_call_id, file_path: path }, props.paired);
  return content ? [{ key: props.call.tool_call_id, path, content }] : [];
}

const SMALL_PATCH = 40;

export function EditCall(props: ToolRendererProps) {
  const relative = useRelative();
  const patches = patchesOf(props);
  const counts = patches.reduce(
    (sum, p) => {
      const c = p.content ? lineCounts(p.content) : { added: 0, removed: 0 };
      return { added: sum.added + c.added, removed: sum.removed + c.removed };
    },
    { added: 0, removed: 0 },
  );
  const small = counts.added + counts.removed <= SMALL_PATCH;
  const path = patches[0]?.path ?? str(props.call.input, "file_path", "filePath", "path") ?? "";
  const failed = props.status === "error";
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="editing" />
    ) : failed ? (
      "edit failed"
    ) : (
      <>
        <span className="kiseki-add">+{counts.added}</span>{" "}
        <span className="kiseki-del">−{counts.removed}</span>
      </>
    );
  return (
    <Frame
      props={props}
      result={result}
      target={patches.length > 1 ? `${patches.length} files` : relative(path)}
      failed={failed}
      defaultOpen={small && patches.some((p) => p.content)}
    >
      {(open) =>
        open ? (
          <div className="kiseki-call-body">
            <ErrorBlock props={props} />
            {patches.map((p) =>
              p.content ? (
                <div key={p.key} className="kiseki-diff">
                  <DiffView
                    path={relative(p.path)}
                    content={p.content}
                    expandKey={`${props.stepKey}#diff:${p.key}`}
                  />
                </div>
              ) : (
                <span key={p.key} className="kiseki-note">
                  no diff recorded for {relative(p.path)}
                </span>
              ),
            )}
          </div>
        ) : null
      }
    </Frame>
  );
}

export function WriteCall(props: ToolRendererProps) {
  const relative = useRelative();
  const path = str(props.call.input, "file_path", "filePath", "path", "file") ?? "";
  const content = str(props.call.input, "content", "contents", "text") ?? "";
  const count = lines(content).length;
  const failed = props.status === "error";
  return (
    <Frame
      props={props}
      result={
        props.status === "pending" ? (
          <Pending props={props} label="writing" />
        ) : failed ? (
          "write failed"
        ) : (
          `${count} lines`
        )
      }
      target={relative(path)}
      failed={failed}
    >
      {(open) =>
        open ? (
          <div className="kiseki-call-body">
            <ErrorBlock props={props} />
            {content && <NewFile text={content} full={props.expanded} />}
          </div>
        ) : null
      }
    </Frame>
  );
}

function NewFile({ text, full }: { text: string; full: boolean }) {
  const all = lines(text);
  const shown = full || all.length <= 14 ? all : all.slice(0, 12);
  const width = String(all.length).length;
  return (
    <>
      <pre className="kiseki-out" data-scroll={full || undefined}>
        {shown.map((line, i) => `${String(i + 1).padStart(width)}  ${line}`).join("\n")}
      </pre>
      {shown.length < all.length && (
        <span className="kiseki-note">{all.length - shown.length} more lines</span>
      )}
    </>
  );
}

export function TaskCall(props: ToolRendererProps) {
  const description = str(props.call.input, "description", "prompt", "task") ?? "";
  const role = str(props.call.input, "subagent_type", "agent", "agent_type");
  const output = (outputOf(props) ?? "").replace(/<[^>]+>/g, "").trim();
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label={`${role ?? "subagent"} working`} />
    ) : (
      `${role ?? "subagent"} finished`
    );
  return (
    <Frame props={props} result={result} target={oneLine(description, 120)} defaultOpen={false}>
      {(open) =>
        open && output ? (
          <div className="kiseki-call-body">
            <Output text={output} open tail={400} />
          </div>
        ) : null
      }
    </Frame>
  );
}

export function FetchCall(props: ToolRendererProps) {
  const url = str(props.call.input, "url", "query", "q") ?? "";
  const output = outputOf(props) ?? "";
  const status = /\b([1-5]\d\d)\b/.exec(props.observation?.output_summary ?? "");
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="fetching" />
    ) : props.observation?.error ? (
      "failed"
    ) : status ? (
      `HTTP ${status[1]}`
    ) : (
      `${lines(output).length} lines`
    );
  return (
    <Frame props={props} result={result} target={url}>
      {(open) =>
        open ? (
          <div className="kiseki-call-body">
            <ErrorBlock props={props} />
            {output && <Output text={output} open={props.expanded} tail={10} />}
          </div>
        ) : null
      }
    </Frame>
  );
}

/** Anything else: the summary leads; input and output show as readable fields, never raw overflow. */
export function GenericCall(props: ToolRendererProps) {
  const output = outputOf(props);
  const summary = props.observation?.error
    ? oneLine(props.observation.output_summary || props.observation.error, 140)
    : props.observation?.output_summary
      ? oneLine(props.observation.output_summary, 140)
      : output
        ? oneLine(output, 140)
        : undefined;
  const result =
    props.status === "pending" || props.status === "missing" ? (
      <Pending props={props} label="running" />
    ) : (
      (summary ?? "done")
    );
  const showLoading = useDelayed(props.payloadState === "loading");
  return (
    <Frame props={props} result={result} target={inputPreview(props.call.input)} detail={!!summary}>
      {(open) =>
        open ? (
          <div className="kiseki-call-body">
            <ErrorBlock props={props} />
            {props.call.input && Object.keys(props.call.input).length > 0 && (
              <Fields value={props.call.input} />
            )}
            {props.payloadState === "loading" ? (
              <span className="kiseki-note">
                {showLoading ? <span className="kiseki-shimmer">loading output</span> : " "}
              </span>
            ) : props.payloadState === "error" ? (
              <span className="kiseki-note">couldn't load the output</span>
            ) : output ? (
              <Output text={tryPretty(output)} open tail={400} />
            ) : null}
          </div>
        ) : null
      }
    </Frame>
  );
}

function inputPreview(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === "") continue;
    const text =
      typeof value === "string" ? oneLine(value, 60) : oneLine(JSON.stringify(value), 60);
    parts.push(Object.keys(input).length === 1 ? text : `${key}: ${text}`);
    if (parts.join(" ").length > 120) break;
  }
  return parts.join("  ");
}

/** Input as key and value, with strings shown as text (real newlines) and objects as wrapped JSON. */
export function Fields({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="kiseki-kv">
      {Object.entries(value).map(([key, v]) => (
        <Field key={key} name={key} value={v} />
      ))}
    </dl>
  );
}

function Field({ name, value }: { name: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = typeof value === "string" ? value : prettyJson(value);
  const long = text.split("\n").length > 12 || text.length > 900;
  return (
    <>
      <dt>{name}</dt>
      <dd>
        {long && !open ? `${text.split("\n").slice(0, 10).join("\n").slice(0, 800)}…` : text}
        {long && (
          <>
            {"\n"}
            <button type="button" className="kiseki-more" onClick={() => setOpen((o) => !o)}>
              {open ? "show less" : "show all"}
            </button>
          </>
        )}
      </dd>
    </>
  );
}

function tryPretty(text: string): string {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

const builtIns: Record<ToolKind, (props: ToolRendererProps) => ReactNode> = {
  edit: EditCall,
  write: WriteCall,
  shell: ShellCall,
  read: ReadCall,
  grep: GrepCall,
  glob: GlobCall,
  task: TaskCall,
  fetch: FetchCall,
  generic: GenericCall,
};

/** kiseki's default renderer for any call: picks the built-in that fits the tool. */
export function ToolCallBlock(props: ToolRendererProps) {
  const Renderer = builtIns[toolKind(props.call.tool_name, props.call.input)];
  return <Renderer {...props} />;
}

export type { PairedCall };
