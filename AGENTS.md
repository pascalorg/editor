# Agent Instructions — `pascalorg/editor`

Public, open-source home of `@pascal-app/{core,viewer,editor,mcp}` and the standalone editor app. Consumed both as npm packages and (in `pascalorg/private-editor`) as a git submodule.

## Repo Shape

| Path | Purpose |
|---|---|
| `packages/core` | Scene graph, node schemas, stores, event bus, core systems — pure logic, no Three.js |
| `packages/viewer` | Standalone 3D canvas: renderers, viewer systems, presentation state |
| `packages/editor` | Editor UI components reused by the standalone app and embedders |
| `packages/mcp` | MCP server and scene storage adapters |
| `apps/editor` | Standalone editor app — composes `viewer` + `editor` + tools |

## Where to look

- **Architecture rules** — `wiki/architecture/` (read on demand; index in `wiki/architecture/README.md`).
- **Skills (ready workflows)** — `.agents/skills/<name>/SKILL.md`. Same content is reachable as `.claude/skills/`, `.cursor/skills/`, `.codex/skills/` (symlinks to `.agents/skills/`).
- **Repo orientation for humans** — `README.md`, `SETUP.md`, `CONTRIBUTING.md`.

`CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` are symlinks to this file. Codex reads this file directly.

## Layer Boundaries (read once, internalise)

- **`packages/core`** owns domain data and pure logic. It must not import Three.js, `packages/viewer`, `apps/editor`, rendering/UI concepts, tools, modes, phases, or view-specific concepts such as floorplan or paint preview.
- **`packages/viewer`** owns the standalone 3D canvas, renderers, viewer systems, and genuine presentation state. It must not know about `useEditor`, editor tools, phases, modes, paint mode, floorplan state, or editor-only presentation vocabulary.
- **`apps/editor`** owns the editing experience: tools, `useEditor`, panels, floorplan helpers, paint mode, keyboard shortcuts, command palette, action menus, cursor badges, and editor-only overlays. Editor features are injected into `<Viewer>` via props and children.

Details, examples, and rationale live in `wiki/architecture/layers.md`, `wiki/architecture/viewer-isolation.md`, `wiki/architecture/systems.md`, `wiki/architecture/renderers.md`, `wiki/architecture/tools.md`.

## When making architecture-sensitive changes

Read the relevant page in `wiki/architecture/` **before** writing code. The page list lives in `wiki/architecture/README.md`. As a minimum:

- Adding a node type → `node-schemas.md`, `renderers.md`, `systems.md`
- Adding a tool → `tools.md`, `spatial-queries.md`, `events.md`
- Adding a system → `systems.md`, `scene-registry.md`
- Anything in `packages/viewer` → `viewer-isolation.md`, `layers.md`
- Anything touching selection → `selection-managers.md`, `scene-registry.md`, `events.md`

## When reviewing a PR

Invoke the `review-architecture` skill (`.agents/skills/review-architecture/SKILL.md`). It loads the required architecture pages, fetches the diff, classifies each new file by layer, and reports findings grouped by severity.

## Operating rules

- Read the full file before editing. Plan all changes, then make one complete edit.
- When the user corrects you, stop and re-read their message.
- After two consecutive tool failures, stop and change approach.
- Don't introduce backwards-compatibility shims, dead code, or speculative abstractions.
- Don't write new comments unless they explain a non-obvious *why*.

---

## DXF Import Feature — File System Job Queue

All DXF import jobs are stored under PASCAL_DATA_DIR/dxf-imports/.

### Directory structure
```
PASCAL_DATA_DIR/
  dxf-imports/
    2026-05-28/
      job_<8位hex>/
        original.dxf          # 原始上传（只写一次，不可修改）
        preview.png           # canvas 截图（只写一次）
        job.json              # job 元数据 + 运行历史
        coords_<hhmmss>.json  # Channel A 输出（每次运行带时间戳）
        semantic_<hhmmss>.json # Channel B 输出
        merged_<hhmmss>.json  # 融合结果
        coords_latest.json    # 符号链接 → 最新 coords
        semantic_latest.json  # 符号链接 → 最新 semantic
        merged_latest.json    # 符号链接 → 最新 merged
```

### Rules
- Job ID: `crypto.randomBytes(4).toString('hex')`
- Timestamps in filenames: `HHmmss` (local time, no date — date is in parent folder)
- `job.json` must be updated after every step
- Channel A and B run in parallel; each writes its own file independently
- MCP importer reads `merged_latest.json` only
- Never delete job folders — they are the audit trail

### job.json schema
```json
{
  "jobId": "a3f9c2e1",
  "createdAt": "2026-05-28T14:30:20Z",
  "status": "pending|validating|processing|merged|imported|failed",
  "sourceFile": "original.dxf",
  "sceneId": null,
  "params": { "wallThicknessMin": 0.08, "wallThicknessMax": 0.40 },
  "runs": [
    {
      "runAt": "2026-05-28T14:30:22Z",
      "coordsFile": "coords_143022.json",
      "semanticFile": "semantic_143028.json",
      "mergedFile": "merged_143031.json",
      "channelBSkipped": false,
      "error": null
    }
  ]
}
```

### New files for this feature
- `packages/core/src/lib/importers/job-store.ts`  — job 文件夹创建/读写
- `packages/core/src/lib/importers/dxf-validator.ts`
- `packages/core/src/lib/importers/dxf-geometry-parser.ts`
- `packages/core/src/lib/importers/dxf-merge-engine.ts`
- `packages/core/src/lib/importers/mcp-importer.ts`
- `apps/editor/components/tools/ImportDxfTool.tsx`
- `apps/editor/components/DxfPreview.tsx`
- `apps/editor/app/api/vision-analyze/route.ts`
- `apps/editor/app/api/vision-analyze/prompts/floor-plan-analyzer.md`