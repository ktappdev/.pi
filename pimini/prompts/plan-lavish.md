---
description: Plan realistically with Pi/PICODE orchestration, then present the finished plan in Lavish
argument-hint: "<feature or task description>"
---
Plan this request using the normal planning workflow. Preserve existing planner agents, delegation, plugins, and repository conventions; do not replace or bypass them with Lavish.

Fully flush out the request into a cohesive, realistic, implementable plan:

- Inspect the repository and trace relevant code paths before deciding.
- Do not assume missing requirements, architecture, files, dependencies, or capabilities.
- Surface blockers and uncertainty early. Do not pursue paths that depend on unresolved blockers; choose viable alternatives or state what must be decided.
- Cover scope, affected files and systems, implementation sequence, data/API or UX implications, tests, edge cases, risks, and acceptance criteria when relevant.
- Keep the plan proportional. Avoid speculative work and unnecessary abstractions.

When planning is complete, use the installed Lavish skill as the final presentation layer. Build a clear, reviewable HTML artifact for the completed plan and open it with `npx -y lavish-axi`. Do not merely describe how to use Lavish. Keep the normal planner output and decisions intact; Lavish only presents them visually for review.

User request:
$@
