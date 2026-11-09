import { type Overview, type Segment, segmentAt } from "@tetraslam/kiseki-core";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatDuration, formatTokens } from "./format";
import { useLatest } from "./state";

export interface OverviewHandle {
  /** The steps the transcript shows right now, drawn as the viewport band. */
  setVisible: (range: { from: string; to: string } | null) => void;
}

export interface TraceOverviewProps {
  /** Null until laid out; the canvas already has its final height. */
  overview: Overview | null;
  /** Lane count, known before the layout, so the height never changes when it arrives. */
  lanes: number;
  selected: string | null;
  onPick: (key: string) => void;
  /** Short text per step for the hover card. */
  describe: (key: string) => { title: string; detail?: string } | undefined;
  scale: "time" | "steps";
  onScale: (scale: "time" | "steps") => void;
  canScaleByTime: boolean;
  handle?: Ref<OverviewHandle>;
}

const LEFT = 64;
const RIGHT = 12;
const LANE = 14;
const LANE_GAP = 5;
const TOP = 6;
const TOKENS = 16;
const AXIS = 16;

/** Height is known before paint, from the lane count, so the overview never shifts the page. */
export function overviewHeight(lanes: number): number {
  return TOP + lanes * (LANE + LANE_GAP) + TOKENS + AXIS;
}

/**
 * The run's shape: one lane for the main agent, one per concurrent subagent, the trajectory
 * threaded through them in reading order, waiting hatched, failures marked, tokens below, and
 * the transcript's viewport as a band. Click or arrow keys to move through it.
 */
