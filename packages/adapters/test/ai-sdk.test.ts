import { normalize, validateTrace } from "@tetraslam/kiseki-core";
import { generateText, jsonSchema, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { createTraceRecorder, fromSteps } from "../src/ai-sdk";
import { detect } from "../src/index";

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input - 4, cacheRead: 4, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const responses = () => [
  {
    content: [
      { type: "reasoning" as const, text: "I need the weather first." },
      { type: "text" as const, text: "Checking." },
      {
        type: "tool-call" as const,
        toolCallId: "c1",
        toolName: "weather",
        input: '{"city":"Oslo"}',
      },
      {
        type: "tool-call" as const,
        toolCallId: "c2",
        toolName: "edit",
        input: '{"file_path":"notes.md","old_string":"cold","new_string":"warm"}',
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
    usage: usage(40, 12),
    warnings: [],
  },
  {
    content: [{ type: "text" as const, text: "It is 20 degrees in Oslo." }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: usage(80, 9),
    warnings: [],
  },
];

const tools = {
  weather: tool({
    inputSchema: jsonSchema<{ city: string }>({
      type: "object",
      properties: { city: { type: "string" } },
    }),
    execute: async ({ city }) => ({ city, celsius: 20 }),
  }),
  edit: tool({
    inputSchema: jsonSchema<{ file_path: string; old_string: string; new_string: string }>({
      type: "object",
    }),
    execute: async (): Promise<string> => {
      throw new Error("notes.md is read-only");
    },
  }),
};

function model() {
  const queue = responses();
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-1",
    doGenerate: async () => queue.shift() ?? (responses()[1] as never),
  });
}

describe("ai-sdk", () => {
  it("records real generateText steps with tools, an error, and reasoning", async () => {
    const recorder = createTraceRecorder({ agent: "weather-bot", system: "Be brief." });
    const result = await generateText({
      model: model(),
      tools,
      prompt: "Weather in Oslo?",
      stopWhen: stepCountIs(5),
      onStepFinish: recorder.onStepFinish,
    });
    expect(result.steps).toHaveLength(2);

    const live = recorder.record();
    const fromResult = fromSteps(result.steps, {
      agent: "weather-bot",
      system: "Be brief.",
      prompt: "Weather in Oslo?",
    });
    for (const record of [live, fromResult]) {
      const { record: valid, issues } = validateTrace(record);
      expect(issues).toEqual([]);
      expect(valid).not.toBeNull();
    }

    const steps = fromResult.steps ?? [];
    expect(steps.map((step) => step.role)).toEqual(["system", "user", "agent", "agent"]);
    const first = steps[2];
    expect(first?.reasoning_content).toBe("I need the weather first.");
    expect(first?.content).toBe("Checking.");
    expect(first?.model).toBe("mock/mock-1");
    expect(first?.tool_calls?.map((call) => [call.tool_call_id, call.tool_name])).toEqual([
      ["c1", "weather"],
      ["c2", "edit"],
    ]);
    expect(first?.tool_calls?.[0]?.input).toEqual({ city: "Oslo" });
    expect(first?.tool_calls?.[0]?.duration_ms).toBeTypeOf("number");
    expect(first?.observations?.find((o) => o.source_call_id === "c1")?.content).toContain(
      '"celsius": 20',
    );
    expect(first?.observations?.find((o) => o.source_call_id === "c2")?.error).toBe(
      "notes.md is read-only",
    );
    expect(first?.token_usage).toEqual({
      input_tokens: 40,
      output_tokens: 12,
      cache_read_tokens: 4,
    });
    expect(fromResult.patches).toEqual([
      { patch_id: "c2", file_path: "notes.md", step_index: 2, tool_call_id: "c2" },
    ]);
    expect(fromResult.task?.description).toBe("Weather in Oslo?");
    expect(fromResult.agent).toEqual({ name: "weather-bot", model: "mock/mock-1" });
    expect(fromResult.metrics?.total_input_tokens).toBe(120);

    // A file of serialized steps, e.g. `JSON.stringify(result.steps)`, is detected and converted.
    const dropped = detect(JSON.stringify(result.steps));
    expect(dropped?.format).toBe("ai-sdk");
    expect(dropped?.records[0]?.steps?.map((step) => step.tool_calls?.length ?? 0)).toEqual([2, 0]);

    const view = normalize(fromResult);
    const calls = view.steps.flatMap((step) => step.calls);
    expect(calls.every((call) => call.observation)).toBe(true);
  });

  it("records streamText steps", async () => {
    const recorder = createTraceRecorder({ prompt: "Say hi" });
    const result = streamText({
      model: new MockLanguageModelV4({
        provider: "mock",
        modelId: "mock-1",
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "reasoning-start", id: "r" },
              { type: "reasoning-delta", id: "r", delta: "short" },
              { type: "reasoning-end", id: "r" },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Hi" },
              { type: "text-delta", id: "t", delta: " there" },
              { type: "text-end", id: "t" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: usage(10, 2),
              },
            ],
          }),
        }),
      }),
      prompt: "Say hi",
      onStepFinish: recorder.onStepFinish,
    });
    await result.consumeStream();
    const record = recorder.record();
    expect(validateTrace(record).issues).toEqual([]);
    expect(record.steps?.[1]).toMatchObject({
      role: "agent",
      content: "Hi there",
      reasoning_content: "short",
    });
  });
});
