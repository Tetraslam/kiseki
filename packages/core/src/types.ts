// OpenTraces 0.9 TraceRecord, limited to the fields kiseki reads. Unknown fields pass through.
// https://www.opentraces.ai/schema/latest

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  prefix_reuse_tokens?: number;
}

export interface ToolCall {
  tool_call_id: string;
  tool_name: string;
  input?: Record<string, unknown>;
  duration_ms?: number;
}

/**
 * kiseki extension, not in OpenTraces 0.9: an image or file attached to a prompt or returned by
 * a tool. `url` is an http(s) or data: URL. Width and height, when known, let a viewer reserve
 * the image's space before it loads.
 */
export interface Attachment {
  type: "image" | "file";
  media_type?: string;
  url?: string;
  name?: string;
  width?: number;
  height?: number;
}

export interface Observation {
  source_call_id: string;
  content?: string;
  output_summary?: string;
  error?: string;
  attachments?: Attachment[];
}

export type StepRole = "system" | "user" | "agent";
export type CallType = "main" | "subagent" | "warmup";

export interface Step {
  step_index: number;
  role: StepRole;
  content?: string;
  reasoning_content?: string;
  model?: string;
  system_prompt_hash?: string;
  agent_role?: string;
  parent_step?: number;
  call_type?: CallType;
  subagent_trajectory_ref?: string;
  tools_available?: string[];
  tool_calls?: ToolCall[];
  observations?: Observation[];
  token_usage?: TokenUsage;
  timestamp?: string;
  /** kiseki extension: images and files attached to this turn, such as a pasted screenshot. */
  attachments?: Attachment[];
  [key: string]: unknown;
}

export interface Patch {
  patch_id: string;
  file_path: string;
  step_index?: number | null;
  tool_call_id?: string | null;
  capture_method?: string[];
  snapshot_before_id?: string | null;
  snapshot_after_id?: string | null;
  limitations?: string[];
  [key: string]: unknown;
}

export interface Outcome {
  success?: boolean;
  signal_source?: string;
  signal_confidence?: string;
  description?: string;
  committed?: boolean;
  commit_sha?: string;
  terminal_state?: string | null;
  reward?: number | null;
  reward_source?: string | null;
}

export interface Metrics {
  total_steps?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_duration_s?: number;
  cache_hit_rate?: number;
  estimated_cost_usd?: number;
  total_cache_read_tokens?: number;
  total_cache_creation_tokens?: number;
}

export interface Agent {
  name: string;
  version?: string;
  model?: string;
}

export interface Task {
  description?: string;
  source?: string;
  repository?: string;
  base_commit?: string;
  repository_url?: string;
}

export interface TraceRecord {
  schema_version: string;
  trace_id: string;
  session_id: string;
  timestamp_start?: string;
  timestamp_end?: string;
  task?: Task;
  agent: Agent;
  environment?: Record<string, unknown>;
  system_prompts?: Record<string, string>;
  tool_definitions?: Record<string, unknown>[];
  steps?: Step[];
  outcome?: Outcome;
  metrics?: Metrics;
  metadata?: Record<string, unknown>;
  execution_context?: string | null;
  generation_index?: number;
  patches?: Patch[];
  [key: string]: unknown;
}
