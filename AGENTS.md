# Agents — `pascalorg/editor`

Public, open-source home of `@pascal-app/{core,viewer,editor,nodes,mcp,cli,ifc-converter}` and the standalone editor app. Consumed as npm packages and, in `pascalorg/private-editor`, as a git submodule.

Use this map to find the owner of a change, then consult the relevant invariants in `DECISIONS.md` and the linked subsystem docs. Implementation choices are delegated to you.

## Packages

| Path | Owns |
|---|---|
| `packages/core` | Scene graph, schemas, stores, commands, registry, services — pure logic, no runtime Three.js (E-001). `src/capture/` = capture-session contracts |
| `packages/viewer` | The 3D canvas: renderers, viewer systems, presentation state. Editor-agnostic (E-001) |
| `packages/editor` | The editing experience: tools, `useEditor`, panels, floor plan, paint, shortcuts, overlays |
| `packages/nodes` | The built-in plugin `pascal:core`: one folder per node kind with its definition (E-002) |
| `packages/mcp` | MCP server, scene storage adapters, agent tools |
| `packages/cli` | Packed CLI + portable runtime |
| `packages/ifc-converter` | IFC import/export |
| `apps/editor` | Standalone app composing viewer + editor |
| `skills/` | Public agent skills shipped with the plugin (product payload, validated in CI) |

## Where to look

- Architecture detail, on demand: `wiki/architecture/` (index in its `README.md`). Read the page for the boundary you touch: a new kind → `node-definitions.md`, `node-schemas.md`; a tool or interaction → `tools.md`, `interaction-scope.md`; anything in `viewer` → `viewer-isolation.md`, `layers.md`; selection → `selection-managers.md`; an MCP tool or resource, or the `pascal-3d` skill → `agent-surfaces.md` (same contract and knowledge as the hosted AI chat).
- Reviewing a PR: `.agents/skills/review-architecture/SKILL.md`.
- Opening a PR: `.agents/skills/open-pr/SKILL.md`.
- Humans: `README.md`, `SETUP.md`, `CONTRIBUTING.md`.

`CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` symlink here.

## Commands

Use the Bun version in `package.json`. Run focused checks for the changed behavior; `bun run ci` runs the full suite when needed. Localization guidance lives in `i18n/README.md`. Git hooks provide staged-file checks and typechecks for changed packages.

## Working agreements

- Rewrite when the shape is wrong; say what you are replacing and why; keep the PR to its stated goal.
- No compatibility shims, dead code or speculative abstractions; comments only for a non-obvious *why*.
- Old scenes must still load after your change (E-003).
- Never cite private-repo plan paths from this repo (E-015).
- Complete authorized work; honor review-only requests. Merge on green required CI and actual GitHub reviews, resolving P0/P1 findings. No fleet approval is needed. Reuse authorization; obtain it for secrets, spend, new access, sign-ins, destructive or access-widening data, and messages under a person's name. Preserve checks and branch protection.
