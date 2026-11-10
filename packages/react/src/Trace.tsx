import {
  ancestorsOf,
  branchRuns,
  layoutOverview,
  normalize,
  overviewLaneCount,
  type Row,
  runKey,
  type Step,
  searchSteps,
  type TraceRecord,
  type TraceView,
  type ViewStep,
  visibleRows,
} from "@tetraslam/kiseki-core";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  callKey,
  type PayloadEntry,
  patchKey,
  reasoningKey,
  systemKey,
  TraceContext,
  type TraceContextValue,
} from "./context";
import { formatDuration, oneLine } from "./format";
import { findOutliers, guessWorkdir } from "./insight";
import type { BranchState } from "./StepRow";
import { toggleIn, useControllable, useLatest } from "./state";
import { Timeline, type TimelineHandle } from "./Timeline";
import { TraceHeader } from "./TraceHeader";
import { type OverviewHandle, TraceOverview } from "./TraceOverview";
import type { Renderers, TraceHandle, TraceLoaders } from "./types";

export interface TraceProps extends TraceLoaders {
  record: TraceRecord;
  /** The record is still growing: unanswered calls are pending and the view follows the tail. */
  live?: boolean;
  renderers?: Renderers;

  selectedStep?: string | null;
  defaultSelectedStep?: string | null;
  onSelectStep?: (key: string | null) => void;
  /** Keys of open blocks: `12#reasoning`, `12#<tool_call_id>`, `12#patch:<patch_id>`. */
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (keys: string[]) => void;
  /** Keys of unfolded branch heads. Branches start folded. */
  unfolded?: string[];
  defaultUnfolded?: string[];
  onUnfoldedChange?: (keys: string[]) => void;
  search?: string;
  defaultSearch?: string;
  onSearchChange?: (query: string) => void;

  /** The link `c` copies. Defaults to the current URL with `#step=<key>`. */
  permalink?: (key: string) => string;
  /** `false` hides the header; a node replaces it. */
  header?: boolean | ReactNode;
  toolbar?: boolean;
  /**
   * The trajectory overview: a map of the run over time. `true` (default) offers it behind a
   * toggle in the bar, closed; `"open"` starts it open; `false` removes it. When open it floats
   * over the trace instead of pushing it down.
   */
  overview?: boolean | "open";
  /** How agent text and reasoning read: at full weight (default) or quieter. */
  prose?: "full" | "quiet";
  /**
   * `container` (default) scrolls inside the trace, which then needs a height. `page` lets the
   * trace grow with the document and scroll with it; the overview and search stay pinned.
   */
  scroll?: "container" | "page";
  /** In page mode, how far below the top of the viewport the pinned bar sits (a site header). */
  stickyTop?: number;
  /** `scoped` listens while the trace has focus; `global` listens on the window. */
  keyboard?: "scoped" | "global" | false;
  theme?: "light" | "dark";
  /** Shown when the record has no steps. */
  empty?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<TraceHandle>;
  /** Fires once the first rows are committed, before the browser paints them. */
  onFirstRows?: () => void;
}

interface Located {
  view: ViewStep;
  trace: TraceView;
}

const HASH = "#step=";

