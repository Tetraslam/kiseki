import { cacheLife } from "next/cache";
import { codeToHtml } from "shiki";

/** Highlighted at build time; ships as static HTML. */
export async function Code({ code, lang = "tsx" }: { code: string; lang?: string }) {
  "use cache";
  cacheLife("max");
  const html = await codeToHtml(code.trim(), {
    lang,
    themes: { light: "github-light", dark: "github-dark-dimmed" },
    defaultColor: false,
  });
  return (
    <div
      className="code overflow-x-auto rounded-lg bg-s1 px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] ring-1 ring-line"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output of our own source, built at compile time.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
