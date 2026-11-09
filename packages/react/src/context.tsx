import type { TraceView } from "@tetraslam/kiseki-core";
import { createContext, useContext } from "react";
import type { Renderers, TraceLoaders } from "./types";

export interface PayloadEntry {
  state: "loading" | "loaded" | "error";
  value?: string;
}

export interface TraceContextValue extends TraceLoaders {
  renderers: Renderers;
  live: boolean;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Survives rows unmounting as they scroll away, so a row comes back at the same height. */
  payloads: Map<string, PayloadEntry>;
  /** The model the header already names; steps only show a model that differs from it. */
  traceModel?: string;
  root: TraceView;
  /** The run's working directory, so paths read relative to it. */
  workdir?: string;
  /** Steps whose duration or tokens stand out from the rest of the trace. */
  outliers: Outliers;
}

export interface Outliers {
  duration: ReadonlySet<string>;
  tokens: ReadonlySet<string>;
}

export const TraceContext = createContext<TraceContextValue | null>(null);

export function useTrace(): TraceContextValue {
  const value = useContext(TraceContext);
  if (!value) throw new Error("kiseki components must render inside <Trace> or <TraceCompare>");
  return value;
}

export const callKey = (stepKey: string, callId: string) => `${stepKey}#${callId}`;
export const reasoningKey = (stepKey: string) => `${stepKey}#reasoning`;
export const systemKey = (stepKey: string) => `${stepKey}#system`;
export const patchKey = (stepKey: string, patchId: string) => `${stepKey}#patch:${patchId}`;
