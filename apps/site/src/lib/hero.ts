/** The demos on the home page, in order. Every one is a real recorded run; see fixtures/README.md. */
export const demos = [
  {
    id: "coding",
    file: "opencode-ledger-json-flag.json",
    label: "coding session",
    note: "claude haiku 4.5 in opencode, fixing seven failing tests and adding a --json flag. every turn in order: what it thought, what it ran, and the diffs it made.",
  },
  {
    id: "parallel",
    file: "opencode-ledger-review.json",
    label: "parallel subagents",
    note: "claude sonnet 5.5 sends three explore subagents at once. open the branch to read all three; press map for the lanes over time.",
  },
  {
    id: "custom",
    file: "ai-sdk-package-scout.json",
    label: "custom renderer",
    note: "an ai sdk agent choosing a react virtualizer from live npm data. its two tools render through the host's own components, written below.",
    custom: true,
  },
  {
    id: "compare",
    files: ["opencode-ledger-sonnet.json", "opencode-ledger-haiku.json"],
    label: "two runs compared",
    note: "the same task, run by claude sonnet 5.5 and claude haiku 4.5. steps align by role and tool; tinted steps are the ones only one run took.",
  },
  {
    id: "live",
    file: "opencode-ledger-haiku.json",
    label: "live",
    note: "a recorded run replayed as it happened: steps stream in, running calls shimmer, and the view follows the tail until you scroll up.",
    live: true,
  },
] as const;
