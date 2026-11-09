import type { ViewStep } from "./normalize";

const haystacks = new WeakMap<ViewStep, string>();

/**
 * The searchable text of a step: content, reasoning, tool names, inputs, summaries, and whatever
 * observation content the record already holds. Payloads loaded later are not searched.
 */
export function searchText(view: ViewStep): string {
  let text = haystacks.get(view);
  if (text != null) return text;
  const { step } = view;
  const parts: string[] = [];
  if (step.content) parts.push(step.content);
  if (step.reasoning_content) parts.push(step.reasoning_content);
  for (const { call, observation } of view.calls) {
    parts.push(call.tool_name);
    if (call.input && Object.keys(call.input).length) parts.push(JSON.stringify(call.input));
    if (observation?.output_summary) parts.push(observation.output_summary);
    if (observation?.content) parts.push(observation.content);
    if (observation?.error) parts.push(observation.error);
  }
  for (const observation of view.strayObservations) {
    if (observation.output_summary) parts.push(observation.output_summary);
    if (observation.content) parts.push(observation.content);
  }
  for (const patch of view.patches) parts.push(patch.file_path);
  text = parts.join("\n").toLowerCase();
  haystacks.set(view, text);
  return text;
}

/** Steps matching every whitespace-separated term, case-insensitively, in the given order. */
export function searchSteps(steps: Iterable<ViewStep>, query: string): ViewStep[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: ViewStep[] = [];
  for (const step of steps) {
    const text = searchText(step);
    if (terms.every((term) => text.includes(term))) hits.push(step);
  }
  return hits;
}
