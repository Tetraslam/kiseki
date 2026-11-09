/** The demos on the home page, in order. Every one is a real recorded run; see fixtures/README.md. */
export const demos = [
  {
    id: "coding",
    file: "opencode-ledger-json-flag.json",
    label: "coding session",
    note: "haiku fixes seven failing tests, then adds a --json flag.",
  },
  {
    id: "parallel",
    file: "opencode-ledger-review.json",
    label: "parallel subagents",
    note: "sonnet sends three explore subagents at once. press map.",
  },
  {
    id: "custom",
    file: "ai-sdk-package-scout.json",
    label: "custom renderer",
    note: "an ai sdk agent's npm results, drawn by the host's own cards.",
    custom: true,
  },
  {
    id: "compare",
    files: ["opencode-ledger-sonnet.json", "opencode-ledger-haiku.json"],
    label: "two runs compared",
    note: "sonnet and haiku on the same task, aligned step by step.",
  },
  {
    id: "live",
    file: "opencode-ledger-haiku.json",
    label: "live",
    note: "a recorded run replayed as it streams in.",
    live: true,
  },
] as const;
