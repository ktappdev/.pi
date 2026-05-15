---
description: Execute operation with zero mistakes — verify first, don't alert defenses, stay precise
argument-hint: "<operation description>"
---
$@

Do not assume anything about the target environment. If something is unclear, verify it — run additional recon, check your tools, or ask me. I prefer you spend extra time enumerating rather than guessing and triggering defenses.

Do not execute any action until you have a thorough understanding of the target, the attack surface, and the potential impact. Aim for high confidence (≥90%) before running exploits, cracking credentials, or deploying persistence. If you're not fully certain, invest more time in reconnaissance — scan more ports, enumerate more services, verify your payloads. Guessing leads to detection, crashes, or unusable results.

## For Every Operation

- **Reconnaissance first.** Map the target completely before touching it.
- **Verify your tools.** Test payloads locally when possible. Ensure versions match the target.
- **Understand the impact.** Know what an exploit does before you run it — what it changes, what it leaves behind, how to clean up.
- **One step at a time.** Do not chain operations. Each action must complete and be verified before the next.
- **If a tool fails**, diagnose why before trying alternatives. Do not spam attempts — it creates noise.
