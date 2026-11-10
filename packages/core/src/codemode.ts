/**
 * Code Mode: the agent writes a JavaScript snippet that calls tools (`tools.<ns>.<name>(...)`)
 * and one `execute` call runs it. To read such a trace you want the tools the snippet called,
 * not the snippet, so this finds them, with the argument that best says what each was for.
 */

export interface CodeModeCall {
  /** Namespace, such as `robinhood`; empty for the catalog's own `search`. */
  namespace: string;
  name: string;
  /** The most telling literal argument (a query, a symbol, a URL), when there is one. */
  arg?: string;
}

const IDENT = "[A-Za-z_$][\\w$]*";
const CALL = new RegExp(
  `\\btools\\.(${IDENT})(?:\\.(${IDENT})|\\[\\s*(["'\`])([^"'\`]+)\\3\\s*\\])\\s*\\(|(?<![.\\w$])(search)\\s*\\(`,
  "g",
);
/** Keys whose values say what a call was for, best first. */
const SALIENT = [
  "query",
  "q",
  "symbol",
  "symbols",
  "ticker",
  "url",
  "urls",
  "path",
  "text",
  "id",
  "namespace",
];

/** The tools a Code Mode snippet calls, in order, each once per distinct argument. */
export function codeModeCalls(code: string): CodeModeCall[] {
  const out: CodeModeCall[] = [];
  const seen = new Set<string>();
  const source = stripComments(code);
  for (const match of source.matchAll(CALL)) {
    const open = (match.index ?? 0) + match[0].length;
    const args = balanced(source, open);
    const call: CodeModeCall = match[5]
      ? { namespace: "", name: "search", arg: catalogQuery(args) }
      : {
          namespace: match[1] as string,
          name: (match[2] ?? match[4]) as string,
          arg: salient(args),
        };
    const key = `${call.namespace}.${call.name}:${call.arg ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

/** `robinhood.get_portfolio` or `x.search_posts 'NVDA'`. */
export function formatCodeModeCall(call: CodeModeCall): string {
  const name = call.namespace ? `${call.namespace}.${call.name}` : call.name;
  return call.arg ? `${name} '${call.arg}'` : name;
}

/**
 * A Code Mode result as a value: the JSON the snippet returned, or undefined when the text isn't
 * JSON (a thrown error, a log, a truncated payload).
 */
export function codeModeValue(text: string | undefined): unknown {
  if (!text) return undefined;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    if (start > 0) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** The text between an opening parenthesis and its match, skipping strings. */
function balanced(source: string, from: number): string {
  let depth = 1;
  let quote = "";
  for (let i = from; i < source.length; i++) {
    const ch = source[i] as string;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return source.slice(from, i);
    }
  }
  return source.slice(from, from + 400);
}

function salient(args: string): string | undefined {
  const text = args.trim();
  if (!text) return undefined;
  const literal = (s: string) => /^(["'`])((?:\\.|(?!\1).)*)\1/.exec(s.trim())?.[2];
  // A bare literal: tools.x.get_user("jack")
  const bare = literal(text);
  if (bare && !text.startsWith("{")) return clip(bare);
  for (const key of SALIENT) {
    const at = new RegExp(`(?:^|[{,\\s])["']?${key}["']?\\s*:\\s*`).exec(text);
    if (!at) continue;
    const rest = text.slice(at.index + at[0].length);
    const value = literal(rest);
    if (value) return clip(value);
    const list = /^\[([^\]]*)\]/.exec(rest)?.[1];
    if (list) {
      const items = [...list.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
      if (items.length) return clip(items.join(", "));
    }
  }
  return undefined;
}

/** The catalog's own `search({ namespace, query })`: "x: recent posts", or just the namespace. */
function catalogQuery(args: string): string | undefined {
  const field = (key: string) =>
    new RegExp(`["']?${key}["']?\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(args)?.[2];
  const namespace = field("namespace");
  const query = field("query");
  const text = namespace && query ? `${namespace}: ${query}` : (namespace ?? query);
  return text ? clip(text) : undefined;
}

const clip = (s: string) => (s.length > 48 ? `${s.slice(0, 47)}…` : s);
