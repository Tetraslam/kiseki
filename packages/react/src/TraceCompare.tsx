import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type AlignedPair,
  align,
  firstDivergence,
  normalize,
  type Row,
  type TraceRecord,
  type TraceView,
  visibleRows,
} from "@tetraslam/kiseki-core";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";
import { type PayloadEntry, TraceContext, type TraceContextValue } from "./context";
import { StepRow } from "./StepRow";
import { toggleIn } from "./state";
import { TraceHeader } from "./TraceHeader";
import type { Renderers, TraceLoaders } from "./types";

export interface TraceCompareProps extends Pick<TraceLoaders, "loadPayload" | "loadPatch"> {
  a: TraceRecord;
  b: TraceRecord;
  renderers?: Renderers;
  theme?: "light" | "dark";
  className?: string;
  style?: CSSProperties;
}

/**
 * Two runs side by side, aligned by step signature (role plus tool names) through a longest
 * common subsequence. Steps only one run took sit across from a gap and are tinted, and the first
 * divergence is labeled.
 */
export function TraceCompare({
  a,
  b,
  renderers,
  loadPayload,
  loadPatch,
  theme,
  className,
  style,
}: TraceCompareProps) {
  const left = useMemo(() => normalize(a, { keyPrefix: "a:" }), [a]);
  const right = useMemo(() => normalize(b, { keyPrefix: "b:" }), [b]);
  // Branches open: comparing runs means comparing every step.
  const leftRows = useMemo(() => allRows(left), [left]);
  const rightRows = useMemo(() => allRows(right), [right]);
  const pairs = useMemo(
    () =>
      align(
        leftRows.map((r) => r.view.signature),
        rightRows.map((r) => r.view.signature),
      ),
    [leftRows, rightRows],
  );
  const divergence = useMemo(() => firstDivergence(pairs), [pairs]);

  const [expanded, setExpanded] = useState<string[]>([]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = useCallback((key: string) => setExpanded((prev) => toggleIn(prev, [key])), []);
  const payloads = useRef(new Map<string, PayloadEntry>()).current;
  const [leftContext, rightContext] = useMemo(() => {
    const contextFor = (root: TraceView): TraceContextValue => ({
      renderers: renderers ?? {},
      live: false,
      loadPayload,
      loadPatch,
      isExpanded: (key) => expandedSet.has(key),
      toggle,
      payloads,
      traceModel: root.record.agent.model,
      root,
    });
    return [contextFor(left), contextFor(right)];
  }, [left, right, expandedSet, renderers, loadPayload, loadPatch, toggle, payloads]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: pairs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    getItemKey: (index) => {
      const pair = pairs[index] as AlignedPair;
      return `${pair.a ?? "-"}:${pair.b ?? "-"}`;
    },
    overscan: 6,
  });

  const noop = useCallback(() => {}, []);
  const side = (rows: Row[], position: number | undefined, ctx: TraceContextValue) =>
    position == null ? (
      <div className="kiseki-gap" />
    ) : (
      <TraceContext.Provider value={ctx}>
        <StepRow
          row={rows[position] as Row}
          selected={selected === (rows[position] as Row).view.key}
          match={false}
          branchState="loaded"
          onSelect={setSelected}
          onToggleBranch={noop}
        />
      </TraceContext.Provider>
    );

  const same = pairs.filter((p) => p.a != null && p.b != null).length;
  return (
    <section
      className={className ? `kiseki ${className}` : "kiseki"}
      style={style}
      data-theme={theme}
      aria-label="trace comparison"
    >
      <div className="kiseki-compare-head">
        <TraceHeader view={left} />
        <TraceHeader view={right} />
      </div>
      <div className="kiseki-toolbar">
        <span className="kiseki-num">
          {same} shared · {leftRows.length - same} only left · {rightRows.length - same} only right
        </span>
        {divergence >= 0 && (
          <button
            type="button"
            className="kiseki-toggle"
            style={{ marginLeft: "auto" }}
            onClick={() => virtualizer.scrollToIndex(divergence, { align: "start" })}
          >
            jump to first divergence
          </button>
        )}
      </div>
      <div className="kiseki-timeline">
        <div className="kiseki-scroll" ref={scrollRef}>
          <div className="kiseki-rows" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const pair = pairs[item.index] as AlignedPair;
              const diverged = pair.a == null || pair.b == null;
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="kiseki-row"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div
                    className="kiseki-pair"
                    data-diverged={diverged || undefined}
                    data-first-divergence={item.index === divergence || undefined}
                  >
                    <div>{side(leftRows, pair.a, leftContext)}</div>
                    <div>{side(rightRows, pair.b, rightContext)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function allRows(view: TraceView): Row[] {
  const heads = view.steps.filter((s) => s.children.length).map((s) => s.key);
  return visibleRows(view, { unfolded: new Set(heads) });
}
