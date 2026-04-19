# R3 — Scene-management UI

## What exists today

| Feature | File | Line |
|---|---|---|
| "Save Build" → download `layout_YYYY-MM-DD.json` | `packages/editor/src/components/ui/sidebar/panels/settings-panel/index.tsx` | 205–216, 362–365 |
| "Load Build" → file picker `.json` → `setScene` | `…settings-panel/index.tsx` | 218–239, 367–383 |
| "Export Scene (JSON)" in command palette | `editor-commands.tsx` | 328–346 |
| "Export GLB / STL / OBJ" | `export-manager.tsx` | — |
| "Clear & Start New" destructive button | `settings-panel/index.tsx` | 427–434 |
| "Explore scene graph" read-only tree dialog | `settings-panel/index.tsx` | 398–421 |
| Autosave hook (1 s debounce → onSave or localStorage fallback) | `use-auto-save.ts` | 1–191 |
| Scene-dirty tracking exposed to host via `onDirty` / `onSaveStatusChange` | `use-auto-save.ts` | 56–187 |

## What's missing from a typical editor

1. **New scene dialog with naming.** Saves are all date-stamped; no user-given names.
2. **Scene list / picker.** No sidebar panel that lists saved scenes.
3. **Open recent.**
4. **Delete scene** (the destructive button clears current, can't delete a stored scene).
5. **No `Ctrl+S` / `Cmd+S` save shortcut** registered in `use-keyboard.ts`.
6. **No top-bar File menu.** `appMenuButton` slot exists for host to inject one, but nothing ships by default.

## Where new UI should live

- **Scene picker panel** via `extraSidebarPanels` prop — non-invasive, no Editor-core change.
- **Quick actions** via `useCommandRegistry().register([...])` — `editor.scene.open`, `editor.scene.new`, `editor.scene.save-as`.
- **Save-status badge** next to the navbar via `navbarSlot` (v2 layout).
- **"Created by MCP" toast** via a new `Toast` provider in the editor's runtime init.

## Verdict

UI foundation is **~40%** of the way there. The infrastructure (autosave, callbacks, dialogs, palette extensibility) is all present. The missing pieces are UI-only: a scene-list panel (~150 LOC) + a few palette commands + a status indicator. No Editor core changes required if we keep it callback-driven and plug a host-side scene switcher.
