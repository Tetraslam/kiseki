---
"@tetraslam/kiseki": minor
"@tetraslam/kiseki-core": minor
"@tetraslam/kiseki-adapters": minor
---

Code Mode `execute` calls render as the tools their snippet called, with the returned value as data (`codeModeCalls`, `codeModeValue`, `<Value>`). Subagents nest as their own blocks, every open and close animates, image and file attachments render inline (`step.attachments`, `observation.attachments`), and run details move into one popover.
