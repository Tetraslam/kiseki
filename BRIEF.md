# brief

## the product
kiseki is a react component, plus its site kiseki.sh, for reading what an agent did. engineers building agents drop it into their admin pages, eval harnesses, and local tools. the one thing they come to do: find out what happened in a run (where the time went, what broke, what changed) and jump to that step.

## the feeling
an instrument: precise, calm, legible. it should feel like a flight recorder or a scope, something you trust to tell you exactly what happened, because a trace viewer is evidence.

## direction
**native material**, with the restraint of **hardware specimen**. the product renders its own pitch: kiseki.sh opens on a real run's trajectory drawn by the component, and the page is that trace read top to bottom. no illustration, no texture, no mock screenshots.

references:
- **ghostty**: the hero is made of the product's own material. here, the overview of a real trace is the hero graphic.
- **oxide**: technical clarity without hacker costume. hierarchy and plain labels do the work, mono only for code and numbers.
- **diffs.com**: devtools designed like devtools, and extensibility as the feature. the custom-renderer demo carries the pitch.

## identity
- **palette**: cool graphite neutrals, not paper. light: page `#f2f3f5`, surface `#f9fafb`, raised `#fdfdfe`, sunken `#e9ebef`, ink `#14161b`. dark (the primary): page `#0f1115`, surface `#151820`, raised `#1b1f28`, sunken `#0a0c10`, ink `#e4e7ee`. hairlines are ink at 8–14%.
- **accent**: indigo (藍), light `#3b4fd8`, dark `#8c9bff`. it means **position**: the trajectory line, the selected step, the viewport band on the overview, and the live tail. never decoration, never success. errors get their own red (`#d03a4c` / `#ff7a86`); waiting gets a neutral hatch; success stays ink.
- **type**: inter for ui, commit mono for code, paths, and numbers. no display face in the component. the site's wordmark is 軌跡 in shippori mincho b1 at nav size, not as a hero.
- **shape**: 4px radius, 1px hairlines, no soft shadows inside the component. dense: 13px text, 24px tool lines, a 40px gutter of step numbers.
- **texture and shaders**: none. the trajectory drawing is the only graphic.
- **motion**: `--kiseki-track: cubic-bezier(0.25, 0.8, 0.25, 1)` for things that move to a position (selection, the viewport band, scrolling into view), `--kiseki-open: cubic-bezier(0.3, 0.7, 0, 1)` for blocks growing in place. durations 90 / 180 / 280 ms. movement settles like a needle: fast, no overshoot. reduced motion snaps.

## hierarchy
- **trace header**: first the outcome (succeeded, failed, error, interrupted, or reward) with the agent's final answer or result. second, duration, cost, and failures, the numbers someone checks. the prompt and the remaining metrics (steps, calls, tokens, model) recede into one quiet line.
- **overview**: the run's shape over time. lanes for the main agent and its subagents, waiting shown as hatching, errors as red marks, the viewport as an indigo band. click to jump.
- **transcript rows**: the content and the tool results come first. the role is implied by layout (a user turn is a block and starts a new section; agent text is plain). no repeated "agent" label. step numbers sit in the gutter. tokens and duration show only when a step stands out, or on hover.
- **tool rows**: the result leads (exit status and output, the diff, the matches), then the target (command, path, pattern), and the tool's name recedes. raw json only as a fallback.
- **site**: one sentence on what kiseki is for, then the component on a real run, then the demos, each named for what it shows, then install and docs.

## not parc
the closest existing look is parc (warm paper, ember accent, soft social surfaces). kiseki differs in three concrete ways:
1. cool graphite surfaces with an indigo accent that marks position. parc uses warm off-white paper and an ember that means alive or yours.
2. instrument density: 4px radius, hairlines, no shadows, 24px tool lines. parc uses generous rounded cards for reading posts.
3. its signature is a data drawing, the trajectory of a real run. parc's is a dither shader field on input surfaces. kiseki has no shaders at all.
