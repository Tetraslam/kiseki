import { useVirtualizer } from "@tanstack/react-virtual";
import type { Row } from "@tetraslam/kiseki-core";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { type BranchState, StepRow } from "./StepRow";

export interface TimelineHandle {
  scrollToIndex: (index: number) => void;
}

export interface TimelineProps {
  rows: Row[];
  selected: string | null;
  matches: ReadonlySet<string>;
  branchStates: ReadonlyMap<string, BranchState>;
  live: boolean;
  onSelect: (key: string) => void;
  onToggleBranch: (key: string) => void;
  /** Rendered when there are no steps. */
  empty?: ReactNode;
  handle?: Ref<TimelineHandle>;
  /** Fires after the first rows are committed; the perf script marks first paint from here. */
  onFirstRows?: () => void;
}

/** A rough height before a row is measured. Close guesses keep the scrollbar from jumping. */
function estimate(row: Row): number {
  const { step } = row.view;
  let height = 46;
  const text = step.content ?? "";
  if (text) {
    const lines = text.split("\n").length + Math.floor(text.length / 90);
    height += step.role === "user" ? 18 + lines * 20 : Math.min(lines, 40) * 20 + 6;
  }
  if (step.reasoning_content) height += 28;
  height += row.view.calls.length * 28;
  if (row.branch) height += 32;
  return height;
}

/** Enough rows to fill a tall viewport before anything is measured. */
function openingRows(rows: Row[]): Row[] {
  let height = 0;
  let count = 0;
  while (count < rows.length && height < 1000) height += estimate(rows[count++] as Row);
  return rows.slice(0, count);
}

/**
 * The virtualized step list. Rows are measured as they mount and positioned with transforms, so
 * a row that grows pushes only the rows below it. In live mode the view follows the tail until
 * the user scrolls up.
 */
export function Timeline({
  rows,
  selected,
  matches,
  branchStates,
  live,
  onSelect,
  onToggleBranch,
  empty,
  handle,
  onFirstRows,
}: TimelineProps) {
  const stick = useStickToBottom({ initial: "instant", resize: "smooth" });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScroll = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (live) stick.scrollRef(node);
    },
    [live, stick.scrollRef],
  );
  const setContent = useCallback(
    (node: HTMLDivElement | null) => {
      if (live) stick.contentRef(node);
    },
    [live, stick.contentRef],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimate(rows[index] as Row),
    getItemKey: (index) => (rows[index] as Row).view.key,
    overscan: 6,
  });

  useImperativeHandle(
    handle,
    () => ({
      scrollToIndex: (index) => {
        if (live) stick.stopScroll();
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
    }),
    [virtualizer, live, stick],
  );

  // Rows that arrive while live animate in once. Rows present at mount never do.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(rows.map((row) => row.view.key));
  const fresh = new Set<string>();
  if (live) for (const row of rows) if (!seen.current.has(row.view.key)) fresh.add(row.view.key);
  useEffect(() => {
    for (const key of fresh) seen.current?.add(key);
  });

  const reported = useRef(false);
  useLayoutEffect(() => {
    if (!reported.current && rows.length) {
      reported.current = true;
      onFirstRows?.();
    }
  });

  // The server and the first client pass render the opening rows in normal flow, so the first
  // paint is the real trace. The virtualizer takes over in a layout effect, before the browser
  // paints, and measures the same rows into the same places.
  const [virtual, setVirtual] = useState(false);
  useLayoutEffect(() => setVirtual(true), []);

  const items = virtualizer.getVirtualItems();
  const opening = virtual ? [] : openingRows(rows);
  const renderRow = (row: Row) => (
    <StepRow
      row={row}
      selected={selected === row.view.key}
      match={matches.has(row.view.key)}
      branchState={branchStates.get(row.view.key) ?? "idle"}
      onSelect={onSelect}
      onToggleBranch={onToggleBranch}
    />
  );
  return (
    <div className="kiseki-timeline">
      <div className="kiseki-scroll" ref={setScroll} data-live={live || undefined}>
        {rows.length === 0 ? (
          empty
        ) : (
          // One container and the same keys in both passes, so React keeps the opening rows when
          // the virtualizer takes over instead of mounting them again.
          <div
            ref={virtual ? setContent : undefined}
            className="kiseki-rows"
            style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
          >
            {virtual
              ? items.map((item) => {
                  const row = rows[item.index] as Row;
                  const key = row.view.key;
                  return (
                    <div
                      key={key}
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                      data-key={key}
                      data-new={fresh.has(key) || undefined}
                      className="kiseki-row"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      {renderRow(row)}
                    </div>
                  );
                })
              : opening.map((row) => (
                  <div
                    key={row.view.key}
                    data-key={row.view.key}
                    className="kiseki-row"
                    data-flow=""
                  >
                    {renderRow(row)}
                  </div>
                ))}
          </div>
        )}
      </div>
      {live && (
        <button
          type="button"
          className="kiseki-follow"
          data-hidden={stick.isAtBottom || undefined}
          tabIndex={stick.isAtBottom ? -1 : 0}
          onClick={() => stick.scrollToBottom()}
        >
          follow live
        </button>
      )}
    </div>
  );
}
