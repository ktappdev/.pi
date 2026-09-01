---
description: After lengthy discussion about a feature, ask LLM for confidence percentage before implementing
argument-hint: "<feature or task discussed>"
---
$@

Based on our discussion above, assess this honestly:

If your initial confidence is below 90%, do not implement yet. Research first: inspect relevant code and configuration, trace code paths and callers, read relevant documentation, run targeted checks, and use web research when external or current information matters. Reassess after researching and repeat while useful. Do not inflate the score; if uncertainty comes from missing requirements, ask a focused question instead of guessing.

90% is the target, not a forced answer. Once research is complete — or no useful research remains — report your honest confidence.

- 100% = smooth implementation, fully working, zero issues expected. You know exactly what to do and where.
- 90-99% = minor uncertainty on small details, but overall solid.
- 70-89% = meaningful unknowns remain; more investigation is needed before implementation.
- 50-69% = significant gaps — you'd be guessing on key parts.
- Below 50% = you don't have enough information to proceed safely.

Reply with the percentage (exact number like 88, or range like 90+, >95, ~70) and a one-line reason why. Nothing else.
