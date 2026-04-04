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

### Guidelines for Autonomous Mode:

- Still **explain your plan** before starting major operations
- **Batch related changes** and describe what you'll do
- Proceed with execution without waiting for step-by-step approval
- If you encounter **unexpected risks** or **destructive operations**, pause and re-confirm
- When the task completes, **summarize what was done**

### Exiting Autonomous Mode:

Autonomous mode applies to the **current task/context only**. Return to safety-first mode when:

- The task is complete
- The conversation shifts to a new topic
- The user indicates they want to review before proceeding

---

For routine development tasks within a project directory, normal operation applies.
