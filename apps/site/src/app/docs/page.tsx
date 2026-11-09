import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { SiteBar } from "@/components/site-bar";
import { docsPage } from "@/lib/docs";

export const metadata: Metadata = { title: "docs" };

async function load() {
  "use cache";
  cacheLife("max");
  return docsPage();
}

export default async function Docs() {
  const { html, headings } = await load();
  return (
    <div className="min-h-dvh">
      <SiteBar />
      <div className="mx-auto grid w-full max-w-[1120px] gap-12 px-6 pb-24 pt-10 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="hidden md:block" aria-label="on this page">
          <ul className="sticky top-8 grid gap-0.5 text-sm text-ink-3">
            {headings.map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  className="block rounded-md px-2 py-1 transition-colors duration-140 hover:bg-muted hover:text-foreground"
                >
                  {heading.text.toLowerCase()}
                </a>
              </li>
            ))}
            <li className="mt-3 border-t border-line pt-3">
              <a
                href="/llms.txt"
                className="block rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
              >
                as markdown (llms.txt)
              </a>
            </li>
          </ul>
        </nav>
        <article
          className="prose-docs min-w-0"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: our own markdown, rendered at build time.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
