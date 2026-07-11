---
description: After lengthy discussion about a feature, ask LLM for confidence percentage before implementing
argument-hint: "<feature or task discussed>"
---
$@

Based on our discussion above, answer this honestly:

If you started implementing this right now, what's your confidence percentage that you'd deliver it cleanly — no breakage, no regressions, fully working?

- 100% = smooth implementation, fully working, zero issues expected. You know exactly what to do and where.
- 90-99% = minor uncertainty on small details, but overall solid.
- 70-89% = some unknowns, a few things you'd need to verify mid-implementation.
- 50-69% = significant gaps — you'd be guessing on key parts.
- Below 50% = you don't have enough information to proceed safely.

Reply with the percentage (exact number like 88, or range like 90+, >95, ~70) and a one-line reason why. Nothing else.
