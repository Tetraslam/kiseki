import {
  useVirtualizer,
  useWindowVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
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
  /**
   * Holds the element the reader just clicked (or the selected row) still on screen while the
   * rows around it change size, then lets go.
   */
  anchor: (fallbackKey?: string | null) => void;
}

export interface TimelineProps {
  rows: Row[];
  selected: string | null;
  matches: ReadonlySet<string>;
  branchStates: ReadonlyMap<string, BranchState>;
  live: boolean;
  /** `container` scrolls inside the trace; `page` scrolls with the document. */
  scroll: "container" | "page";
  onSelect: (key: string) => void;
  onToggleBranch: (key: string) => void;
  /** The first and last step the reader can see, as they scroll. */
  onVisible?: (range: { from: string; to: string } | null) => void;
  empty?: ReactNode;
  handle?: Ref<TimelineHandle>;
  /** Fires after the first rows are committed; the perf script marks first paint from here. */
  onFirstRows?: () => void;
}

/** A rough height before a row is measured. Close guesses keep the scrollbar from jumping. */
function estimate(row: Row): number {
  const { step } = row.view;
  let height = 12;
  const text = step.content ?? "";
  if (text) {
    const lines = text.split("\n").length + Math.floor(text.length / 90);
    height += Math.min(lines, 40) * 20 + 4;
  }
  if (step.reasoning_content) height += 22;
  height += row.view.calls.length * 26;
  if (row.branch) height += 30;
  if (step.role === "user") height += 12;
  return Math.max(height, 30);
}

/** Enough rows to fill a tall viewport before anything is measured. */
function openingRows(rows: Row[]): Row[] {
  let height = 0;
  let count = 0;
  while (count < rows.length && height < 700) height += estimate(rows[count++] as Row);
  return rows.slice(0, count);
}

export function Timeline(props: TimelineProps) {
  return props.scroll === "page" ? <PageTimeline {...props} /> : <ContainerTimeline {...props} />;
}

