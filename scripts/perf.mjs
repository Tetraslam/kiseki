// Measures kiseki against the budgets in DESIGN.md, in Chromium, against the built site.
// Usage: pnpm --filter @kiseki/site build && node scripts/perf.mjs [--url http://localhost:4317]
// Writes docs/perf-results.json and prints a report.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const urlArg = args.indexOf("--url");
let base = urlArg >= 0 ? args[urlArg + 1] : undefined;
let server;
if (!base) {
  base = "http://localhost:4317";
  server = spawn("pnpm", ["exec", "next", "start", "-p", "4317"], {
    cwd: "apps/site",
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Records layout shifts (with and without recent input) and long tasks from the first byte.
const observe = () => {
  window.__perf = { shifts: [], longTasks: [] };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__perf.shifts.push({
        value: entry.value,
        recent: entry.hadRecentInput,
        at: entry.startTime,
        sources: (entry.sources ?? [])
          .map((s) => s.node?.className ?? s.node?.nodeName ?? "?")
          .slice(0, 3),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__perf.longTasks.push({ at: entry.startTime, ms: entry.duration });
  }).observe({ type: "longtask", buffered: true });
};

const browser = await chromium.launch();
const results = {};

async function open(query) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.addInitScript(observe);
  await page.goto(`${base}/perf?${query}`);
  await page.waitForFunction(() => window.__kiseki?.ready, null, { timeout: 60_000 });
  return { page, context };
}

const marks = (page) =>
  page.evaluate(() =>
    Object.fromEntries(performance.getEntriesByType("mark").map((m) => [m.name, m.startTime])),
  );
const perf = (page) => page.evaluate(() => window.__perf);
const shiftSum = (shifts, since = 0) =>
  shifts.filter((s) => !s.recent && s.at >= since).reduce((sum, s) => sum + s.value, 0);
/** Viewport tops of the rows on screen, keyed by step. */
const rowTops = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".kiseki-scroll");
    const bounds = scroller.getBoundingClientRect();
    const tops = {};
    for (const row of document.querySelectorAll(".kiseki-row")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > bounds.top && rect.top < bounds.bottom) tops[row.dataset.key] = rect.top;
    }
    return tops;
  });
const moved = (before, after, keys = Object.keys(before)) =>
  Math.max(0, ...keys.filter((k) => k in after).map((k) => Math.abs(after[k] - before[k])));

// 1. First paint of 10,000 steps, five cold page loads; the budget is judged on the median.
{
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const { page, context } = await open("fixture=synthetic-10k.jsonl");
    const m = await marks(page);
    samples.push(Math.round(m["kiseki:painted"] - m["kiseki:parsed"]));
    await context.close();
  }
  results.firstRowsSamplesMs = samples;
  results.firstRowsMedianMs = [...samples].sort((a, b) => a - b)[2];
}
{
  const { page, context } = await open("fixture=synthetic-10k.jsonl");
  const m = await marks(page);
  const p = await perf(page);
  results.steps = await page.evaluate(() => window.__kiseki.steps);
  results.parseMs = m["kiseki:parsed"] - m["kiseki:fetched"];
  results.firstRowsMs = m["kiseki:painted"] - m["kiseki:parsed"];
  results.firstRowsCommitMs = m["kiseki:committed"] - m["kiseki:parsed"];
  results.longTasksAfterParse = p.longTasks
    .filter((t) => t.at >= m["kiseki:parsed"])
    .map((t) => Math.round(t.ms));
  results.domRows = await page.evaluate(() => document.querySelectorAll(".kiseki-row").length);
  results.diffsLoadedAtRest = await page.evaluate(() => !!customElements.get("diffs-container"));

  console.error("2. Scrolling", JSON.stringify(results));
  // 2. Scrolling: wheel down through thousands of rows and back up.
  const box = await page.locator(".kiseki-scroll").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scrollStart = await page.evaluate(() => performance.now());
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(16);
  }
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  // Rows already on screen must hold still while the rows above them get measured.
  const settle = await rowTops(page);
  await page.waitForTimeout(500);
  results.scrollSettleMovePx = moved(settle, await rowTops(page));
  const afterScroll = await perf(page);
  results.scrollCls = shiftSum(afterScroll.shifts, scrollStart);
  results.scrollLongTasks = afterScroll.longTasks
    .filter((t) => t.at >= scrollStart)
    .map((t) => Math.round(t.ms));

  console.error("3. Expanding", JSON.stringify(results));
  // 3. Expanding: open calls in place; rows above the opened one must not move.
  await page.evaluate(() => {
    document.querySelector(".kiseki-scroll").scrollTop = 40_000;
  });
  await page.waitForTimeout(300);
  let worstAbove = 0;
  for (let i = 0; i < 8; i++) {
    // A call line fully on screen, so the click itself doesn't scroll.
    const index = await page.evaluate(() => {
      const bounds = document.querySelector(".kiseki-scroll").getBoundingClientRect();
      const lines = [...document.querySelectorAll(".kiseki-call-line")];
      const visible = lines
        .map((el, i) => ({
          i,
          rect: el.getBoundingClientRect(),
          open: el.getAttribute("aria-expanded") === "true",
        }))
        .filter(
          (l) => !l.open && l.rect.top > bounds.top + 120 && l.rect.bottom < bounds.bottom - 120,
        );
      return visible[Math.min(visible.length - 1, 1)]?.i ?? -1;
    });
    if (index < 0) break;
    const target = page.locator(".kiseki-call-line").nth(index);
    const key = await target.evaluate((el) => el.closest(".kiseki-row").dataset.key);
    const before = await rowTops(page);
    const targetTop = before[key];
    const above = Object.keys(before).filter((k) => before[k] < targetTop);
    await target.click();
    await page.waitForTimeout(450);
    worstAbove = Math.max(worstAbove, moved(before, await rowTops(page), above));
  }
  results.expandMovesRowsAbovePx = worstAbove;
  results.diffsLoadedAfterExpand = await page.evaluate(
    () => !!customElements.get("diffs-container"),
  );
  const all = (await perf(page)).shifts;
  results.cls = shiftSum(all);
  results.shiftsWithoutInput = all
    .filter((x) => !x.recent)
    .map((x) => ({ ...x, at: Math.round(x.at - m["kiseki:parsed"]) }));
  await context.close();
}

