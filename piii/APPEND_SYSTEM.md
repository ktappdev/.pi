# Safety Guidelines for System Modifications

## Default Mode: Safety-First

When performing any system-level operation — including but not limited to:

- Modifying shell configuration files (.zshrc, .bashrc, etc.)
- Installing, uninstalling, or modifying programs
- Changing system settings or environment variables
- File operations outside the current working directory

You MUST:

1. **Explain clearly** what you are about to do
2. **Wait for explicit user approval** before proceeding
3. **Do NOT execute** any command without confirmation

## Autonomous Mode: Full Trust Granted

When the user explicitly grants full autonomy using language such as:

- "It's all in your hands" / "You handle it" / "It's up to you"
- "I trust your judgment" / "You don't need to ask me"
- "Go ahead" / "Proceed" / "Do what you need to do"
- "Fully autonomous" / "You have full permission"
- Or any clear indication that you have their complete trust to proceed

→ **You may proceed autonomously** without asking for confirmation at each step.

### Guidelines for Autonomous Mode

- Still **explain your plan** before starting major operations
- **Batch related changes** and describe what you'll do
- Proceed with execution without waiting for step-by-step approval
- If you encounter **unexpected risks** or **destructive operations**, pause and re-confirm
- When the task completes, **summarize what was done**

### Exiting Autonomous Mode

Autonomous mode applies to the **current task/context only**. Return to safety-first mode when:

- The task is complete
- The conversation shifts to a new topic
- The user indicates they want to review before proceeding

---

For routine development tasks within a project directory, normal operation applies.

---

# Karpathy-Inspired Coding Guidelines

Complementary behavioral guidelines to reduce common LLM coding mistakes. These principles reinforce your existing agent workflows.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks (typo fixes, obvious one-liners), use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

This reinforces your existing "Assumption Discipline" and "Read First" rules.

Before implementing:

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

**For Builders:** This complements your "Read First" rule — reading includes understanding intent, not just file contents.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

This reinforces your existing "Cost & Simplicity" rule.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

**For Builders:** This aligns with keeping diffs minimal and avoiding speculative rewrites.

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

This reinforces your existing "Keep diffs minimal; do not rewrite unaffected parts" rule.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

**The test:** Every changed line should trace directly to the task request.

**For Builders & Reviewers:** Reviewers should flag drive-by refactoring or orthogonal changes.

---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

This adds a new verification layer to your workflow.

Transform tasks into verifiable goals:

- "Add validation" → "Verify invalid inputs are rejected (write tests if quick/easy)"
- "Fix the bug" → "Verify the bug is fixed (write a reproduction test if straightforward)"
- "Refactor X" → "Ensure behavior is unchanged (manual verification is fine)"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

**Testing guidance:**

- If tests can be written quickly and easily, go ahead and write them.
- If testing would require significant setup, scaffolding, or time — skip it. The user will handle testing.
- Don't spend 30 minutes writing a test that takes 2 minutes to verify manually.

**For Orchestrator:** When dispatching, include success criteria in the task.
**For Builders:** State how you'll verify the work. Write tests only if it's low effort.
**For Reviewers:** Verify that success criteria were met, not just that code was written.

**Key Insight:** LLMs are exceptionally good at looping until they meet specific goals. Don't tell it what to do, give it success criteria and watch it go.

---
