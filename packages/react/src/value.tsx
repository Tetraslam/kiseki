import { useState } from "react";
import { oneLine } from "./format";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isRecord = (v: unknown): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ROWS = 6;
const KEYS = 10;
const COLUMNS = 6;

/**
 * A returned value read as data: key/value pairs for objects, a small table for arrays of
 * records, a list for arrays of scalars. Deep or long parts fold behind "more" so nothing runs
 * off the page.
 */
export function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="kiseki-value-null">null</span>;
  if (typeof value === "boolean" || typeof value === "number")
    return <span className="kiseki-value-num">{String(value)}</span>;
  if (typeof value === "string") return <Text text={value} />;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="kiseki-value-null">empty</span>;
    if (value.every(isRecord) && depth < 3) return <Table rows={value} depth={depth} />;
    if (value.every((v) => typeof v !== "object" || v === null)) return <List items={value} />;
    return <Items items={value} depth={depth} />;
  }
  if (isRecord(value)) {
    if (depth >= 3)
      return <span className="kiseki-value-text">{oneLine(JSON.stringify(value), 160)}</span>;
    return <Pairs value={value} depth={depth} />;
  }
  return <span>{String(value)}</span>;
}

function Text({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 4;
  return (
    <span className="kiseki-value-text" data-clamped={(long && !all) || undefined}>
      {text}
      {long && <More open={all} onClick={() => setAll((a) => !a)} label="show all" />}
    </span>
  );
}

function Pairs({ value, depth }: { value: Record<string, Json>; depth: number }) {
  const [all, setAll] = useState(false);
  const keys = Object.keys(value);
  const shown = all ? keys : keys.slice(0, KEYS);
  return (
    <div className="kiseki-value-pairs" data-depth={depth || undefined}>
      {shown.map((key) => (
        <div key={key} className="kiseki-value-pair">
          <span className="kiseki-value-key">{key}</span>
          <span className="kiseki-value-val">
            <Value value={value[key]} depth={depth + 1} />
          </span>
        </div>
      ))}
      {keys.length > KEYS && (
        <More open={all} onClick={() => setAll((a) => !a)} label={`${keys.length - KEYS} more`} />
      )}
    </div>
  );
}

function Table({ rows, depth }: { rows: Record<string, Json>[]; depth: number }) {
  const [all, setAll] = useState(false);
  // Columns: the keys most rows carry with scalar values, in first-seen order.
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const [key, v] of Object.entries(row))
      if (typeof v !== "object" || v === null) counts.set(key, (counts.get(key) ?? 0) + 1);
  const columns = [...counts]
    .filter(([, n]) => n >= rows.length / 2)
    .slice(0, COLUMNS)
    .map(([key]) => key);
  if (!columns.length) return <Items items={rows} depth={depth} />;
  const shown = all ? rows : rows.slice(0, ROWS);
  return (
    <div className="kiseki-value-table-wrap">
      <table className="kiseki-value-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows of a fixed result.
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} data-num={typeof row[c] === "number" || undefined}>
                  {row[c] == null ? "" : oneLine(String(row[c]), 60)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > ROWS && (
        <More
          open={all}
          onClick={() => setAll((a) => !a)}
          label={`${rows.length - ROWS} more rows`}
        />
      )}
    </div>
  );
}

function List({ items }: { items: Json[] }) {
  const [all, setAll] = useState(false);
  const limit = 12;
  const shown = all ? items : items.slice(0, limit);
  const long = items.some((v) => typeof v === "string" && v.length > 40);
  return (
    <div className="kiseki-value-list" data-long={long || undefined}>
      {shown.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items of a fixed result.
        <span key={i} className="kiseki-value-item">
          {item === null ? "null" : oneLine(String(item), 160)}
        </span>
      ))}
      {items.length > limit && (
        <More open={all} onClick={() => setAll((a) => !a)} label={`${items.length - limit} more`} />
      )}
    </div>
  );
}

function Items({ items, depth }: { items: Json[]; depth: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, ROWS);
  return (
    <div className="kiseki-value-items">
      {shown.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items of a fixed result.
        <div key={i} className="kiseki-value-entry">
          <Value value={item} depth={depth + 1} />
        </div>
      ))}
      {items.length > ROWS && (
        <More open={all} onClick={() => setAll((a) => !a)} label={`${items.length - ROWS} more`} />
      )}
    </div>
  );
}

function More({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="kiseki-more"
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {open ? "show less" : label}
    </button>
  );
}

/** One line for a value: "portfolio, positions, orders +2", "12 rows", or the text itself. */
export function valueSummary(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") return oneLine(String(value), 120);
  if (Array.isArray(value)) {
    if (!value.length) return "empty";
    return `${value.length} ${value.every(isRecord) ? (value.length === 1 ? "row" : "rows") : value.length === 1 ? "item" : "items"}`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "empty";
  // A small flat object reads best as its pairs.
  if (entries.length <= 3 && entries.every(([, v]) => typeof v !== "object" || v === null))
    return oneLine(entries.map(([k, v]) => `${k} ${v}`).join(" · "), 120);
  // One key wrapping the rest says nothing; read through it.
  if (entries.length === 1 && typeof entries[0]?.[1] === "object")
    return valueSummary(entries[0][1]);
  const keys = entries.map(([k, v]) => (Array.isArray(v) ? `${k} (${v.length})` : k));
  return keys.length > 4 ? `${keys.slice(0, 4).join(", ")} +${keys.length - 4}` : keys.join(", ");
}