console.error("4. Opening", JSON.stringify(results));
// 4. @pierre/diffs loads only once a diff is on screen: never for a trace without edits.
{
  const { page, context } = await open("fixture=errors.json");
  await page.waitForTimeout(1500);
  const withoutEdits = await page.evaluate(() => !!customElements.get("diffs-container"));
  await context.close();
  const second = await open("fixture=synthetic-300.json");
  const diff = second.page.locator(".kiseki-diff").first();
  await diff.scrollIntoViewIfNeeded();
  await second.page.waitForFunction(() => !!customElements.get("diffs-container"), null, {
    timeout: 10_000,
  });
  // The placeholder and the real diff have the same height, once the diff on screen has rendered.
  await second.page.waitForTimeout(1500);
  const sizes = await second.page.evaluate(() =>
    [...document.querySelectorAll(".kiseki-diff")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight;
      })
      .map((el) => {
        const box = el.firstElementChild;
        return {
          reserved: Number(box?.dataset.fullHeight ?? 0),
          actual: Math.round(box?.firstElementChild?.getBoundingClientRect().height ?? 0),
        };
      }),
  );
  results.diffsLazy = { traceWithoutEdits: withoutEdits, afterDiffOnScreen: true };
  results.diffHeightErrorPx = Math.max(0, ...sizes.map((s) => Math.abs(s.actual - s.reserved)));
  await second.context.close();
}

console.error("5. Streaming", JSON.stringify(results));
// 5. Streaming: append steps while the reader is scrolled up; what they're reading holds still.
{
  const { page, context } = await open("fixture=synthetic-10k.jsonl&live=200");
  await page.waitForTimeout(400);
  const box = await page.locator(".kiseki-scroll").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400);
  const before = await rowTops(page);
  const start = await page.evaluate(() => performance.now());
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => window.__kiseki.append(1));
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
  results.streamReaderMovePx = moved(before, await rowTops(page));
  const p = await perf(page);
  results.streamCls = shiftSum(p.shifts, start);
  results.streamLongTasks = p.longTasks.filter((t) => t.at >= start).map((t) => Math.round(t.ms));

  console.error("Following:", JSON.stringify(results));
  // Following: jump to the tail, append more, and check the view stays at the bottom.
  await page.locator(".kiseki-follow").click();
  await page.waitForTimeout(800);
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__kiseki.append(1));
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(900);
  results.followGapPx = await page.evaluate(() => {
    const el = document.querySelector(".kiseki-scroll");
    return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
  });
  await context.close();
}

// 6. The site: the trace scrolls inside its window, never the page, and opening or closing a
//    call keeps the clicked line in place.
{
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(observe);
  await page.goto(`${base}/`);
  await page.waitForTimeout(800);
  const box = await page.locator("section[aria-label=trace] .kiseki-scroll").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(500);
  results.sitePageScrolledPx = await page.evaluate(() => Math.round(scrollY));
  const drift = [];
  for (let i = 0; i < 6; i++) {
    const el = (
      await page.evaluateHandle((i) => {
        const lines = [...document.querySelectorAll(".kiseki-call-line")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top > 200 && r.bottom < innerHeight - 100;
        });
        return lines[i % Math.max(1, lines.length)] ?? null;
      }, i)
    ).asElement();
    if (!el) break;
    const before = await el.evaluate((e) => e.getBoundingClientRect().top);
    await el.click();
    await page.waitForTimeout(650);
    drift.push(
      Math.round(Math.abs((await el.evaluate((e) => e.getBoundingClientRect().top)) - before)),
    );
  }
  results.siteAnchorDriftPx = Math.max(0, ...drift);
  results.siteNestedScroller = await page.evaluate(
    () => !!document.querySelector(".kiseki-scroll"),
  );
  results.siteLoadCls = shiftSum((await perf(page)).shifts);
  await context.close();
}

await browser.close();
server?.kill();

const budget = {
  firstRows: results.firstRowsMedianMs <= 100,
  noShift:
    results.cls === 0 &&
    results.scrollCls === 0 &&
    results.streamCls === 0 &&
    results.expandMovesRowsAbovePx < 1 &&
    results.streamReaderMovePx < 1 &&
    results.scrollSettleMovePx < 1,
  lazyDiffs: !results.diffsLazy.traceWithoutEdits && results.diffHeightErrorPx < 1,
  following: results.followGapPx <= 8,
  siteAnchored: results.siteAnchorDriftPx < 1 && results.sitePageScrolledPx === 0,
};
const report = { ...results, budget, measuredAt: new Date().toISOString() };
writeFileSync("docs/perf-results.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
