export function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatTokens(n: number | undefined): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCost(usd: number | undefined): string {
  if (usd == null) return "";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** Strips the provider prefix: `anthropic/claude-sonnet-5-5` reads as `claude-sonnet-5-5`. */
export function shortModel(model: string | undefined): string {
  if (!model) return "";
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

const argKeys = [
  "file_path",
  "filePath",
  "path",
  "command",
  "cmd",
  "pattern",
  "query",
  "q",
  "url",
  "description",
  "prompt",
  "name",
];

/** The one input value that best identifies a call, shown on its line. */
export function primaryArg(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  for (const key of argKeys) {
    const value = input[key];
    if (typeof value === "string" && value) return oneLine(value);
  }
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value) return oneLine(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

export function oneLine(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function wordCount(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const space = text.charCodeAt(i) <= 32;
    if (!space && !inWord) count++;
    inWord = !space;
  }
  return count;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
