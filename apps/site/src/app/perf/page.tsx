import type { Metadata } from "next";
import { Suspense } from "react";
import { PerfHarness } from "./harness";

export const metadata: Metadata = { title: "perf", robots: { index: false } };

/** The page the perf script drives. Not linked from the site. */
export default function PerfPage() {
  return (
    <Suspense>
      <PerfHarness />
    </Suspense>
  );
}
