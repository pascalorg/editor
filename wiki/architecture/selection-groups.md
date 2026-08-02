# Selection Groups

*Session multi-select groups (Ctrl/Cmd+G) vs future persistent groups and saved arrangements.*

Applies to: `packages/editor/src/lib/session-groups.ts`, `packages/editor/src/store/use-session-groups.ts`, multi-select UI under `packages/editor/src/components/ui/panels/` and floating menus, selection expand in `packages/editor/src/lib/selection-routing.ts`.

## What this is

Editor-only **session selection groups**. They remember a multi-select set so a plain click on any member reselects the whole set. They are **not** scene-graph nodes and are **not** written into project JSON.

| Shortcut | Behavior |
|---|---|
| Ctrl/Cmd+G | Create a session group from 2+ selected nodes. Auto label `Group N`. |
| Ctrl/Cmd+Shift+G | Dissolve session groups that intersect the selection. Selection is kept. |
| Alt+click | Select a single member without expanding. |

Also available as **Group / Ungroup** icons on the multi-select floating pill (Move · Group · Copy · Delete) and the right multi-select panel.

## Layer rules

| Layer | Session groups |
|---|---|
| `packages/core` | No |
| `packages/viewer` | No |
| `packages/editor` | Yes (store, selection expand, menus, keyboard) |
| `packages/mcp` | No |

## Future options (not this PR)

- **Persistent scene-graph groups** — real parent/`groupId` in the scene, save/load.
- **Saved room arrangements** — reusable furniture presets / catalog placements.

## Related

- [selection-managers](selection-managers.md) — multi-select modifiers
- [tools](tools.md) — 2D ↔ 3D multi-select move/rotate parity
