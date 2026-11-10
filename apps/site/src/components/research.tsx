"use client";

import {
  Markdown,
  type Renderers,
  type ToolRendererProps,
  type TraceRecord,
} from "@tetraslam/kiseki";
import { type ReactNode, useMemo, useState } from "react";

interface Source {
  url: string;
  domain: string;
  title: string;
  excerpt: string;
  /** The agent fetched and read it, rather than seeing it in search results. */
  read?: { words: number };
}

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const clean = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\[\.\.\.\]/g, "…")
    .replace(/\s+/g, " ")
    .trim();

/** Search results as the agent saw them: `## [title](url)` blocks. */
function parseResults(text: string): Source[] {
  const out: Source[] = [];
  for (const block of text.split(/\n(?=## \[)/)) {
    const head = /^## \[([^\]]+)\]\(([^)]+)\)/.exec(block.trim());
    if (!head) continue;
    out.push({
      title: head[1] as string,
      url: head[2] as string,
      domain: domainOf(head[2] as string),
      excerpt: clean(block.slice(head[0].length)).slice(0, 220),
    });
  }
  return out;
}

/** A fetched page: its heading, length, and first real paragraph. */
function parsePage(url: string, text: string): Source {
  const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? domainOf(url);
  const paragraph =
    text
      .split(/\n{2,}/)
      .map(clean)
      .find((p) => p.length > 120 && !/cookie|sign in|navigation/i.test(p)) ?? "";
  return {
    url,
    domain: domainOf(url),
    title: clean(title),
    excerpt: paragraph.slice(0, 240),
    read: { words: text.split(/\s+/).length },
  };
}

/** Everything the agent searched and read, keyed by URL, for citations to point at. */
export function collectSources(record: TraceRecord): Map<string, Source> {
  const sources = new Map<string, Source>();
  for (const step of record.steps ?? []) {
    for (const call of step.tool_calls ?? []) {
      const observation = step.observations?.find((o) => o.source_call_id === call.tool_call_id);
      const text = observation?.content ?? "";
      if (call.tool_name === "websearch") {
        for (const hit of parseResults(text))
          if (!sources.has(norm(hit.url))) sources.set(norm(hit.url), hit);
      }
      if (call.tool_name === "webfetch" && typeof call.input?.url === "string") {
        sources.set(norm(call.input.url), parsePage(call.input.url, text));
      }
    }
  }
  return sources;
}

const norm = (url: string) =>
  url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/(index\.html)?$/, "");

/** A tile with the site's initial, its color derived from the domain. */
function Mark({ domain, size = 18 }: { domain: string; size?: number }) {
  let hash = 0;
  for (const ch of domain) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-[5px] font-mono text-[10px] font-semibold uppercase text-white"
      style={{ width: size, height: size, background: `oklch(0.52 0.09 ${hue})` }}
    >
      {domain[0]}
    </span>
  );
}

