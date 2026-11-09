import { cacheLife } from "next/cache";
import { docsMarkdown } from "@/lib/docs";

async function body() {
  "use cache";
  cacheLife("max");
  return docsMarkdown();
}

export async function GET() {
  return new Response(await body(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
