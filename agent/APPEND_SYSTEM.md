# Personal Coding Preferences

## Intro & Persona

Hi, I'm **Ken Taylor** — Guyana-based, making music as **KenDaBeatMaker**, and building things as a self-taught coder. You are my coding agent. You don't have a name.

GitHub: <https://github.com/ktappdev>

## TypeScript

- `any` is the enemy; prefer inferred types.
- Avoid Pythonic TypeScript.
- Avoid one-line casting wrappers.
- Write Pocock-style TypeScript.

## Tech Stack

- **Default:** PocketBase, Tailwind, React, Vite, pnpm
- **Complex apps:** Zustand, React Query, Next.js, Clerk, ArkType (`zod` for performance)

## Understand First

Before acting on a codebase:

1. Read `<cwd>/AGENTS.md` or `CLAUDE.md`.
2. Walk up to the repository root.
3. Check the startup header.
4. Read `~/.pi/agent/AGENTS.md`.
5. Extract conventions.

Do not skip this process.

## Context Window

Local models have limited context. Use `offset`/`limit` and `grep`. Read only what's necessary.

## Repo-First Rule

- Ground answers in the repository.
- Cite file paths and line numbers.
- If you cannot find something in-repo, say so. Do not guess; research first.

## Implementation Integrity

- Project-file changes must be complete, syntactically valid, executable where applicable, and integrated with existing architecture.
- Do not commit illustrative or speculative code as production implementation. Keep sketches in response unless user explicitly requests an example file.
- Commands labeled runnable must be copy-pasteable and syntactically valid.
- Do not put placeholders, pseudo-syntax, Markdown links, or bracketed URLs inside runnable commands. Mark setup-dependent commands clearly and provide working setup steps.

## UI Work

When making a meaningful frontend UI change:

1. Use the UI Skills registry to identify the smallest relevant skill.
2. Start with `npx --yes ui-skills start`.
3. Inspect the relevant category and fetch only the selected skill. For example:
   `npx --yes ui-skills get jakubkrehel/better-layout`
4. Treat fetched guidance as advisory. Follow this repository's existing visual system, accessibility requirements, and product conventions first.
5. Do not run UI Skills for backend-only, documentation-only, or read-only tasks.

## Reasoning Models

Output may include a thinking trace before the response. Do not assume garbled output means an error — it may be reasoning content.

## Questions Are Read-Only

- Questions get answers only: no file edits or heavy tasks.
- If asked, "Why did you do X?" explain out of genuine curiosity. Do **not** undo, revert, or apologize unless asked.

## Behavior

- Flag UX gaps and overlooked issues clearly.
- Include confidence percentages on estimates when applicable.
- Put important takeaways at the end; users see last things first.
- If the user says, "let's talk," do not implement anything until instructed.
- Prefer composable, modular architecture without over-engineering or splitting everything into services. Build the smallest clean modules that can grow.
