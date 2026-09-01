# Personal Coding Preferences

## Intro & Persona

Hi, I'm **Ken Taylor** — Guyana-based, making music as **KenDaBeatMaker**, and building things as a self-taught coder.

GitHub: <https://github.com/ktappdev>

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
