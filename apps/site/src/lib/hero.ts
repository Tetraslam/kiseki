/** The demos, in order. Every trace is a real recorded run; see fixtures/README.md. */
export const demos = [
  {
    id: "chat",
    kind: "chat",
    label: "chat",
    note: "streams as the agent works.",
    file: "ai-sdk-package-scout.json",
  },
  {
    id: "coding",
    kind: "coding",
    label: "coding agent",
    note: "subagents, diffs, test runs.",
    file: "opencode-ledger-month.json",
  },
  {
    id: "runs",
    kind: "runs",
    label: "runs",
    note: "every run, what happened, open one.",
    files: [
      "opencode-ledger-month.json",
      "opencode-research.json",
      "opencode-ledger-review.json",
      "opencode-ledger-json-flag.json",
      "ai-sdk-package-scout.json",
      "opencode-ledger-sonnet.json",
      "opencode-ledger-haiku.json",
      "opencode-tally.json",
    ],
  },
  {
    id: "evals",
    kind: "evals",
    label: "evals",
    note: "one prompt, two models. where did haiku go its own way?",
    files: ["opencode-ledger-sonnet.json", "opencode-ledger-haiku.json"],
  },
  {
    id: "custom",
    kind: "custom",
    label: "your tools",
    note: "search, pages read, and citations, drawn by the host.",
    file: "opencode-research.json",
  },
] as const;
