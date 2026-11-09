import type { Patch, Step, ToolCall, TraceRecord } from "@tetraslam/kiseki-core";
import {
  asInput,
  buildRecord,
  clean,
  isObject,
  type Json,
  modelName,
  num,
  observation,
  parseLines,
  patchesFor,
  str,
  stringify,
  textOf,
  usage,
} from "./shared";

/**
 * Converts a Codex rollout (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) into a trace. Codex
 * logs one `token_count` event per model response, which closes the current step; tool outputs
 * join the step that made the call. `apply_patch` calls become patches, with unified diffs from
 * the matching `patch_apply_end` event.
 */
export function fromCodex(input: string | Json[]): TraceRecord {
  const lines = typeof input === "string" ? parseLines(input) : input;
  const steps: Step[] = [];
  const owners = new Map<string, { step: Step; call: ToolCall; at?: string }>();
  const applied = new Map<string, Json>();
  const hasUserEvents = lines.some((line) => {
    const payload = isObject(line.payload) ? line.payload : {};
    return (
      payload.type === "user_message" ||
      (isObject(payload.item) && payload.item.type === "UserMessage")
    );
  });
  let meta: Json = {};
  let model: string | undefined;
  let open: Step | undefined;
  let searches = 0;
  let running: string | undefined;

  const user = (content: string | undefined, timestamp?: string) => {
    if (!content?.trim()) return;
    const last = steps.at(-1);
    if (last?.role === "user" && last.content === content) return;
    open = undefined;
    steps.push(clean<Step>({ step_index: steps.length, role: "user", content, timestamp }));
  };
  const agent = (timestamp?: string) => {
    if (!open) {
      open = clean<Step>({
        step_index: steps.length,
        role: "agent",
        call_type: "main",
        model,
        timestamp,
      });
      steps.push(open);
    }
    return open;
  };
  const addCall = (step: Step, call: ToolCall, at?: string) => {
    step.tool_calls = [...(step.tool_calls ?? []), call];
    owners.set(call.tool_call_id, { step, call, at });
    running = call.tool_call_id;
  };

  for (const line of lines) {
    const payload = isObject(line.payload) ? line.payload : {};
    const timestamp = str(line.timestamp);
    if (line.type === "session_meta") meta = payload;
    else if (line.type === "turn_context") model = str(payload.model) ?? model;
    else if (line.type === "event_msg") {
      if (payload.type === "user_message") user(str(payload.message), timestamp);
      else if (
        payload.type === "item_completed" &&
        isObject(payload.item) &&
        payload.item.type === "UserMessage"
      ) {
        user(textOf(payload.item.content), timestamp);
      } else if (
        payload.type === "item_completed" &&
        isObject(payload.item) &&
        payload.item.type === "FileChange"
      ) {
        // Code-mode `exec` calls edit files without their own call id; credit the running call.
        const item = payload.item;
        const prior = running ? applied.get(running) : undefined;
        if (running && isObject(item.changes) && item.status === "completed") {
          applied.set(running, {
            success: true,
            changes: { ...(isObject(prior?.changes) ? prior.changes : {}), ...item.changes },
          });
        }
      } else if (payload.type === "token_count") {
        const info = isObject(payload.info) ? payload.info : undefined;
        const last = info && isObject(info.last_token_usage) ? info.last_token_usage : undefined;
        if (open && last) {
          // Codex's input_tokens already include cached_input_tokens.
          open.token_usage = usage(
            num(last.input_tokens),
            num(last.output_tokens),
            num(last.cached_input_tokens),
          );
        }
        if (last) open = undefined;
      } else if (payload.type === "patch_apply_end") {
        const id = str(payload.call_id);
        if (id) applied.set(id, payload);
      }
    } else if (line.type === "response_item") {
      switch (payload.type) {
        case "message": {
          const text = textOf(payload.content, "\n\n");
          if (payload.role === "assistant" && text) {
            const step = agent(timestamp);
            step.content = step.content ? `${step.content}\n\n${text}` : text;
          } else if (payload.role === "user" && !hasUserEvents && text && !isContext(text))
            user(text, timestamp);
          break;
        }
        case "reasoning": {
          const parts = [
            ...(Array.isArray(payload.summary) ? payload.summary : []),
            ...(Array.isArray(payload.content) ? payload.content : []),
          ];
          const text = textOf(parts, "\n\n");
          const step = agent(timestamp);
          if (text)
            step.reasoning_content = step.reasoning_content
              ? `${step.reasoning_content}\n\n${text}`
              : text;
          break;
        }
        case "function_call":
        case "custom_tool_call":
        case "local_shell_call": {
          const id = str(payload.call_id) ?? str(payload.id) ?? "";
          const raw = payload.arguments ?? payload.input ?? payload.action;
          addCall(
            agent(timestamp),
            clean<ToolCall>({
              tool_call_id: id,
              tool_name: str(payload.name) ?? "shell",
              input: asInput(raw),
            }),
            timestamp,
          );
          break;
        }
        case "web_search_call": {
          // Hosted search runs inside the response, so its result arrives with the call.
          const id = str(payload.id) ?? `web_search_${searches++}`;
          const step = agent(timestamp);
          const action = isObject(payload.action) ? payload.action : {};
          addCall(
            step,
            clean<ToolCall>({ tool_call_id: id, tool_name: "web_search", input: action }),
            timestamp,
          );
          step.observations = [
            ...(step.observations ?? []),
            observation(id, str(action.query) ?? str(action.url) ?? str(payload.status)),
          ];
          break;
        }
        case "function_call_output":
        case "custom_tool_call_output":
        case "local_shell_call_output":
          addOutput(owners, applied, payload, timestamp);
          break;
      }
    }
  }

  const patches: Patch[] = [];
  for (const [id, { step, call }] of owners) {
    const event = applied.get(id);
    if (event?.success === false) continue;
    if (call.tool_name === "apply_patch" || event)
      patches.push(...patchesFor(step, call, diffsOf(event)));
  }
  const git = isObject(meta.git) ? meta.git : {};
  return buildRecord({
    sessionId: str(meta.id) ?? str(meta.session_id) ?? "codex",
    agent: {
      name: "codex",
      version: str(meta.cli_version),
      model: modelName(meta.model_provider, model ?? steps.find((step) => step.model)?.model),
    },
    steps,
    patches: patches.length ? patches : undefined,
    start: str(meta.timestamp),
    metadata: { cwd: str(meta.cwd), originator: str(meta.originator), git_branch: str(git.branch) },
  });
}

