"use client";

import type { ToolRendererProps } from "@tetraslam/kiseki";

interface SearchHit {
  name: string;
  version: string;
  description?: string;
  date?: string;
}

interface Details {
  name: string;
  latest: string;
  license?: string;
  published?: string;
  created?: string;
  dependencies: number;
  weeklyDownloads: number | null;
}

function parse<T>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const age = (iso?: string) => {
  if (!iso) return "";
  const days = Math.round((Date.parse("2026-11-09") - Date.parse(iso)) / 86_400_000);
  return days < 1 ? "today" : days < 60 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
};

/** `searchPackages`: the hits as a list, not a JSON blob. */
export function SearchResults(props: ToolRendererProps) {
  const hits = parse<SearchHit[]>(props.payload ?? props.observation?.content);
  if (!hits) return <props.Default {...props} />;
  const query = String(props.call.input?.query ?? "");
  return (
    <div className="grid gap-1.5 py-1">
      <div className="flex items-baseline gap-2 text-[12.5px]">
        <span className="text-foreground">{hits.length} packages</span>
        <span className="font-mono text-[12px] text-ink-2">“{query}”</span>
        <span className="ml-auto text-[11px] text-ink-3">searchPackages</span>
      </div>
      <ul className="grid gap-px overflow-hidden rounded-[4px] bg-line ring-1 ring-line sm:grid-cols-2">
        {hits.slice(0, 6).map((hit) => (
          <li key={hit.name} className="grid gap-0.5 bg-s1 px-2.5 py-1.5">
            <span className="flex items-baseline gap-2">
              <span className="truncate font-mono text-[12px] text-foreground">{hit.name}</span>
              <span className="font-mono text-[11px] text-ink-3">{hit.version}</span>
            </span>
            <span className="line-clamp-1 text-[12px] text-ink-3">{hit.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `packageDetails`: one card per package, downloads first because that's what the agent compares. */
export function PackageCard(props: ToolRendererProps) {
  const details = parse<Details>(props.payload ?? props.observation?.content);
  if (!details) return <props.Default {...props} />;
  const downloads = details.weeklyDownloads ?? 0;
  // A log scale, so 1M and 40M weekly downloads both read.
  const fill = downloads ? Math.min(1, Math.log10(downloads) / 8) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-[4px] bg-s1 px-2.5 py-2 ring-1 ring-line">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-mono text-[12.5px] text-foreground">{details.name}</span>
        <span className="font-mono text-[11px] text-ink-3">{details.latest}</span>
      </span>
      <span className="font-mono text-[12.5px] tabular-nums text-foreground">
        {compact.format(downloads)}
        <span className="ml-1 font-sans text-[11px] text-ink-3">/ week</span>
      </span>
      <span className="text-[11.5px] text-ink-3">
        {details.license ?? "no license"} · {details.dependencies} deps · published{" "}
        {age(details.published)} · since {details.created?.slice(0, 4)}
      </span>
      <span className="h-1 w-28 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-accent-ink"
          style={{ width: `${fill * 100}%` }}
        />
      </span>
    </div>
  );
}
