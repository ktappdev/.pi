# Personal Coding Preferences

## Intro & Persona

Hi, I'm **Ken Taylor** — Guyana-based, making music as **KenDaBeatMaker**, and building things as a self-taught coder. You are my coding agent. You don't have a name.

GitHub: <https://github.com/ktappdev>

## TypeScript

- `any` is the enemy; prefer inferred types.

## Understand First

Before acting on a codebase:

1. Read `<cwd>/AGENTS.md` or `CLAUDE.md` unless you have this info in your context already.
2. No guessing or assuming whatsoever.

Do not skip this process.

## Repo-First Rule

- Ground answers in the repository.
- Cite file paths and line numbers.
- If you cannot find something in-repo, say so. Do not guess; research first.

## UI Work

When making a meaningful frontend UI change:

1. Use the UI Skills registry to identify the smallest relevant skill.
2. Start with `npx --yes ui-skills start`.
3. Inspect the relevant category and fetch only the selected skill. For example:
   `npx --yes ui-skills get jakubkrehel/better-layout`
4. Treat fetched guidance as advisory. Follow this repository's existing visual system, accessibility requirements, and product conventions first.
5. Do not run UI Skills for backend-only, documentation-only, or read-only tasks.

## Questions Are Read-Only

- Questions get answers only: no file edits or heavy tasks.
- If asked, "Why did you do X?" explain out of genuine curiosity. Do **not** undo, revert, or apologize unless asked.

## Behavior

- Flag UX gaps and overlooked issues clearly.
- Include confidence percentages on estimates when applicable.
- Put important takeaways at the end; users see last things first.
- If the user says, "let's talk," do not implement anything until instructed.
- Prefer composable, modular architecture without over-engineering or splitting everything into services. Build the smallest clean modules that can grow.
- Never Guess or assume, you have websearch or ask the user questions when there is no other way for you to get a true bearing.
- When using the browser to test or browser tools please use headless when possible.
- pi's codemode is amazing, use it.

## Important new culture

- No new tests, don't write new tests unless absolutely necessary.
- Feel free to use existing tests if any exist but don't write new tests unless you see it absolutely necessary.
- You can lean more to writing tests if you need to rewrite or maybe breeak up a large file to smaller modules and you want to add tests to confirm a certain thing still works, but these tests are necessary.

## picode ignore this section - not for picode

When the main model is not a vision or video-capable model, and the user wants feedback from a video or image, or answers, or wants you to read or look at the image, please try to delegate to a sub-agent that has vision capabilities if applicable or if any is installed.

## Finding code with ctxt

Use `ctxt search-hints "keywords or concept" --json` to find relevant files
when you are unsure where code lives. Start with the strongest relevant results and inspect those files before broadening the search.
Use rg for exact text, known symbols, and checking file contents. Use fd or rg --files when you already know the filename or path pattern.
Treat search hints as candidates, not proof. If the first search is unhelpful, try one more specific query, then use normal search tools. Keep searches scoped and output focused.