function SearchResults(props: ToolRendererProps) {
  const results = parseResults(props.payload ?? props.observation?.content ?? "");
  const query = String(props.call.input?.query ?? "");
  if (props.status === "pending") return <props.Default {...props} />;
  if (!results.length) return <props.Default {...props} />;
  const read = new Set(
    props.step.tool_calls
      ?.filter((c) => c.tool_name === "webfetch")
      .map((c) => norm(String(c.input?.url))) ?? [],
  );
  return (
    <div className="grid gap-1.5 py-1">
      <div className="flex items-center gap-2 text-[12.5px]">
        <SearchGlyph />
        <span className="text-foreground">{query}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-3">{results.length} results</span>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-[8px] ring-1 ring-line">
        {results.slice(0, 5).map((hit, i) => (
          <li
            key={hit.url}
            className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 bg-s1 px-3 py-2"
          >
            <Mark domain={hit.domain} />
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                <a
                  href={hit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-[13px] text-foreground hover:underline"
                >
                  {hit.title}
                </a>
                {read.has(norm(hit.url)) && (
                  <span className="flex-none text-[10.5px] text-[var(--kiseki-add)]">read</span>
                )}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-ink-3">
                {i + 1}. {hit.domain}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PageRead(props: ToolRendererProps) {
  const url = String(props.call.input?.url ?? "");
  const text = props.payload ?? props.observation?.content;
  if (!text || props.status !== "ok") return <props.Default {...props} />;
  const page = parsePage(url, text);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 rounded-[8px] bg-s1 p-3 ring-1 ring-line transition-colors duration-[90ms] hover:bg-s2"
    >
      <Mark domain={page.domain} size={28} />
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{page.title}</span>
        </span>
        <span className="block font-mono text-[10.5px] text-ink-3">
          {page.domain} · read {page.read?.words.toLocaleString()} words
        </span>
        {page.excerpt && (
          <span className="mt-1.5 line-clamp-2 block text-[12.5px] leading-relaxed text-ink-2">
            {page.excerpt}
          </span>
        )}
      </span>
    </a>
  );
}

/** The answer, with [n] citations turned into chips that show the page they point at. */
function CitedAnswer({ text, sources }: { text: string; sources: Map<string, Source> }) {
  const numbered = useMemo(() => {
    const map = new Map<number, Source>();
    for (const match of text.matchAll(/^(\d+)\.\s.*?(https?:\/\/\S+)\s*$/gm)) {
      const url = match[2] as string;
      map.set(
        Number(match[1]),
        sources.get(norm(url)) ?? { url, domain: domainOf(url), title: domainOf(url), excerpt: "" },
      );
    }
    return map;
  }, [text, sources]);
  if (!numbered.size) return <Markdown text={text} />;
  const body = text.replace(/\n*\*\*Sources:?\*\*[\s\S]*$/, "");
  return (
    <div className="grid gap-3">
      <div className="kiseki-message">
        <Cited text={body} numbered={numbered} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-[11px] text-ink-3">sources</span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {[...numbered].map(([n, source]) => (
            <a
              key={n}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-[8px] bg-s1 px-2.5 py-2 ring-1 ring-line transition-colors duration-[90ms] hover:bg-s2"
            >
              <span className="font-mono text-[11px] text-ink-3">{n}</span>
              <Mark domain={source.domain} />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-foreground">{source.title}</span>
                <span className="block font-mono text-[10.5px] text-ink-3">
                  {source.domain}
                  {source.read ? " · read" : " · from search"}
                </span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Paragraph by paragraph, with bold and code kept and each [n] swapped for a chip. */
function Cited({ text, numbered }: { text: string; numbered: Map<number, Source> }) {
  const paragraphs: ReactNode[] = [];
  for (const [i, paragraph] of text.split(/\n{2,}/).entries()) {
    const pieces = paragraph.split(/(\[\d+\])/g);
    paragraphs.push(
      <div key={i} className="kiseki-markdown [&_p]:m-0">
        {pieces.map((piece, j) => {
          const key = `${j}:${piece.slice(0, 24)}`;
          const n = /^\[(\d+)\]$/.exec(piece)?.[1];
          if (n) return <Chip key={key} n={Number(n)} source={numbered.get(Number(n))} />;
          return <InlineMarkdown key={key} text={piece} />;
        })}
      </div>,
    );
  }
  return <div className="grid gap-2.5">{paragraphs}</div>;
}

function InlineMarkdown({ text }: { text: string }) {
  if (/^#{1,6}\s/.test(text.trim()))
    return <span className="block text-[13px] font-semibold">{text.replace(/^#+\s*/, "")}</span>;
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) => ({ part, key: `${i}:${part}` }));
  return (
    <>
      {parts.map(({ part, key }) =>
        part.startsWith("**") ? (
          <strong key={key}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("`") ? (
          <code key={key}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Chip({ n, source }: { n: number; source?: Source }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-baseline">
      <a
        href={source?.url}
        target="_blank"
        rel="noreferrer"
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="mx-0.5 inline-grid h-[17px] min-w-[17px] place-items-center rounded-[5px] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-1 font-mono text-[10.5px] text-foreground no-underline transition-colors duration-[90ms] hover:bg-[color-mix(in_srgb,var(--accent)_32%,transparent)]"
      >
        {n}
      </a>
      {open && source && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1.5 grid w-72 -translate-x-1/2 gap-1 rounded-[8px] bg-s2 p-3 text-left shadow-[0_8px_24px_rgb(0_0_0/0.3)] ring-1 ring-line">
          <span className="flex items-center gap-2">
            <Mark domain={source.domain} />
            <span className="truncate text-[12.5px] font-medium text-foreground">
              {source.title}
            </span>
          </span>
          {source.excerpt && (
            <span className="line-clamp-3 text-[12px] leading-relaxed text-ink-2">
              {source.excerpt}
            </span>
          )}
          <span className="font-mono text-[10.5px] text-ink-3">{source.domain}</span>
        </span>
      )}
    </span>
  );
}

function SearchGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden className="text-ink-3">
      <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The research demo's renderers: search results, pages read, and a cited answer. */
export function researchRenderers(record: TraceRecord): Renderers {
  const sources = collectSources(record);
  return {
    tools: { websearch: SearchResults, webfetch: PageRead },
    message: ({ text }) =>
      /\[\d+\]/.test(text) ? (
        <CitedAnswer text={text} sources={sources} />
      ) : (
        <Markdown text={text} />
      ),
  };
}
