# Selection Groups

*Session multi-select groups (Ctrl/Cmd+G) vs collections and future persistent groups.*

Applies to: `packages/editor/src/lib/session-groups.ts`, `packages/editor/src/store/use-session-groups.ts`, multi-select UI under `packages/editor/src/components/ui/panels/` and floating menus, selection expand in `packages/editor/src/lib/selection-routing.ts` and `packages/editor/src/components/editor/floorplan-background-selection.ts`.

## What this is

Editor-only **session selection groups**. They remember a multi-select set so a plain click on any member reselects the whole set. They are **not** scene-graph nodes and are **not** written into project JSON.

| Shortcut | Behavior |
|---|---|
| Ctrl/Cmd+G | Create a session group from 2+ selected nodes. Auto label `Group N`. |
| Ctrl/Cmd+Shift+G | Dissolve session groups that intersect the selection. Selection is kept. |
| Alt+click | Select a single member without expanding. |

Also available as **Group / Ungroup** icons on the multi-select floating pill (Move · Group · Copy · Delete) and the right multi-select panel.

## Membership is never pruned

Deleting a member does **not** rewrite stored membership. Every read narrows to the
live scene instead (`liveSessionGroups`, `expandSessionGroupMembers`), and a group
with fewer than two live members is inert rather than removed.

This is what makes delete + undo work: a destructive prune would drop the deleted
node from the group, and drop the group outright once it fell under the two-member
floor — with no way back, since session groups aren't in the undo history. It also
means no delete path needs a hook; `deleteNodes` has several callers and read-time
filtering covers all of them.

Storage is only cleared wholesale, by `clearGroups()` on scene load and on entering
version preview, where the node ids change entirely.

## Session groups vs collections

`packages/core` also has **collections** (`schema/collections.ts`): named, colored,
persisted sets of node ids, managed from the item inspector's *Manage collections…*
popover. They overlap with session groups but answer a different question:

| | Session group | Collection |
|---|---|---|
| Persisted | No | Yes (project JSON) |
| Created by | Ctrl/Cmd+G on a selection | Named explicitly in the inspector |
| Click a member | Reselects the whole set | No selection behavior |
| Lifetime | Until reload | Until deleted |
| Layer | `packages/editor` | `packages/core` |

Reach for a session group for the throwaway "keep these six chairs together while I
lay out this room" case, and a collection to label a set you'll come back to. They
are deliberately not backed by the same store: giving Ctrl+G persistence would put
an unnamed `Group 4` into everyone's saved project on a stray keypress.

If collections ever gain click-to-expand, this split should be revisited — that
would make them a strict superset, and session groups could become the unsaved tier
of one concept rather than a second one.

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