function ContainerTimeline(props: TimelineProps) {
  const { rows, live } = props;
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
    overscan: 3,
  });
  const scrollBy = useCallback((delta: number) => {
    if (scrollRef.current) scrollRef.current.scrollTop += delta;
  }, []);
  return (
    <div className="kiseki-timeline">
      <div className="kiseki-scroll" ref={setScroll} data-live={live || undefined}>
        <Rows
          {...props}
          virtualizer={virtualizer}
          margin={0}
          contentRef={setContent}
          scrollBy={scrollBy}
          stopFollowing={() => live && stick.stopScroll()}
        />
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

function PageTimeline(props: TimelineProps) {
  const { rows, live } = props;
  const list = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const top = list.current?.getBoundingClientRect().top;
      if (top != null) setMargin(top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => estimate(rows[index] as Row),
    getItemKey: (index) => (rows[index] as Row).view.key,
    overscan: 3,
    scrollMargin: margin,
  });
  const scrollBy = useCallback((delta: number) => window.scrollBy(0, delta), []);

  // Follow the tail only while its end is on screen; never pull the page there on its own.
  const [following, setFollowing] = useState(false);
  const tailVisible = useCallback(() => {
    const bottom = list.current?.getBoundingClientRect().bottom;
    return bottom != null && bottom <= window.innerHeight + 160;
  }, []);
  useEffect(() => {
    if (!live) return;
    setFollowing(tailVisible());
    let last = window.scrollY;
    const onScroll = () => {
      const up = window.scrollY < last;
      last = window.scrollY;
      if (up) setFollowing(false);
      else if (tailVisible()) setFollowing(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [live, tailVisible]);
  useLayoutEffect(() => {
    if (!live || !following || !rows.length) return;
    const bottom = list.current?.getBoundingClientRect().bottom ?? 0;
    const overflow = bottom - window.innerHeight + 24;
    if (overflow > 0) window.scrollBy({ top: overflow });
  }, [live, following, rows.length]);

  return (
    <div className="kiseki-timeline" ref={list}>
      <Rows
        {...props}
        virtualizer={virtualizer}
        margin={margin}
        scrollBy={scrollBy}
        stopFollowing={() => setFollowing(false)}
      />
      {live && (
        <button
          type="button"
          className="kiseki-follow"
          data-hidden={following || undefined}
          tabIndex={following ? -1 : 0}
          onClick={() => {
            setFollowing(true);
            const bottom = list.current?.getBoundingClientRect().bottom ?? 0;
            window.scrollBy({ top: bottom - window.innerHeight + 24 });
          }}
        >
          follow live
        </button>
      )}
    </div>
  );
}

interface RowsProps extends TimelineProps {
  virtualizer: Virtualizer<Window, Element> | Virtualizer<HTMLDivElement, Element>;
  margin: number;
  contentRef?: (node: HTMLDivElement | null) => void;
  scrollBy: (delta: number) => void;
  stopFollowing: () => void;
}

function Rows({
  rows,
  selected,
  matches,
  branchStates,
  live,
  onSelect,
  onToggleBranch,
  onVisible,
  empty,
  handle,
  onFirstRows,
  virtualizer,
  margin,
  contentRef,
  scrollBy,
  stopFollowing,
}: RowsProps) {
  const container = useRef<HTMLDivElement | null>(null);
  // Stable, so use-stick-to-bottom's resize observer stays attached across renders.
  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      container.current = node;
      contentRef?.(node);
    },
    [contentRef],
  );

  // Anchoring: a click remembers its element; growth around it is scrolled away until it settles.
  const pointer = useRef<{ el: Element; at: number } | null>(null);
  const anchoring = useRef(0);
  // The library's default (adjust only for rows wholly above the viewport, not while scrolling
  // back), switched off while a click is anchored so the two corrections don't fight.
  useLayoutEffect(() => {
    (
      virtualizer as unknown as Virtualizer<Element, Element>
    ).shouldAdjustScrollPositionOnItemSizeChange = (
      item: VirtualItem,
      _delta: number,
      instance: Virtualizer<Element, Element>,
    ) =>
      performance.now() > anchoring.current &&
      item.end <= (instance.scrollOffset ?? 0) &&
      instance.scrollDirection !== "backward";
  }, [virtualizer]);
  const anchor = useCallback(
    (fallbackKey?: string | null) => {
      const recent = pointer.current && performance.now() - pointer.current.at < 1000;
      const el =
        (recent ? pointer.current?.el : undefined) ??
        (fallbackKey
          ? container.current?.querySelector(`[data-key="${CSS.escape(fallbackKey)}"]`)
          : null);
      if (!el?.isConnected) return;
      stopFollowing();
      const top = el.getBoundingClientRect().top;
      const until = performance.now() + 480;
      anchoring.current = until;
      const hold = () => {
        if (!el.isConnected) return;
        const delta = el.getBoundingClientRect().top - top;
        if (Math.abs(delta) >= 0.5) scrollBy(delta);
        if (performance.now() < until) requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
    },
    [scrollBy, stopFollowing],
  );

  useImperativeHandle(
    handle,
    () => ({
      scrollToIndex: (index) => {
        stopFollowing();
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
      anchor,
    }),
    [virtualizer, anchor, stopFollowing],
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

  const items = virtual ? virtualizer.getVirtualItems() : [];

  // Report what the reader can see, once per frame at most.
  const frame = useRef(0);
  const offset = virtualizer.scrollOffset ?? 0;
  const viewport = virtualizer.scrollRect?.height ?? 0;
  useEffect(() => {
    if (!onVisible || !virtual) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const top = offset;
      const bottom = offset + viewport;
      const shown = virtualizer
        .getVirtualItems()
        .filter((item) => item.end > top && item.start < bottom);
      const first = shown[0];
      const last = shown.at(-1);
      onVisible(
        first && last
          ? { from: (rows[first.index] as Row).view.key, to: (rows[last.index] as Row).view.key }
          : null,
      );
    });
  }, [offset, viewport, rows, virtual, onVisible, virtualizer]);

  const renderRow = (row: Row, index: number) => {
    const previous = rows[index - 1];
    const turn =
      index > 0 &&
      row.view.step.role === "user" &&
      row.view.step.call_type !== "subagent" &&
      row.depth === 0 &&
      previous != null;
    return (
      <StepRow
        row={row}
        turn={turn}
        selected={selected === row.view.key}
        match={matches.has(row.view.key)}
        branchState={branchStates.get(row.view.key) ?? "idle"}
        onSelect={onSelect}
        onToggleBranch={onToggleBranch}
        timing={index === 0}
      />
    );
  };

  if (rows.length === 0) return <>{empty}</>;
  return (
    // One container and the same keys in both passes, so React keeps the opening rows when the
    // virtualizer takes over instead of mounting them again.
    <div
      ref={setContainer}
      className="kiseki-rows"
      style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
      onPointerDownCapture={(event) => {
        const target = (event.target as Element).closest("button, [data-key]");
        if (target) pointer.current = { el: target, at: performance.now() };
      }}
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
                style={{ transform: `translateY(${item.start - margin}px)` }}
              >
                {renderRow(row, item.index)}
              </div>
            );
          })
        : openingRows(rows).map((row, index) => (
            <div key={row.view.key} data-key={row.view.key} className="kiseki-row" data-flow="">
              {renderRow(row, index)}
            </div>
          ))}
    </div>
  );
}
