import type {
  CallStatus,
  Observation,
  PairedCall,
  Patch,
  Row,
  Step,
  ToolCall,
  TraceRecord,
  TraceView,
  ViewStep,
} from "@tetraslam/kiseki-core";
import type { ComponentType, ReactNode } from "react";

/** What a patch renderer needs: a unified patch, or the file before and after. */
export type PatchContent =
  | { patch: string; before?: undefined; after?: undefined }
  | { patch?: undefined; before: string | null; after: string | null };

export interface ToolRendererProps {
  call: ToolCall;
  observation?: Observation;
  status: CallStatus;
  step: Step;
  /** The step's key, for building expansion keys of nested blocks. */
  stepKey: string;
  paired: PairedCall;
  patches: Patch[];
  /** The full observation content: from the record, or from `loadPayload` once expanded. */
  payload?: string;
  payloadState: "idle" | "loading" | "loaded" | "error";
  expanded: boolean;
  onToggle: () => void;
  /** kiseki's own renderer, for wrapping instead of replacing. */
  Default: ComponentType<ToolRendererProps>;
}

export interface StepRendererProps {
  view: ViewStep;
  row: Row;
  trace: TraceView;
}

export interface PatchRendererProps {
  patch: Patch;
  call?: PairedCall;
  content?: PatchContent;
}

export interface Renderers {
  /** Custom renderers keyed by `tool_name`. */
  tools?: Record<string, ComponentType<ToolRendererProps>>;
  /** Used for any tool without its own renderer. Defaults to kiseki's tool call block. */
  fallback?: ComponentType<ToolRendererProps>;
  user?: ComponentType<StepRendererProps>;
  system?: ComponentType<StepRendererProps>;
  /** The agent's message text. Defaults to markdown through streamdown. */
  message?: ComponentType<{ text: string; view: ViewStep; streaming: boolean }>;
  reasoning?: ComponentType<{
    text: string;
    view: ViewStep;
    expanded: boolean;
    onToggle: () => void;
  }>;
  patch?: ComponentType<PatchRendererProps>;
}

export interface TraceLoaders {
  /** Full observation content for a call whose record holds only `output_summary`. */
  loadPayload?: (stepIndex: number, callId: string) => Promise<string | undefined>;
  /** Resolves a `subagent_trajectory_ref` to its own record. */
  loadTrace?: (ref: string) => Promise<TraceRecord>;
  /** Diff content for a patch that carries none and whose tool call input can't produce one. */
  loadPatch?: (patch: Patch) => Promise<PatchContent | undefined>;
}

export interface TraceHandle {
  /** Adds steps to the end of the trace, as a live run produces them. */
  append: (steps: Step[]) => void;
  /** Selects a step and scrolls it into view, unfolding branches above it. */
  scrollToStep: (key: string) => void;
  focus: () => void;
}

export type { ReactNode };
