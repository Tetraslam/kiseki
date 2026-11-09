import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TraceRecord } from "@tetraslam/kiseki-core";
import { cacheLife } from "next/cache";

/** Reads a fixture at build time. The prebuild script copies them into public/fixtures. */
export async function fixture(name: string): Promise<TraceRecord> {
  "use cache";
  cacheLife("max");
  const text = await readFile(join(process.cwd(), "public", "fixtures", name), "utf8");
  return JSON.parse(text) as TraceRecord;
}