/** The whole viewer: header, toolbar, and the virtualized timeline. */
export function Trace(props: TraceProps) {
  const {
    record,
    live = false,
    renderers,
    loadPayload,
    loadTrace,
    loadPatch,
    permalink,
    header = true,
    toolbar = true,
    overview: overviewProp = true,
    prose = "full",
    scroll = "container",
    stickyTop = 0,
    keyboard = "scoped",
    theme,
    empty,
    className,
    style,
    onFirstRows,
  } = props;

  // Steps added through the handle. Steps the record already has win.
  const [appended, setAppended] = useState<Step[]>([]);
  const merged = useMemo(() => {
    if (!appended.length) return record;
    const have = new Set((record.steps ?? []).map((s) => s.step_index));
    const add = appended.filter((s) => !have.has(s.step_index));
    return add.length ? { ...record, steps: [...(record.steps ?? []), ...add] } : record;
  }, [record, appended]);
  const view = useMemo(() => normalize(merged, { live }), [merged, live]);

  const [loaded, setLoaded] = useState<ReadonlyMap<string, TraceView>>(() => new Map());
  const [branchStates, setBranchStates] = useState<ReadonlyMap<string, BranchState>>(
    () => new Map(),
  );

  const [unfoldedList, setUnfolded] = useControllable(
    props.unfolded,
    props.defaultUnfolded ?? [],
    props.onUnfoldedChange,
  );
  const unfolded = useMemo(() => new Set(unfoldedList), [unfoldedList]);
  const [expandedList, setExpanded] = useControllable(
    props.expanded,
    props.defaultExpanded ?? [],
    props.onExpandedChange,
  );
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const [selected, setSelected] = useControllable<string | null>(
    props.selectedStep,
    props.defaultSelectedStep ?? null,
    props.onSelectStep,
  );
  const [query, setQuery] = useControllable(
    props.search,
    props.defaultSearch ?? "",
    props.onSearchChange,
  );
  const deferredQuery = useDeferredValue(query);

  const rows = useMemo(() => visibleRows(view, { unfolded, loaded }), [view, unfolded, loaded]);

  // Every step, nested traces included, in reading order, plus who owns each nested trace.
  const { all, byKey, owners } = useMemo(() => {
    const all: Located[] = [];
    const byKey = new Map<string, Located>();
    const owners = new Map<TraceView, Located>();
    const walk = (trace: TraceView, indices: number[]) => {
      for (const index of indices) {
        const step = trace.byIndex.get(index);
        if (!step) continue;
        const located = { view: step, trace };
        all.push(located);
        byKey.set(step.key, located);
        walk(trace, step.children);
        const ref = step.step.subagent_trajectory_ref;
        const nested = ref ? loaded.get(ref) : undefined;
        if (nested) {
          owners.set(nested, located);
          walk(nested, nested.roots);
        }
      }
    };
    walk(view, view.roots);
    return { all, byKey, owners };
  }, [view, loaded]);

  const ancestors = useCallback(
    (located: Located): string[] => {
      const keys = ancestorsOf(located.trace, located.view);
      const owner = owners.get(located.trace);
      return owner ? [...ancestors(owner), runKey(owner.view.key, 0), ...keys] : keys;
    },
    [owners],
  );

  const matches = useMemo(
    () =>
      deferredQuery.trim()
        ? searchSteps(
            all.map((l) => l.view),
            deferredQuery,
          ).map((s) => s.key)
        : [],
    [all, deferredQuery],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  // Load subagent traces as their branches unfold.
  const loadTraceRef = useLatest(loadTrace);
  useEffect(() => {
    for (const run of unfolded) {
      const key = headOf(run);
      const located = byKey.get(key);
      const ref = located?.view.step.subagent_trajectory_ref;
      if (!ref || loaded.has(ref) || branchStates.has(key)) continue;
      const load = loadTraceRef.current;
      if (!load) {
        setBranchStates((prev) => new Map(prev).set(key, "error"));
        continue;
      }
      setBranchStates((prev) => new Map(prev).set(key, "loading"));
      load(ref).then(
        (child) => {
          setLoaded((prev) => new Map(prev).set(ref, normalize(child, { keyPrefix: `${ref}/` })));
          setBranchStates((prev) => new Map(prev).set(key, "loaded"));
        },
        () => setBranchStates((prev) => new Map(prev).set(key, "error")),
      );
    }
  }, [unfolded, byKey, loaded, branchStates]);

  // Scrolling waits for the rows that reveal a step to exist.
  const timeline = useRef<TimelineHandle>(null);
  const pendingScroll = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = pendingScroll.current;
    if (!key) return;
    const index = rows.findIndex((row) => row.view.key === key);
    if (index >= 0) {
      pendingScroll.current = null;
      timeline.current?.scrollToIndex(index);
    }
  }, [rows]);

  const reveal = useCallback(
    (key: string) => {
      const located = byKey.get(key);
      if (!located) return;
      const above = ancestors(located);
      if (above.some((k) => !unfolded.has(k))) setUnfolded((prev) => toggleIn(prev, above, true));
      setSelected(key);
      pendingScroll.current = key;
      const index = rows.findIndex((row) => row.view.key === key);
      if (index >= 0 && above.every((k) => unfolded.has(k))) {
        pendingScroll.current = null;
        timeline.current?.scrollToIndex(index);
      }
    },
    [byKey, ancestors, unfolded, setUnfolded, setSelected, rows],
  );

  // Opening or closing anything keeps the clicked element where it was on screen.
  const selectedRef = useLatest(selected);
  const toggleBranch = useCallback(
    (key: string) => {
      timeline.current?.anchor(selectedRef.current);
      setUnfolded((prev) => toggleIn(prev, [key]));
    },
    [setUnfolded],
  );
  const toggle = useCallback(
    (key: string) => {
      timeline.current?.anchor(selectedRef.current);
      setExpanded((prev) => toggleIn(prev, [key]));
    },
    [setExpanded],
  );

  // Uncontrolled selection starts from a `#step=` permalink.
  const revealRef = useLatest(reveal);
  useEffect(() => {
    if (props.selectedStep !== undefined || typeof location === "undefined") return;
    if (!location.hash.startsWith(HASH)) return;
    let key: string;
    try {
      key = decodeURIComponent(location.hash.slice(HASH.length));
    } catch {
      return;
    }
    revealRef.current(key);
  }, [props.selectedStep]);

  const payloads = useRef(new Map<string, PayloadEntry>()).current;
  // Work the first rows don't need waits for the frame after they paint: the overview's layout
  // (its height is reserved from a cheap lane count) and which steps stand out (opacity only).
  const [late, setLate] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => startTransition(() => setLate(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  const outliers = useMemo(
    () =>
      late ? findOutliers(view.steps) : { duration: new Set<string>(), tokens: new Set<string>() },
    [late, view],
  );
  const workdir = useMemo(() => guessWorkdir(view), [view]);
  const context = useMemo<TraceContextValue>(
    () => ({
      renderers: renderers ?? {},
      live,
      loadPayload,
      loadTrace,
      loadPatch,
      isExpanded: (key) => expanded.has(key),
      isUnfolded: (run) => unfolded.has(run),
      toggle,
      payloads,
      traceModel: record.agent.model,
      root: view,
      workdir,
      outliers,
      prose,
    }),
    [
      prose,
      workdir,
      outliers,
      renderers,
      live,
      loadPayload,
      loadTrace,
      loadPatch,
      expanded,
      unfolded,
      toggle,
      payloads,
      record.agent.model,
      view,
    ],
  );

  const searchInput = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const [scaleChoice, setScale] = useState<"time" | "steps" | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(overviewProp === "open");
  const showOverview = overviewProp !== false && overviewOpen;
  const laneCount = useMemo(
    () => (showOverview ? overviewLaneCount(view, { loaded, scale: scaleChoice ?? "auto" }) : 0),
    [showOverview, view, loaded, scaleChoice],
  );
  const layout = useMemo(
    () =>
      showOverview && late ? layoutOverview(view, { loaded, scale: scaleChoice ?? "auto" }) : null,
    [showOverview, late, view, loaded, scaleChoice],
  );
  // Time is offered when most steps carry a timestamp, the same rule the layout's auto scale uses.
  const timedLayout = useMemo(() => {
    if (!showOverview || !view.steps.length) return false;
    const timed = view.steps.filter((s) => s.step.timestamp).length;
    return timed / view.steps.length >= 0.8;
  }, [showOverview, view]);
  const overviewRef = useRef<OverviewHandle>(null);
  const onVisible = useCallback(
    (range: { from: string; to: string } | null) => overviewRef.current?.setVisible(range),
    [],
  );
  const describe = useCallback(
    (key: string) => {
      const located = byKey.get(key);
      if (!located) return undefined;
      const { step, calls } = located.view;
      const text = step.content?.trim();
      const firstCall = calls[0];
      const title = text
        ? oneLine(text.replace(/^"(.*)"$/s, "$1"), 140)
        : firstCall
          ? `${calls.map((c) => c.call.tool_name).join(", ")}`
          : step.reasoning_content
            ? "thinking"
            : step.role;
      const failed = calls.filter((c) => c.status === "error").length;
      const detail = firstCall
        ? [
            failed ? `${failed} failed` : "",
            firstCall.observation?.output_summary
              ? oneLine(firstCall.observation.output_summary, 100)
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : located.view.durationMs != null
          ? formatDuration(located.view.durationMs)
          : undefined;
      return { title: `${step.role === "user" ? "asked: " : ""}${title}`, detail };
    },
    [byKey],
  );

  const copyPermalink = useCallback(
    (key: string) => {
      const link =
        permalink?.(key) ??
        `${location.origin}${location.pathname}${location.search}${HASH}${encodeURIComponent(key)}`;
      navigator.clipboard?.writeText(link).then(
        () => setNotice(`copied step ${byKey.get(key)?.view.index ?? key}`),
        () => setNotice("couldn't copy"),
      );
    },
    [permalink, byKey],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 1600);
    return () => clearTimeout(timer);
  }, [notice]);

  // Where Enter in the search box goes next. A new query starts from the top.
  const [cursor, setCursor] = useState({ query: "", at: -1 });
  const matchCursor = cursor.query === deferredQuery ? cursor.at : -1;
  const setMatchCursor = useCallback(
    (at: number) => setCursor({ query: deferredQuery, at }),
    [deferredQuery],
  );
  const stepMatch = useCallback(
    (delta: number) => {
      if (!matches.length) return;
      const current = selected ? matches.indexOf(selected) : -1;
      const from = current >= 0 ? current : matchCursor;
      const next = (from + delta + matches.length) % matches.length;
      setMatchCursor(next);
      reveal(matches[next] as string);
    },
    [matches, selected, matchCursor, reveal, setMatchCursor],
  );

  const onKey = useCallback(
    (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const index = selected ? rows.findIndex((r) => r.view.key === selected) : -1;
      const row = index >= 0 ? rows[index] : undefined;
      const select = (i: number) => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
        if (next) reveal(next.view.key);
      };
      switch (event.key) {
        case "j":
          select(index + 1);
          break;
        case "k":
          select(index < 0 ? 0 : index - 1);
          break;
        case "Enter": {
          if (!row) return;
          const v = row.view;
          const keys = [
            ...v.calls.map((c) => callKey(v.key, c.call.tool_call_id)),
            ...v.patches.map((p) => patchKey(v.key, p.patch_id)),
            ...(v.step.reasoning_content ? [reasoningKey(v.key)] : []),
            ...(v.step.role === "system" && v.step.content ? [systemKey(v.key)] : []),
          ];
          if (keys.length) setExpanded((prev) => toggleIn(prev, keys));
          else if (row.branch) toggleBranch(runKey(v.key, 0));
          else return;
          break;
        }
        case "[": {
          if (!row) return;
          if (row.branch && row.open) {
            const open = runsOf(row).filter((k) => unfolded.has(k));
            timeline.current?.anchor(row.view.key);
            setUnfolded((prev) => toggleIn(prev, open, false));
          } else {
            const located = byKey.get(row.view.key);
            const above = located ? ancestors(located) : [];
            const run = above.at(-1);
            if (!run) return;
            const head = headOf(run);
            setUnfolded((prev) => toggleIn(prev, [run], false));
            setSelected(head);
            pendingScroll.current = head;
          }
          break;
        }
        case "]":
          if (!row?.branch || row.open) return;
          timeline.current?.anchor(row.view.key);
          setUnfolded((prev) => toggleIn(prev, runsOf(row), true));
          break;
        case "/":
          searchInput.current?.focus();
          searchInput.current?.select();
          break;
        case "c":
          if (!selected) return;
          copyPermalink(selected);
          break;
        case "Escape":
          if (query) setQuery("");
          else if (selected) setSelected(null);
          else return;
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [
      selected,
      rows,
      unfolded,
      reveal,
      setExpanded,
      toggleBranch,
      byKey,
      ancestors,
      setUnfolded,
      setSelected,
      copyPermalink,
      query,
      setQuery,
    ],
  );

  useEffect(() => {
    if (keyboard !== "global") return;
    const listener = (event: globalThis.KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [keyboard, onKey]);

  useImperativeHandle(
    props.ref,
    () => ({
      append: (steps) => setAppended((prev) => [...prev, ...steps]),
      scrollToStep: reveal,
      focus: () => rootRef.current?.focus(),
    }),
    [reveal],
  );

  return (
    <TraceContext.Provider value={context}>
      <section
        ref={rootRef}
        className={className ? `kiseki ${className}` : "kiseki"}
        style={style}
        data-theme={theme}
        data-scroll={scroll}
        aria-label="agent trace"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the trace takes focus so j/k work.
        tabIndex={0}
        onKeyDown={keyboard === "scoped" ? onKey : undefined}
      >
        <div
          className={`kiseki-bar${scroll === "page" ? " kiseki-sticky" : ""}`}
          style={
            scroll === "page"
              ? ({ "--kiseki-sticky-top": `${stickyTop}px` } as CSSProperties)
              : undefined
          }
        >
          {header === true ? (
            <TraceHeader view={view}>
              {toolbar && (
                <span className="kiseki-tools">
                  <label className="kiseki-search">
                    <SearchIcon />
                    <input
                      ref={searchInput}
                      value={query}
                      placeholder="search"
                      aria-label="search steps"
                      spellCheck={false}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          stepMatch(event.shiftKey ? -1 : 1);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          if (query) setQuery("");
                          else rootRef.current?.focus();
                        }
                      }}
                    />
                    {query ? (
                      <span className="kiseki-status kiseki-num" aria-live="polite">
                        {deferredQuery
                          ? matches.length
                            ? `${Math.max(0, selected ? matches.indexOf(selected) : matchCursor) + 1}/${matches.length}`
                            : "0"
                          : ""}
                      </span>
                    ) : (
                      <kbd className="kiseki-kbd">/</kbd>
                    )}
                  </label>
                  {query && (
                    <>
                      <button
                        type="button"
                        className="kiseki-icon-button"
                        aria-label="previous match"
                        disabled={!matches.length}
                        onClick={() => stepMatch(-1)}
                      >
                        <ArrowIcon up />
                      </button>
                      <button
                        type="button"
                        className="kiseki-icon-button"
                        aria-label="next match"
                        disabled={!matches.length}
                        onClick={() => stepMatch(1)}
                      >
                        <ArrowIcon />
                      </button>
                    </>
                  )}
                  {overviewProp !== false && view.steps.length > 0 && (
                    <button
                      type="button"
                      className="kiseki-chip"
                      aria-pressed={overviewOpen}
                      onClick={() => setOverviewOpen((open) => !open)}
                    >
                      map
                    </button>
                  )}
                  {notice && <span className="kiseki-status kiseki-num">{notice}</span>}
                </span>
              )}
            </TraceHeader>
          ) : (
            header || null
          )}
          {showOverview && view.steps.length > 0 && (
            <div className="kiseki-overview-float">
              <TraceOverview
                handle={overviewRef}
                overview={layout}
                lanes={laneCount}
                selected={selected}
                onPick={reveal}
                describe={describe}
                scale={layout?.scale ?? scaleChoice ?? (timedLayout ? "time" : "steps")}
                onScale={setScale}
                canScaleByTime={timedLayout}
              />
            </div>
          )}
        </div>
        <Timeline
          handle={timeline}
          rows={rows}
          selected={selected}
          matches={matchSet}
          branchStates={branchStates}
          live={live}
          scroll={scroll}
          onVisible={showOverview ? onVisible : undefined}
          onSelect={setSelected}
          onToggleBranch={toggleBranch}
          onFirstRows={onFirstRows}
          empty={empty ?? <div className="kiseki-empty">no steps yet</div>}
        />
      </section>
    </TraceContext.Provider>
  );
}

/** The step key a run key hangs off. */
const headOf = (run: string) => run.replace(/~\d+$/, "");

/** Every run key a branch row can unfold. */
function runsOf(row: Row): string[] {
  const n = branchRuns(row.trace, row.view).length || 1;
  return Array.from({ length: n }, (_, i) => runKey(row.view.key, i));
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="kiseki-dim">
      <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={up ? "M3.5 10 8 5.5l4.5 4.5" : "M3.5 6 8 10.5 12.5 6"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
