---
description: Implement, validate, commit, and optionally push a task end to end
argument-hint: "[task or additional instructions]"
---

Ship this task end to end.

Task:
${@:-Use the task described in the conversation.}

First understand the existing architecture, conventions, and relevant files. Read the applicable project instructions and startup guidance. Reuse existing components and patterns wherever appropriate.

Implement the complete solution for the stated task. Make all necessary in-scope code and configuration changes. Keep the implementation modular, consistent with the project, and limited to the requested scope.

When applicable, handle:
- loading, error, and empty states
- mobile and responsive behavior
- accessibility and keyboard interaction
- validation and edge cases
- security and failure handling

Do not stop at analysis, recommendations, or a partial implementation. Do not ask for permission for normal in-scope actions. Make reasonable assumptions and proceed.

Ask me only when:
- a decision would materially change product behavior
- required information or credentials are genuinely missing
- the action is destructive or outside the stated scope

If blocked, exhaust reasonable safe alternatives first. Then clearly state:
- the exact blocker
- what you tried
- the next action needed

Before finishing:
- inspect git status, the current branch, and existing changes before editing
- run the relevant tests, lint, type-check, and build checks
- fix failures introduced by the work
- review the final diff for regressions, omissions, unrelated changes, and accidental secrets

After validation succeeds:
- create one focused commit containing only the changes made for this task, unless the repository instructions prohibit commits or there are no changes to commit
- preserve pre-existing user changes and never include unrelated files in the commit
- push the current branch only when explicitly requested in the task instructions or authorized by standing project instructions
- never force-push, rewrite unrelated history, amend someone else's commit, or push secrets
- if committing or pushing is unavailable, report the exact reason instead of silently skipping it

You are finished only when the stated success criteria are met and validation is complete.

Report exactly:
- what changed
- what was verified and the results
- the commit hash, if committed
- the push status, if a push was requested
- any remaining limitations or blockers
