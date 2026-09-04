# Project: Upstream Synchronization & Conflict Resolution (`pascalorg/editor` → `ovurrsl/editor`)

## Architecture & Conflict Domain Map
The project synchronized 24 upstream commits from `pascalorg/editor:main` (`9cdafb04`) into `ovurrsl/editor:main` (`add8c829`) across 5 modules and 20 conflicting files.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|:------:|
| 1 | Upstream Zod 4.5.4 Migration | Update Zod schemas with bare literal unwrap & compiled node parsers | M1 | Upstream Survey | DONE |
| 2 | Plugin Warehouse Node Schemas | Preserve custom node schemas (`ovurrsl:warehouse`, etc.) in `graph-schema.ts` | M1 | Local Survey | DONE |
| 3 | Asset Storage & Registry Types | Merge upstream storage URL handling with local `verticalOpening` / `canMoveTo` | M1 | Survey | DONE |
| 4 | Manifests & Dependencies | Upgrade core deps while preserving `@ovurrsl/plugin-warehouse` pinned SHA & MySQL/auth deps | M1 | Survey | DONE |
| 5 | ToolMode FSM Unification | Integrate upstream `armToolMode` with local edit locking (`isNodeEditLocked`) & multi-select | M2 | Upstream Survey | DONE |
| 6 | First Person Controls | Reconcile upstream pointer-lock Esc handling & camera suites with local hotkeys | M2 | Survey | DONE |
| 7 | Move Registry Node Tool | Merge upstream and local implementations of `move-registry-node-tool` and tests | M2 | Survey | DONE |
| 8 | Keyboard Shortcuts | Merge upstream FSM tool hotkeys with local custom actions (history lock, delete toggle) | M2 | Survey | DONE |
| 9 | Floating Action Menu & Panels | Integrate draggable action menu with upstream declarative tool options | M3 | Survey | DONE |
| 10 | Material Picker | Merge upstream material paint priming with local texture picker & catalog | M3 | Survey | DONE |
| 11 | High-Res Snapshot Export | Unify upstream walk/drone FOV controls with local 1080p/1440p/4K resolution multipliers | M3 | Local Survey | DONE |
| 12 | Zone Deletion & Takeoff | Ensure `zone-content.ts` and `quantities-panel.tsx` pass all takeoff & BOM tests | M4 | Local Survey | DONE |
| 13 | Lockfile Synchronization | Cleanly regenerate `bun.lock` via `bun install` with zero dependency conflicts | M4 | Survey | DONE |
| 14 | Monorepo Test Suite Verification | Verify 100% pass across all packages (`bunx turbo run test`) | M4 | Survey | DONE |
| 15 | Git Commit & Upstream Push | Final clean merge commit and push to `origin main` | M5 | User Request | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|:------:|
| M1 | Core Schemas & Package Manifests | `apps/editor/lib/graph-schema*`, `packages/core/src/lib/asset-storage.ts`, `packages/core/src/registry/types.ts`, `apps/editor/package.json`, `packages/*/package.json` | None | DONE |
| M2 | Editor State, FSM & Interaction Tools | `packages/editor/src/components/editor/first-person-controls.tsx`, `floating-action-menu.tsx`, `index.tsx`, `selection-manager.tsx`, `thumbnail-generator.tsx`, `move-registry-node-tool*`, `use-keyboard.ts` | M1 | DONE |
| M3 | UI Panels, Action Menus & Capture Overlay | `packages/editor/src/components/ui/action-menu/index.tsx`, `controls/material-picker.tsx`, `panels/panel-manager.tsx`, `snapshot-capture-overlay.tsx` | M2 | DONE |
| M4 | Lockfile Sync & Monorepo Test Suite Pass | `bun.lock`, `bun install`, `bunx turbo run test` (Core, Viewer, Editor, Nodes, MCP, Apps) | M3 | DONE |
| M5 | Final Verification & Git Push | Clean git working tree, zero merge markers, successful `git push origin main` | M4 | DONE |