export function TraceOverview({
  overview,
  lanes,
  selected,
  onPick,
  describe,
  scale,
  onScale,
  canScaleByTime,
  handle,
}: TraceOverviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const visible = useRef<{ from: string; to: string } | null>(null);
  const hover = useRef<Segment | null>(null);
  const frame = useRef(0);
  const [tip, setTip] = useState<{ segment: Segment; x: number } | null>(null);
  const height = overviewHeight(lanes);
  const indexOf = useMemo(
    () => new Map((overview?.segments ?? []).map((segment, i) => [segment.key, i])),
    [overview],
  );

  const draw = useCallback(() => {
    frame.current = 0;
    const el = canvas.current;
    if (!el) return;
    const width = el.clientWidth;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (el.width !== Math.round(width * ratio)) el.width = Math.round(width * ratio);
    if (el.height !== Math.round(height * ratio)) el.height = Math.round(height * ratio);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!overview) return;
    const css = getComputedStyle(el);
    const color = (name: string) => css.getPropertyValue(name).trim() || "#888";
    const ink = color("--kiseki-ink");
    const ink2 = color("--kiseki-ink-2");
    const ink3 = color("--kiseki-ink-3");
    const line = color("--kiseki-line-2");
    const accent = color("--kiseki-accent");
    const wash = color("--kiseki-accent-wash");
    const danger = color("--kiseki-danger");
    const mono = css.getPropertyValue("--kiseki-mono").trim() || "monospace";
    const font = css.getPropertyValue("--kiseki-font").trim() || "sans-serif";

    const span = overview.end - overview.start;
    const plot = Math.max(1, width - LEFT - RIGHT);
    const x = (t: number) => LEFT + ((t - overview.start) / span) * plot;
    const laneY = (lane: number) => TOP + lane * (LANE + LANE_GAP);
    const lanesBottom = laneY(overview.lanes.length) - LANE_GAP;

    // viewport band
    const band = visible.current;
    if (band) {
      const a = overview.segments[indexOf.get(band.from) ?? -1];
      const b = overview.segments[indexOf.get(band.to) ?? -1];
      if (a && b) {
        const x0 = x(Math.min(a.start, b.start));
        const x1 = Math.max(x0 + 2, x(Math.max(a.end, b.end)));
        ctx.fillStyle = wash;
        ctx.fillRect(x0, 0, x1 - x0, lanesBottom + 4);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x0, 0, 1, lanesBottom + 4);
        ctx.fillRect(x1 - 1, 0, 1, lanesBottom + 4);
        ctx.globalAlpha = 1;
      }
    }

    // lanes
    ctx.font = `500 10.5px ${font}`;
    ctx.textBaseline = "middle";
    overview.lanes.forEach((lane, i) => {
      const y = laneY(i) + LANE / 2;
      ctx.fillStyle = ink3;
      ctx.fillText(lane.label, 16 + lane.depth * 6, y, LEFT - 22 - lane.depth * 6);
      ctx.fillStyle = line;
      ctx.fillRect(LEFT, Math.round(y), plot, 1);
    });

    // steps, merged per pixel so 10,000 of them cost little
    const kindColor = { user: ink, system: ink3, agent: ink3, tools: ink2 } as const;
    for (const segment of overview.segments) {
      const x0 = x(segment.start);
      const w = Math.max(1, x(segment.end) - x0 - (x(segment.end) - x0 > 3 ? 1 : 0));
      const y = laneY(segment.lane) + 2;
      ctx.fillStyle = kindColor[segment.kind];
      ctx.globalAlpha = segment.kind === "agent" || segment.kind === "system" ? 0.55 : 0.9;
      ctx.fillRect(x0, y, w, LANE - 4);
      if (segment.wait) {
        // Waiting on subagents: hatched, so the parent's idle time is visible as time.
        const w0 = x(segment.wait.start);
        const w1 = x(segment.wait.end);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(w0, y, Math.max(1, w1 - w0), LANE - 4);
        ctx.clip();
        ctx.clearRect(w0, y, w1 - w0, LANE - 4);
        ctx.beginPath();
        ctx.strokeStyle = ink3;
        ctx.lineWidth = 1;
        for (let hx = w0 - LANE; hx < w1; hx += 4) {
          ctx.moveTo(hx, y + LANE - 4);
          ctx.lineTo(hx + LANE - 4, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    // the trajectory: one thread through every step in reading order
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let lastX = -1;
    let lastLane = -1;
    overview.segments.forEach((segment, i) => {
      const cx = Math.round(x((segment.start + segment.end) / 2)) + 0.5;
      const cy = laneY(segment.lane) + LANE / 2;
      if (i === 0) ctx.moveTo(cx, cy);
      else if (cx !== lastX || segment.lane !== lastLane) ctx.lineTo(cx, cy);
      lastX = cx;
      lastLane = segment.lane;
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    // failures
    ctx.fillStyle = danger;
    for (const segment of overview.segments) {
      if (!segment.error) continue;
      const cx = x((segment.start + segment.end) / 2);
      const y = laneY(segment.lane);
      ctx.beginPath();
      ctx.moveTo(cx - 3, y - 1);
      ctx.lineTo(cx + 3, y - 1);
      ctx.lineTo(cx, y + 3);
      ctx.fill();
    }

    // tokens per step, the tallest bar per pixel
    if (overview.maxTokens > 0) {
      const base = lanesBottom + TOKENS;
      const columns = new Float32Array(Math.ceil(plot) + 1);
      for (const segment of overview.segments) {
        const c = Math.floor(x((segment.start + segment.end) / 2) - LEFT);
        if (c >= 0 && c < columns.length)
          columns[c] = Math.max(columns[c] as number, segment.tokens);
      }
      ctx.fillStyle = ink3;
      ctx.globalAlpha = 0.45;
      for (let c = 0; c < columns.length; c++) {
        const v = columns[c] as number;
        if (!v) continue;
        const h = Math.max(1, (v / overview.maxTokens) * (TOKENS - 4));
        ctx.fillRect(LEFT + c, base - h, 1, h);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink3;
      ctx.font = `500 10.5px ${font}`;
      ctx.fillText("tokens", 16, base - TOKENS / 2 + 1, LEFT - 22);
    }

    // selection
    const picked = selected != null ? overview.segments[indexOf.get(selected) ?? -1] : undefined;
    if (picked) {
      const cx = Math.round(x((picked.start + picked.end) / 2)) + 0.5;
      ctx.fillStyle = accent;
      ctx.fillRect(cx - 0.75, 0, 1.5, lanesBottom + TOKENS);
      const y = laneY(picked.lane) + LANE / 2;
      ctx.beginPath();
      ctx.arc(cx, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const hovered = hover.current;
    if (hovered && hovered !== picked) {
      const x0 = x(hovered.start);
      const w = Math.max(2, x(hovered.end) - x0);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 0.5, laneY(hovered.lane) + 0.5, w + 1, LANE - 1);
    }

    // axis
    const base = lanesBottom + TOKENS;
    ctx.fillStyle = ink3;
    ctx.font = `10px ${mono}`;
    ctx.textBaseline = "top";
    for (const tick of ticks(span, plot, scale)) {
      const tx = x(overview.start + tick);
      ctx.fillRect(Math.round(tx), base + 1, 1, 3);
      const label =
        tick === 0 ? "0" : scale === "time" ? formatDuration(tick) : String(Math.round(tick));
      ctx.fillText(label, Math.round(tx) + 3, base + 3);
    }
  }, [overview, height, indexOf, selected, scale]);

  const drawRef = useLatest(draw);
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => drawRef.current());
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      setVisible: (range) => {
        const current = visible.current;
        if (current?.from === range?.from && current?.to === range?.to) return;
        visible.current = range;
        schedule();
      },
    }),
    [schedule],
  );

  // Drawn on the next frame: the transcript's first rows paint before the overview does. The
  // canvas has its final height from the start, so nothing moves when it fills in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw whenever what draw reads changes.
  useEffect(() => schedule(), [draw, schedule]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    // Theme changes arrive as a class or data attribute somewhere above.
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, { attributes: true, subtree: false });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", schedule);
    return () => {
      resize.disconnect();
      theme.disconnect();
      media.removeEventListener("change", schedule);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [schedule]);

  const locate = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!overview) return { segment: undefined, px: 0 };
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const plot = Math.max(1, rect.width - LEFT - RIGHT);
    const t = overview.start + ((px - LEFT) / plot) * (overview.end - overview.start);
    const lane = Math.floor((py - TOP) / (LANE + LANE_GAP));
    const inLane = lane >= 0 && lane < overview.lanes.length;
    return {
      segment: segmentAt(overview, t, inLane ? lane : undefined) ?? segmentAt(overview, t),
      px,
    };
  };

  const step = (delta: number) => {
    if (!overview) return;
    const at = selected != null ? (indexOf.get(selected) ?? -1) : -1;
    const next = overview.segments[Math.max(0, Math.min(overview.segments.length - 1, at + delta))];
    if (next) onPick(next.key);
  };

  const tipText = tip ? describe(tip.segment.key) : undefined;
  return (
    <div className="kiseki-overview">
      <div className="kiseki-overview-bar">
        <span>trajectory</span>
        <span className="kiseki-num">
          {lanes > 1 ? `${lanes - 1} subagent ${lanes === 2 ? "lane" : "lanes"}` : ""}
        </span>
        {canScaleByTime && (
          <span className="kiseki-scale">
            <button type="button" aria-pressed={scale === "time"} onClick={() => onScale("time")}>
              time
            </button>
            <button type="button" aria-pressed={scale === "steps"} onClick={() => onScale("steps")}>
              steps
            </button>
          </span>
        )}
      </div>
      <canvas
        ref={canvas}
        style={{ height }}
        tabIndex={0}
        role="slider"
        aria-label="trajectory: arrow keys move between steps"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, (overview?.segments.length ?? 1) - 1)}
        aria-valuenow={selected != null ? (indexOf.get(selected) ?? 0) : 0}
        onPointerMove={(event) => {
          const { segment, px } = locate(event);
          if (segment !== hover.current) {
            hover.current = segment ?? null;
            schedule();
          }
          setTip(segment ? { segment, x: px } : null);
        }}
        onPointerLeave={() => {
          hover.current = null;
          setTip(null);
          schedule();
        }}
        onPointerDown={(event) => {
          const { segment } = locate(event);
          if (segment) onPick(segment.key);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            event.stopPropagation();
            step(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
      />
      <div
        className="kiseki-tip"
        hidden={!tip || !tipText}
        style={
          tip
            ? {
                left: Math.min(
                  Math.max(8, tip.x - 140),
                  (canvas.current?.clientWidth ?? 600) - 288,
                ),
              }
            : undefined
        }
      >
        {tip && tipText && (
          <>
            <span className="kiseki-num kiseki-dim">
              step {tip.segment.key}
              {overview?.scale === "time"
                ? ` · ${formatDuration(tip.segment.end - tip.segment.start)}`
                : ""}
              {tip.segment.tokens ? ` · ${formatTokens(tip.segment.tokens)} tokens` : ""}
              {tip.segment.wait
                ? ` · waited ${formatDuration(tip.segment.wait.end - tip.segment.wait.start)}`
                : ""}
            </span>
            <span className="kiseki-tip-text">{tipText.title}</span>
            {tipText.detail && <span className="kiseki-tip-text kiseki-dim">{tipText.detail}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** Round tick positions: about one per 90px. */
function ticks(span: number, plot: number, scale: "time" | "steps"): number[] {
  const want = Math.max(2, Math.floor(plot / 90));
  const raw = span / want;
  const steps =
    scale === "time"
      ? [
          100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
          600_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
        ]
      : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const unit = steps.find((s) => s >= raw) ?? (steps.at(-1) as number);
  const out: number[] = [];
  for (let t = 0; t <= span + 1e-9; t += unit) out.push(t);
  return out;
}
