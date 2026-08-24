# 10. LSP Navigation Tools

**Origin:** [`dsh-lsp`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/lsp/lsp) + `dsh-tool-lsp` (`packages/lsp/*/README.md`)

## Concept

A language-server seam exposing exactly *four normalized operations* to the model: go-to-definition, find-references, hover, document symbols (roughly). No protocol escape hatch — a backend translates LSP into the normalized request/result, so the tool surface stays tiny and stable while language support comes for free from existing LSP servers (typescript-language-server, rust-analyzer, gopls, pyright…).

dsh details:
- LSP servers are spawned through the shared subprocess seam (stdio transport); the seam offers no raw protocol escape — backends translate into 4 normalized queries.
- Normalized result shapes, not raw LSP JSON — the model gets clean, bounded output.

## Why port to pi

The model currently navigates code with `grep` + `read` — works, but definition/references answers from grep are guesses (same identifier in five files). With an LSP tool, "where is this function defined" becomes exact, and "who calls this" is one tool call instead of a repo-wide search. Pi already ships an `lsp` entry in dsh's capability map for inspiration; a pi extension spawning `typescript-language-server` on demand is fully doable (npm deps allowed in extensions).

## pi plugin design

- **Backend:** spawn LSP per project language via `pi.exec`/child_process stdio. Language detection: `package.json` → typescript-language-server, `go.mod` → gopls, `pyproject.toml` → pyright, `Cargo.toml` → rust-analyzer. Lazy-start on first tool call, kill on `session_shutdown`.
- **Tools** (the 4 normalized ops):
  - `lsp_definition(file, line, col)` → `{uri, range}` (one hit),
  - `lsp_references(file, line, col)` → `[{uri, range}]` capped at N,
  - `lsp_hover(file, line, col)` → type/doc text,
  - `lsp_symbols(file)` → top-level symbols (optional 4th; dsh's set is similar).
- **Input format:** `file:line:col` — force the model to give a position, never fuzzy names (names are grep's job).
- **Normalization:** map LSP `Location[]`/`Hover` results to flat `{file, line, text?}` JSON; strip protocol noise. Cache open-document sync: only sync files when results need them (lazy `textDocument/didOpen` + `didChange` on write events is v2 — v1 sync-on-request).
- **Fallback:** server not installed → tool returns `{error: "no_lsp", hint: "install X"}` — never block on setup.

```ts
pi.registerTool({ name: "lsp_definition",
  parameters: Type.Object({ position: Type.String() }), // "src/a.ts:42:10"
  execute: async (_id, { position }, _sig, _upd, ctx) => {
    const server = await lspFor(ctx.cwd) // cached spawn
    const loc = await server.definition(position)
    return text(JSON.stringify(loc, null, 2))
  }})
```

## Effort / risk

- Medium-large: ~300 lines + per-language server config. This is the one idea here that's genuinely a project, not an afternoon. Start with typescript-language-server only; add languages by demand.
- Risks: LSP handshake/version drift, zombie servers (use the jobs-registry.md kill-on-shutdown rule), model sending bad positions (validate + return the server's error verbatim).

## dsh extras to skip

- The whole seam/provider/consumer architecture — one backend per language, chosen at spawn. Skip didChange sync, workspace folders, multi-root.
