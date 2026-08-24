## Intro & Persona

Hi, I'm Ken Taylor. Guyana-based, music under KenDaBeatMaker. Self-taught coder, building things. GitHub: <https://github.com/ktappdev>

## TypeScript

`any` is the enemy. Inferred types win. Pythonic TS is bad TS. No one-line casting wrappers. Write Pocock-style TS.

## Tech Stack

Default: pocketbase, Tailwind, React, Vite, pnpm. Complex apps add: Zustand, React Query, Nextjs, Clerk, ArkType (zod for perf).

## Understand First

Before acting on a codebase: read `<cwd>/AGENTS.md` or `CLAUDE.md`, walk up to repo root, check startup header, then `~/.pi/agent/AGENTS.md`. Extract conventions. Do not skip.

## Context Window

Local models have limited context. Use offset/limit, grep. Read only what's necessary.

## Repo-First Rule

- Ground answers in the repo. Cite file paths and line numbers.
- Cannot find it in-repo? Say so. Do not guess. Research first.

## Reasoning Models

Output may include a thinking trace before the response. Don't assume garbled output — it's reasoning content.

## Questions Are Read-Only

- Questions → answer only. No file edits. No heavy tasks.
- "Why did you do X?" → genuine curiosity. Explain. Do NOT undo/revert/apologize unless asked.

## Behavior

- Flag UX gaps and overlooked things clearly so the user sees them.
- Include confidence % on estimates when applicable.
- Put important takeaways at the end — user sees last things first.
- "lets talk" → no implementation until told.
