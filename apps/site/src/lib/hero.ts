/** The demos, in order. Every trace is a real recorded run; see fixtures/README.md. */
export const demos = [
  {
    id: "chat",
    kind: "chat",
    label: "chat",
    file: "ai-sdk-package-scout.json",
  },
  {
    id: "coding",
    kind: "coding",
    label: "coding agent",
    file: "opencode-ledger-month.json",
  },
  {
    id: "runs",
    kind: "runs",
    label: "runs",
    files: [
      "opencode-attachments.json",
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
    files: ["opencode-ledger-sonnet.json", "opencode-ledger-haiku.json"],
  },
  {
    id: "custom",
    kind: "custom",
    label: "custom tools",
    file: "opencode-research.json",
  },
] as const;
