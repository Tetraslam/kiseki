# brief

## the product
kiseki is a react component, plus its site kiseki.sh, for reading what an agent did. engineers building agents drop it into their admin pages, eval harnesses, and local tools. the one thing they come to do: find out what happened in a run (where the time went, what broke, what changed) and jump to that step.

## the feeling
an instrument: precise, calm, legible. it should feel like a flight recorder or a scope, something you trust to tell you exactly what happened, because a trace viewer is evidence.

## direction
**native material**, with the restraint of **hardware specimen**. the product renders its own pitch: kiseki.sh opens on a real run's trajectory drawn by the component, and the page is that trace read top to bottom. no illustration, no texture, no mock screenshots.

**this is close to an attractor, the generic dark devtool, and it is chosen on purpose.** kiseki is not a destination: it gets embedded in other people's admin pages, eval harnesses, and local tools, next to UI it doesn't control. neutral surfaces are what let it sit there without fighting the host. so the surfaces stay quiet, and the identity lives in two places a generic devtool doesn't have: the trajectory drawing (a real run's shape, the one graphic) and an accent that is a specific dye rather than a default violet. the accent is aizome (藍染), the indigo of hand-dyed cloth, tied to the name: 軌跡 is the trace a path leaves, the way dye leaves its trace in thread. ai-iro (藍色) in light mode, hanada-iro (縹色) in dark. both are dusty and lean toward teal, nothing like the periwinkle of the attractor.

references:
- **ghostty**: the hero is made of the product's own material. here, the overview of a real trace is the hero graphic.
- **oxide**: technical clarity without hacker costume. hierarchy and plain labels do the work, mono only for code and numbers.
- **diffs.com**: devtools designed like devtools, and extensibility as the feature. the custom-renderer demo carries the pitch.

## identity
- **palette**: cool graphite neutrals, not paper. light: page `#f2f3f5`, surface `#f9fafb`, raised `#fdfdfe`, sunken `#e9ebef`, ink `#14161b`. dark (the primary): page `#0f1115`, surface `#151820`, raised `#1b1f28`, sunken `#0a0c10`, ink `#e4e7ee`. hairlines are ink at 8–14%.
- **accent**: aizome. light ai-iro `#1d5f86`, dark hanada-iro `#5fa7cc`. it means **position**: the trajectory thread, the selected step, the viewport band on the overview, and the live tail. never decoration, never success. errors get their own red (`#c8384a` / `#ff7a86`); waiting gets a neutral hatch; success stays ink.
- **type**: inter for ui, commit mono for code, paths, and numbers. no display face in the component. the site's wordmark is 軌跡 in shippori mincho b1 at nav size, not as a hero.
- **shape**: 4px radius, 1px hairlines, no soft shadows inside the component. dense: 13px text, 24px tool lines, a 40px gutter of step numbers.
- **texture and shaders**: none. the trajectory drawing is the only graphic.
- **motion**: `--kiseki-track: cubic-bezier(0.25, 0.8, 0.25, 1)` for things that move to a position (selection, the viewport band, scrolling into view), `--kiseki-open: cubic-bezier(0.3, 0.7, 0, 1)` for blocks growing in place. durations 90 / 180 / 280 ms. movement settles like a needle: fast, no overshoot. reduced motion snaps.

## hierarchy
the trace is the product. it reads top to bottom, in order, as a run made of turns, and nothing is hoisted out of it.
- **bar**: one quiet line: an outcome dot and word, then duration, steps, calls, tokens, cost, and the agent, all small. search and a "map" toggle sit at its right. no answer block, no prompt preview: the prompt is the first turn and the answer is the last.
- **turns**: each step is a section under a thin rule carrying its number, a label when it isn't the main agent (prompt, explore, system), and its time. tokens and duration join the rule on hover, or always when a step stands out.
- **prose is first-class**: the agent's text and reasoning read at full weight, 14px at a 76ch measure. reasoning is a paragraph with a left rule, never dimmed or collapsed by default; long reasoning shows its opening six lines. hosts can quiet it with `prose="quiet"`.
- **tool calls**: compact lines under the prose: a toggle, the tool name as a small tag, what it acted on, its duration. the result sits beneath in a quieter line (passed and failed counts, the line range, +/- counts, the match count) and the full output opens on demand. edits show their diff inline when small, because the diff is the result.
- **live**: a cursor sits at the end of the latest turn, and "scroll to latest" appears only when the reader has scrolled up.
- **the map** (the trajectory overview) is secondary: closed by default, opened from the bar, and floating over the trace rather than pushing it down.
- **site**: one short line on what kiseki is, then the trace as the hero, then the custom-renderer code and install.

the bar for every row, gap, type size, and hover is diffs.com and trees.software: hairline frames, 6px hover radii, 28px interactive lines, 12–13px ui type, 20px code lines, and soft ink rather than pure white.

## not parc
the closest existing look is parc (warm paper, ember accent, soft social surfaces). kiseki differs in three concrete ways:
1. cool graphite surfaces with an aizome accent that marks position. parc uses warm off-white paper and an ember that means alive or yours.
2. instrument density: 4px radius, hairlines, no shadows, 24px tool lines. parc uses generous rounded cards for reading posts.
3. its signature is a data drawing, the trajectory of a real run. parc's is a dither shader field on input surfaces. kiseki has no shaders at all.
