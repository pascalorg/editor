# @pascal-app/editor

The Pascal building editor as a React component: tools, panels, the floor plan, views and the agent chat surfaces, composed over `@pascal-app/viewer`.

## Installation

```bash
npm install @pascal-app/core @pascal-app/viewer @pascal-app/editor @pascal-app/nodes
```

Load the built-in plugin once before mounting, as for the viewer (see the [viewer quick start](../viewer/README.md#usage)).

## Usage

```tsx
import { Editor } from '@pascal-app/editor'

export function ProjectPage({ projectId }: { projectId: string }) {
  return (
    <div className="dark" style={{ width: '100vw', height: '100vh' }}>
      <Editor
        layoutVersion="v2"
        projectId={projectId}
        onLoad={() => loadScene(projectId)}
        onSave={(scene) => saveScene(projectId, scene)}
        actionMenuPlacement="top"
        loadingSlot={<MyProjectSpinner />}
        onLoaderChange={(visible) => track('editor-loading', visible)}
      />
    </div>
  )
}
```

`apps/editor/components/scene-loader.tsx` is a complete host: navbar, sidebar tabs, toolbars and persistence.

## Host props

| Prop                  | What it does                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loadingSlot`         | Your loading surface, shown in the canvas panes of both layouts and in 2D and 3D while the scene loads. The editor still decides when loading is over and fires `onLoaderChange`; a failed load always shows the editor's error and retry screen. Omit it or pass `null` for the default loader. |
| `actionMenuPlacement` | `'bottom'` (default) or `'top'`. With `'top'`, the v2 layout gives the tool menu its own row under the toolbar, centred on the scene panes and following them in split, so the bottom strip is free; v1 floats it at the top edge. Mobile keeps the bottom rail.                                 |
| `viewBar`             | Each pane's view bar (v2, default `true`). Turn it off for a host that shows one fixed view.                                                                                                                                                                                                     |
| `sceneOverlay`        | Chrome over the 3D and 2D panes with the level selector and tool dock, hidden while no scene view is on screen.                                                                                                                                                                                  |
| `stageOverlay`        | A full-bleed surface over the whole stage; the scene stays mounted underneath. To show something beside the scene, register a view instead.                                                                                                                                                      |

## Theme

The editor sets no theme of its own: its chrome follows the nearest `.dark` ancestor, so leave the class off for a light editor. Menus and tooltips portal to `<body>`, so put `dark` there too (or on `<html>`) for a dark one. Hand the person a theme switch with `InterfaceThemeRow` in the settings panel's `preferences` slot:

```tsx
import { InterfaceThemeRow, SettingsPanel, type InterfaceTheme } from '@pascal-app/editor'

<SettingsPanel
  preferences={<InterfaceThemeRow value={theme} onChange={(next: InterfaceTheme) => setTheme(next)} />}
/>
```

`theme` is `'system' | 'light' | 'dark'`; applying it (toggling `.dark`) is the host's. A host that passes no row gets none. The Preview stage, the walkthrough HUD and the controls bar stay dark in either theme. The viewer's own "Scene theme" is separate (see [materials and themes](../../wiki/architecture/materials-and-themes.md)).

## Views

The stage is one or two panes, each showing a view: 3D, 2D, or one a plugin registers.

```tsx
import { openEditorView, PLUGINS_VIEW_ID, registerEditorHostView } from '@pascal-app/editor'

registerEditorHostView({
  id: 'acme:signage:schedule',
  label: 'Sign schedule',
  icon: { kind: 'url', src: '/icons/signs.webp' },
  component: () => import('./schedule-view'),
  pluginId: 'acme:signage',
})

openEditorView('acme:signage:schedule', { beside: true }) // split, next to the scene
openEditorView(PLUGINS_VIEW_ID) // the plugin directory
```

Each workspace keeps its own layout, and swapping panes never remounts the 3D canvas or the plan. `\` toggles split. The full contract is in [plugin authoring](../../wiki/architecture/plugin-authoring.md).

## Selecting and showing a node

The helpers the editor's own lists use:

```ts
import { enterUnitFocus, frameViewerNode, selectZoneOrRoom } from '@pascal-app/editor'

selectZoneOrRoom(zoneId) // 'room' for an enclosed room, else 'zone'
frameViewerNode(nodeId, source) // the node's saved view, else its box; the plan frames it when no 3D view is on screen
enterUnitFocus(unitId) // focus a unit, as the site panel does
```

What a host's chat points at (`useViewer.pointedIds`) lights in the plan and as a room outline, as well as in 3D. See [selection managers](../../wiki/architecture/selection-managers.md) and [point and ask](../../wiki/architecture/point-and-ask.md).

## Plugin chat surfaces

A plugin's `PluginChatExtension` can give a host's chat a start screen (`start`), shown while the thread is empty and acting through `ChatStartProps` (`send`, `attach`, `requirePro`). `IconRefGlyph` and `IconRefImage` render registry icons the way the editor does:

```tsx
import { IconRefGlyph } from '@pascal-app/editor'

<IconRefGlyph icon={view.icon} />
```

See [plugin authoring, agent tools and chat extensions](../../wiki/architecture/plugin-authoring.md#agent-tools-and-chat-extensions).
