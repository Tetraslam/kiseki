import type { Agent, Patch, Step, Task, ToolCall, TraceRecord } from "@tetraslam/kiseki-core";
import {
  asInput,
  buildRecord,
  clean,
  errorText,
  isObject,
  iso,
  modelName,
  num,
  observation,
  patchesFor,
  str,
  stringify,
  textOf,
  usage,
} from "./shared";

/**
 * The parts of an AI SDK `StepResult` the adapter reads. Real `StepResult` objects from `ai` v5
 * through v7 satisfy it, so `ai` stays a dev dependency.
 */
export interface AiSdkStep {
  readonly stepNumber?: number;
  readonly callId?: string;
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly content?: ReadonlyArray<{ readonly type: string }>;
  readonly finishReason?: string;
  readonly usage?: object;
  readonly performance?: {
    readonly stepTimeMs?: number;
    readonly toolExecutionMs?: Readonly<Record<string, number>>;
  };
  readonly response?: {
    readonly id?: string;
    readonly timestamp?: Date | string;
    readonly modelId?: string;
  };
  readonly experimental_steeringMessages?: ReadonlyArray<{
    readonly role: string;
    readonly content: unknown;
  }>;
}

/** A prompt as passed to `generateText`: a string or model messages. */
export type AiSdkPrompt =
  | string
  | ReadonlyArray<{ readonly role: string; readonly content: unknown }>;

export interface AiSdkOptions {
  /** Agent identity. Defaults to `{ name: "ai-sdk" }` with the model of the first step. */
  agent?: Partial<Agent> | string;
  /** Task description; defaults to the first user message. */
  task?: string | Task;
  /** The `system` option of the call, emitted as a leading system step. */
  system?: string;
  /** The `prompt` or `messages` of the call; system and user messages become steps. */
  prompt?: AiSdkPrompt;
  sessionId?: string;
  traceId?: string;
}

export interface TraceRecorder {
  /** Pass to `generateText` or `streamText`. Each finished step is converted immediately. */
  onStepFinish: (step: AiSdkStep) => void;
  /** The trace so far. Call again as steps arrive; each call returns a fresh record. */
  record: () => TraceRecord;
  /** The converted OpenTraces steps so far, including prompt steps. */
  readonly steps: readonly Step[];
}

interface Builder {
  steps: Step[];
  patches: Patch[];
  model?: string;
  callId?: string;
  start?: string;
  end?: string;
}

/**
 * Records AI SDK steps as they finish. Pass `onStepFinish` to `generateText`/`streamText` and read
 * `record()` at any time for a growing trace.
 */
export function createTraceRecorder(options: AiSdkOptions = {}): TraceRecorder {
  const builder = startBuilder(options);
  return {
    onStepFinish: (step) => {
      addStep(builder, step, new Date().toISOString());
    },
    record: () => finish(builder, options),
    get steps() {
      return builder.steps;
    },
  };
}

/** Converts finished steps, such as `result.steps` from `generateText`, into a trace. */
export function fromSteps(steps: readonly AiSdkStep[], options: AiSdkOptions = {}): TraceRecord {
  const builder = startBuilder(options);
  for (const step of steps) addStep(builder, step);
  return finish(builder, options);
}

function startBuilder(options: AiSdkOptions): Builder {
  const builder: Builder = { steps: [], patches: [] };
  const push = (role: Step["role"], content: string | undefined) => {
    if (content) builder.steps.push({ step_index: builder.steps.length, role, content });
  };
  push("system", options.system);
  if (typeof options.prompt === "string") push("user", options.prompt);
  else for (const message of options.prompt ?? []) pushMessage(builder, message);
  return builder;
}

function pushMessage(builder: Builder, message: { role: string; content: unknown }) {
  if (message.role !== "user" && message.role !== "system") return;
  const content = textOf(message.content, "");
  if (content)
    builder.steps.push({ step_index: builder.steps.length, role: message.role, content });
}

function addStep(builder: Builder, result: AiSdkStep, finishedAt?: string) {
  for (const message of result.experimental_steeringMessages ?? []) pushMessage(builder, message);
  const stepTime = num(result.performance?.stepTimeMs);
  const responseStart = iso(result.response?.timestamp);
  const started =
    responseStart ??
    (finishedAt && stepTime != null ? iso(Date.parse(finishedAt) - stepTime) : finishedAt);
  const model = result.model
    ? modelName(result.model.provider, result.model.modelId)
    : str(result.response?.modelId);
  builder.model ??= model;
  builder.callId ??= result.callId ?? result.response?.id;
  builder.start ??= started;
  builder.end =
    finishedAt ?? (started && stepTime != null ? iso(Date.parse(started) + stepTime) : started);

  const step: Step = { step_index: builder.steps.length, role: "agent", call_type: "main" };
  const text: string[] = [];
  const reasoning: string[] = [];
  const calls: ToolCall[] = [];
  const observations: NonNullable<Step["observations"]> = [];
  const toolTime = result.performance?.toolExecutionMs ?? {};
  for (const part of (result.content ?? []) as ReadonlyArray<Record<string, unknown>>) {
    const id = str(part.toolCallId) ?? "";
    switch (part.type) {
      case "text":
        if (str(part.text)) text.push(part.text as string);
        break;
      case "reasoning":
        if (str(part.text)) reasoning.push(part.text as string);
        break;
      case "tool-call":
        calls.push(
          clean<ToolCall>({
            tool_call_id: id,
            tool_name: str(part.toolName) ?? "tool",
            input: asInput(part.input ?? part.args),
            duration_ms: num(toolTime[id]) != null ? Math.round(toolTime[id] as number) : undefined,
          }),
        );
        break;
      case "tool-result":
        observations.push(observation(id, stringify(part.output ?? part.result)));
        break;
      case "tool-error":
        observations.push(observation(id, undefined, errorText(part.error)));
        break;
    }
  }
  if (text.length) step.content = text.join("");
  if (reasoning.length) step.reasoning_content = reasoning.join("\n\n");
  if (model) step.model = model;
  if (calls.length) step.tool_calls = calls;
  if (observations.length) step.observations = observations;
  const tokens = tokenUsage(result.usage);
  if (tokens) step.token_usage = tokens;
  if (started) step.timestamp = started;
  builder.steps.push(step);
  for (const call of calls) builder.patches.push(...patchesFor(step, call));
}

function tokenUsage(raw: unknown) {
  if (!isObject(raw)) return undefined;
  const details = isObject(raw.inputTokenDetails) ? raw.inputTokenDetails : {};
  return usage(
    num(raw.inputTokens),
    num(raw.outputTokens),
    num(details.cacheReadTokens) ?? num(raw.cachedInputTokens),
    num(details.cacheWriteTokens),
  );
}

function finish(builder: Builder, options: AiSdkOptions): TraceRecord {
  const agent = typeof options.agent === "string" ? { name: options.agent } : (options.agent ?? {});
  const task = typeof options.task === "string" ? { description: options.task } : options.task;
  const sessionId = options.sessionId ?? builder.callId ?? "ai-sdk";
  const record = buildRecord({
    sessionId,
    traceId: options.traceId,
    agent: {
      name: agent.name ?? "ai-sdk",
      version: agent.version,
      model: agent.model ?? builder.model,
    },
    steps: builder.steps.map((step) => ({ ...step })),
    patches: builder.patches.length ? [...builder.patches] : undefined,
    start: builder.start,
    end: builder.end,
    task: task?.description,
  });
  if (task) record.task = { ...task, ...record.task };
  return record;
}
