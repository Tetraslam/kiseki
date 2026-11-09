// A real AI SDK agent: picks a React virtualizer from live npm registry data.
import { writeFileSync } from "node:fs";
// Recorded fixtures/ai-sdk-package-scout.json. Copy into packages/adapters (so "ai" resolves), build
// the adapters, and run with AI Gateway credentials: node .scout.mjs <model> <out.json>
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { createTraceRecorder } from "./dist/ai-sdk.js";

const model = process.argv[2] ?? "anthropic/claude-sonnet-5-5";
const out = process.argv[3] ?? "trace.json";
const prompt =
  "I'm building a chat log in React where rows have variable, changing heights. Which virtualization library should I use? Search npm, check the top candidates' details and weekly downloads, and recommend one in a short paragraph.";

const searchPackages = tool({
  description: "Search the npm registry. Returns the top packages for a query.",
  inputSchema: jsonSchema({
    type: "object",
    properties: { query: { type: "string" }, size: { type: "integer", minimum: 1, maximum: 10 } },
    required: ["query"],
  }),
  execute: async ({ query, size = 6 }) => {
    const r = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`,
    );
    const data = await r.json();
    return data.objects.map((o) => ({
      name: o.package.name,
      version: o.package.version,
      description: o.package.description,
      date: o.package.date,
      links: o.package.links,
    }));
  },
});

const packageDetails = tool({
  description:
    "Details for one npm package: latest version, license, publish date, dependencies, and weekly downloads.",
  inputSchema: jsonSchema({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  }),
  execute: async ({ name }) => {
    const [meta, downloads] = await Promise.all([
      fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`).then(
        (r) => r.json(),
      ),
      fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`).then((r) => r.json()),
    ]);
    if (meta.error) throw new Error(`npm: ${meta.error}`);
    const latest = meta["dist-tags"]?.latest;
    const version = meta.versions?.[latest] ?? {};
    return {
      name,
      latest,
      license: version.license ?? meta.license,
      published: meta.time?.[latest],
      created: meta.time?.created,
      dependencies: Object.keys(version.dependencies ?? {}).length,
      peerDependencies: version.peerDependencies ?? {},
      weeklyDownloads: downloads.downloads ?? null,
      repository: typeof meta.repository === "string" ? meta.repository : meta.repository?.url,
    };
  },
});

const recorder = createTraceRecorder({
  agent: { name: "package-scout", version: "0.1.0" },
  task: { description: prompt, source: "user_prompt" },
  prompt,
});
const result = await generateText({
  model,
  prompt,
  tools: { searchPackages, packageDetails },
  stopWhen: stepCountIs(12),
  onStepFinish: recorder.onStepFinish,
});
const record = recorder.record();
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(result.text);
console.log(record.steps.length, "steps");
