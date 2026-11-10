import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type AlignedPair,
  align,
  branchRuns,
  firstDivergence,
  normalize,
  type Row,
  runKey,
  sideBySide,
  type TraceRecord,
  type TraceView,
  visibleRows,
} from "@tetraslam/kiseki-core";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";
import { type PayloadEntry, TraceContext, type TraceContextValue } from "./context";
import { formatCost, formatDuration, shortModel } from "./format";
import { findOutliers, guessWorkdir } from "./insight";
import { StepRow } from "./StepRow";
import { toggleIn } from "./state";
import { TraceHeader } from "./TraceHeader";
import type { Renderers, TraceLoaders } from "./types";

export interface TraceCompareProps extends Pick<TraceLoaders, "loadPayload" | "loadPatch"> {
  a: TraceRecord;
  b: TraceRecord;
  renderers?: Renderers;
  theme?: "light" | "dark";
  /**
   * `container` (default) scrolls inside, virtualized. `page` grows with the document and renders
   * every pair, so keep it for runs of a few hundred steps.
   */
  scroll?: "container" | "page";
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
  scroll = "container",
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
      sideBySide(
        align(
          leftRows.map((r) => r.view.signature),
          rightRows.map((r) => r.view.signature),
        ),
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
      workdir: guessWorkdir(root),
      outliers: findOutliers(root.steps),
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
          turn={false}
          branchState="loaded"
          onSelect={setSelected}
          onToggleBranch={noop}
        />
      </TraceContext.Provider>
    );

  const same = pairs.filter((p) => p.a != null && p.b != null && !p.changed).length;
  return (
    <section
      className={className ? `kiseki ${className}` : "kiseki"}
      style={style}
      data-theme={theme}
      data-scroll={scroll}
      aria-label="trace comparison"
    >
      <div className="kiseki-compare-head">
        <TraceHeader
          view={left}
          label={shortModel(left.record.agent.model) || left.record.agent.name}
        />
        <TraceHeader
          view={right}
          label={shortModel(right.record.agent.model) || right.record.agent.name}
        />
      </div>
      <Delta
        left={left}
        right={right}
        shared={same}
        divergence={divergence >= 0}
        onJump={() => {
          if (scroll === "container") virtualizer.scrollToIndex(divergence, { align: "start" });
          else
            document
              .querySelectorAll(".kiseki-pair[data-first-divergence]")[0]
              ?.scrollIntoView({ block: "center", behavior: "smooth" });
        }}
      />
      {scroll === "page" ? (
        <div className="kiseki-rows">
          {pairs.map((pair, index) => (
            <Pair
              key={`${pair.a ?? "-"}:${pair.b ?? "-"}`}
              pair={pair}
              first={index === divergence}
              left={side(leftRows, pair.a, leftContext)}
              right={side(rightRows, pair.b, rightContext)}
            />
          ))}
        </div>
      ) : (
        <div className="kiseki-timeline">
          <div className="kiseki-scroll" ref={scrollRef}>
            <div className="kiseki-rows" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const pair = pairs[item.index] as AlignedPair;
                return (
                  <div
                    key={item.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className="kiseki-row"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <Pair
                      pair={pair}
                      first={item.index === divergence}
                      left={side(leftRows, pair.a, leftContext)}
                      right={side(rightRows, pair.b, rightContext)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** What differs between the runs, before any step: steps, time, cost, and where they split. */
function Delta({
  left,
  right,
  shared,
  divergence,
  onJump,
}: {
  left: TraceView;
  right: TraceView;
  shared: number;
  divergence: boolean;
  onJump: () => void;
}) {
  const ratio = (a?: number, b?: number) => (a && b ? b / a : undefined);
  const parts: { label: string; value: string }[] = [];
  const steps = ratio(left.totals.steps, right.totals.steps);
  if (steps) parts.push({ label: "steps", value: `${left.totals.steps} vs ${right.totals.steps}` });
  if (left.totals.durationMs && right.totals.durationMs) {
    parts.push({
      label: "time",
      value: `${formatDuration(left.totals.durationMs)} vs ${formatDuration(right.totals.durationMs)}`,
    });
  }
  if (left.totals.costUsd != null && right.totals.costUsd != null) {
    parts.push({
      label: "cost",
      value: `${formatCost(left.totals.costUsd)} vs ${formatCost(right.totals.costUsd)}`,
    });
  }
  return (
    <div className="kiseki-delta">
      {parts.map((part) => (
        <span key={part.label}>
          {part.label} <b>{part.value}</b>
        </span>
      ))}
      <span>
        <b>{shared}</b> steps matched by tool
      </span>
      <span className="kiseki-delta-key">unmatched</span>
      {divergence && (
        <button type="button" className="kiseki-chip" data-push="" onClick={onJump}>
          jump to where they split
        </button>
      )}
    </div>
  );
}

function Pair({
  pair,
  first,
  left,
  right,
}: {
  pair: AlignedPair;
  first: boolean;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div
      className="kiseki-pair"
      data-diverged={pair.a == null || pair.b == null || pair.changed || undefined}
      data-first-divergence={first || undefined}
    >
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

function allRows(view: TraceView): Row[] {
  const runs = view.steps.flatMap((s) => branchRuns(view, s).map((_, i) => runKey(s.key, i)));
  // Subagent turns show inline; their blocks would only repeat the launching turn.
  return visibleRows(view, { unfolded: new Set(runs) }).filter((row) => !row.head);
}
