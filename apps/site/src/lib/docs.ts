import { readFile } from "node:fs/promises";
import { join } from "node:path";
import rehypeShiki from "@shikijs/rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import perf from "../../../../docs/perf-results.json";

/** The docs as markdown, with measured numbers filled in. Shared by /docs and /llms.txt. */
export async function docsMarkdown(): Promise<string> {
  const text = await readFile(join(process.cwd(), "src", "content", "docs.md"), "utf8");
  return text.replaceAll("FIRST_ROWS", String(Math.round(perf.firstRowsMedianMs)));
}

export interface DocsPage {
  html: string;
  headings: { id: string; text: string }[];
}

export async function docsPage(): Promise<DocsPage> {
  const markdown = await docsMarkdown();
  // Our own content, so no sanitizer; nothing here comes from a user.
  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rehypeShiki, {
        themes: { light: "github-light", dark: "github-dark-dimmed" },
        defaultColor: false,
      })
      .use(rehypeStringify)
      .process(markdown),
  );
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => {
    const text = match[1] as string;
    return {
      text,
      id: text
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replace(/ /g, "-"),
    };
  });
  return { html, headings };
}
