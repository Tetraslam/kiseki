import {
  ancestorsOf,
  type BranchNode,
  branchTree,
  normalize,
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
import type { BranchState } from "./StepRow";
import { toggleIn, useControllable } from "./state";
import { Timeline, type TimelineHandle } from "./Timeline";
import { TraceHeader } from "./TraceHeader";
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
      return owner ? [...ancestors(owner), owner.view.key, ...keys] : keys;
    },
    [owners],
  );

  const matches = useMemo(
    () =>
      searchSteps(
        all.map((l) => l.view),
        deferredQuery,
      ).map((s) => s.key),
    [all, deferredQuery],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  // Load subagent traces as their branches unfold.
  const loadTraceRef = useRef(loadTrace);
  loadTraceRef.current = loadTrace;
  useEffect(() => {
    for (const key of unfolded) {
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

  const toggleBranch = useCallback(
    (key: string) => setUnfolded((prev) => toggleIn(prev, [key])),
    [setUnfolded],
  );
  const toggle = useCallback(
    (key: string) => setExpanded((prev) => toggleIn(prev, [key])),
    [setExpanded],
  );

  // Uncontrolled selection starts from a `#step=` permalink.
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (props.selectedStep !== undefined || typeof location === "undefined") return;
    if (location.hash.startsWith(HASH)) {
      revealRef.current(decodeURIComponent(location.hash.slice(HASH.length)));
    }
  }, [props.selectedStep]);

  const payloads = useRef(new Map<string, PayloadEntry>()).current;
  const context = useMemo<TraceContextValue>(
    () => ({
      renderers: renderers ?? {},
      live,
      loadPayload,
      loadTrace,
      loadPatch,
      isExpanded: (key) => expanded.has(key),
      toggle,
      payloads,
      traceModel: record.agent.model,
      root: view,
    }),
    [
      renderers,
      live,
      loadPayload,
      loadTrace,
      loadPatch,
      expanded,
      toggle,
      payloads,
      record.agent.model,
      view,
    ],
  );

  const searchInput = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const [overviewOpen, setOverviewOpen] = useState(false);

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
          else if (row.branch) toggleBranch(v.key);
          else return;
          break;
        }
        case "[": {
          if (!row) return;
          if (row.branch && row.open) toggleBranch(row.view.key);
          else {
            const located = byKey.get(row.view.key);
            const above = located ? ancestors(located) : [];
            const head = above.at(-1);
            if (!head) return;
            setUnfolded((prev) => toggleIn(prev, [head], false));
            setSelected(head);
            pendingScroll.current = head;
          }
          break;
        }
        case "]":
          if (!row?.branch || row.open) return;
          toggleBranch(row.view.key);
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

  const branches = useMemo(
    () => (view.hasBranches ? branchTree(view, loaded) : []),
    [view, loaded],
  );

  return (
    <TraceContext.Provider value={context}>
      <section
        ref={rootRef}
        className={className ? `kiseki ${className}` : "kiseki"}
        style={style}
        data-theme={theme}
        aria-label="agent trace"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the trace takes focus so j/k work.
        tabIndex={0}
        onKeyDown={keyboard === "scoped" ? onKey : undefined}
      >
        {header === true ? <TraceHeader view={view} /> : header || null}
        {toolbar && (
          <div className="kiseki-toolbar">
            <label className="kiseki-search">
              <SearchIcon />
              <input
                ref={searchInput}
                value={query}
                placeholder="search steps"
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
              {!query && <kbd className="kiseki-kbd">/</kbd>}
            </label>
            <span className="kiseki-status kiseki-num" aria-live="polite">
              {notice ||
                (deferredQuery
                  ? matches.length
                    ? `${Math.max(0, selected ? matches.indexOf(selected) : matchCursor) + 1} / ${matches.length}`
                    : "no matches"
                  : "")}
            </span>
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
            {branches.length > 0 && (
              <button
                type="button"
                className="kiseki-icon-button"
                aria-label="branches"
                aria-expanded={overviewOpen}
                onClick={() => setOverviewOpen((open) => !open)}
              >
                <TreeIcon />
              </button>
            )}
          </div>
        )}
        {overviewOpen && branches.length > 0 && (
          <BranchOverview
            nodes={branches}
            unfolded={unfolded}
            onPick={(key) => {
              setUnfolded((prev) => toggleIn(prev, [key], true));
              reveal(key);
            }}
          />
        )}
        <Timeline
          handle={timeline}
          rows={rows}
          selected={selected}
          matches={matchSet}
          branchStates={branchStates}
          live={live}
          onSelect={setSelected}
          onToggleBranch={toggleBranch}
          onFirstRows={onFirstRows}
          empty={empty ?? <div className="kiseki-empty">no steps yet</div>}
        />
      </section>
    </TraceContext.Provider>
  );
}

/** The subagent hierarchy at a glance, for traces that nest deeply. */
export function BranchOverview({
  nodes,
  unfolded,
  onPick,
}: {
  nodes: BranchNode[];
  unfolded: ReadonlySet<string>;
  onPick: (key: string) => void;
}) {
  const flat: BranchNode[] = [];
  const walk = (list: BranchNode[]) => {
    for (const node of list) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return (
    <nav className="kiseki-overview" aria-label="branches">
      {flat.map((node) => (
        <button
          key={node.key}
          type="button"
          style={{ "--kiseki-depth": node.depth } as CSSProperties}
          onClick={() => onPick(node.key)}
        >
          <span className="kiseki-num kiseki-dim">{node.key}</span>
          <span>{node.label}</span>
          <span className="kiseki-num kiseki-dim">
            {node.size} {node.size === 1 ? "step" : "steps"}
          </span>
          {unfolded.has(node.key) && <span className="kiseki-dim">open</span>}
        </button>
      ))}
    </nav>
  );
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

function TreeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 2.5v11M4 6h5M4 11h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="11" cy="6" r="1.6" fill="currentColor" />
      <circle cx="11" cy="11" r="1.6" fill="currentColor" />
    </svg>
  );
}