/** Injected context Codex sends as user messages, such as `<environment_context>` or AGENTS.md. */
function isContext(text: string): boolean {
  const start = text.trimStart();
  return start.startsWith("<") || start.startsWith("# AGENTS.md");
}

function addOutput(
  owners: Map<string, { step: Step; call: ToolCall; at?: string }>,
  applied: Map<string, Json>,
  payload: Json,
  timestamp?: string,
) {
  const id = str(payload.call_id) ?? "";
  const owner = owners.get(id);
  if (!owner) return;
  let output = payload.output;
  let seconds: number | undefined;
  let failed = false;
  // Custom tools wrap their output as JSON: {"output": "...", "metadata": {"duration_seconds"}}.
  if (typeof output === "string" && output.startsWith('{"output"')) {
    try {
      const parsed: unknown = JSON.parse(output);
      if (isObject(parsed)) {
        output = parsed.output;
        const metadata = isObject(parsed.metadata) ? parsed.metadata : {};
        seconds = num(metadata.duration_seconds);
      }
    } catch {}
  }
  if (isObject(output)) {
    failed = output.success === false;
    output = output.content ?? output.output;
  }
  const text = typeof output === "string" ? output : (textOf(output) ?? stringify(output));
  seconds ??= num(Number(/^Wall time: ([\d.]+) seconds$/m.exec(text ?? "")?.[1]));
  const event = applied.get(id);
  if (event?.success === false) failed = true;
  const error = failed ? str(event?.stderr) || text : undefined;
  owner.step.observations = [...(owner.step.observations ?? []), observation(id, text, error)];
  if (seconds != null) owner.call.duration_ms = Math.round(seconds * 1000);
  else if (owner.at && timestamp) {
    const ms = Date.parse(timestamp) - Date.parse(owner.at);
    if (ms >= 0) owner.call.duration_ms = ms;
  }
}

/** Unified diffs per file from a `patch_apply_end` event's `changes`. */
function diffsOf(event: Json | undefined): Record<string, string> | undefined {
  if (!event || !isObject(event.changes)) return undefined;
  const out: Record<string, string> = {};
  for (const [path, change] of Object.entries(event.changes)) {
    if (!isObject(change)) continue;
    const target = str(change.move_path) ?? path;
    if (change.type === "update" && str(change.unified_diff)) {
      out[path] = `--- a/${path}\n+++ b/${target}\n${change.unified_diff}`;
    } else if (
      (change.type === "add" || change.type === "delete") &&
      typeof change.content === "string"
    ) {
      const lines = change.content.replace(/\n$/, "").split("\n");
      const add = change.type === "add";
      const header = add ? `--- /dev/null\n+++ b/${path}` : `--- a/${path}\n+++ /dev/null`;
      const range = add ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@`;
      out[path] =
        `${header}\n${range}\n${lines.map((line) => (add ? "+" : "-") + line).join("\n")}\n`;
    }
  }
  return out;
}
