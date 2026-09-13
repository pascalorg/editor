# Viewer Isolation

*Viewer must be editor-agnostic — controlled from outside via props and children.*

Applies to: `packages/viewer/**`.

`@pascal-app/viewer` is a standalone 3D canvas library. It must never know about editor-specific features, UI state, or tools. This keeps it usable in the read-only `/viewer/[id]` route and in any future embedding context.

## The Rule

> The viewer is controlled from outside. It exposes control points (props, callbacks, children). It never reaches into `apps/editor`.

## Forbidden in `packages/viewer`

```ts
// ❌ Never import from the editor app
import { useEditor } from '@/store/use-editor'
import { ToolManager } from '@/components/tools/tool-manager'

// ❌ Never reference editor-specific concepts
if (isEditorMode) { … }
```

## Correct Pattern — Pass Control from Outside

The editor mounts the viewer and passes what it needs:

```tsx
// apps/editor/components/editor-canvas.tsx  ✅
import { Viewer } from '@pascal-app/viewer'
import { ToolManager } from '../tools/tool-manager'
import { useEditor } from '../../store/use-editor'

export function EditorCanvas() {
  const { selection } = useViewer()

  return (
    <Viewer
      theme="light"
      onSelect={(id) => useViewer.getState().setSelection(id)}
      onExport={handleExport}
    >
      {/* Editor injects tools as children — viewer renders them inside the canvas */}
      <ToolManager />
    </Viewer>
  )
}
```

The viewer accepts `children` and renders them inside the R3F canvas. This is the extension point for tools, overlays, and editor-specific systems.

## Viewer's Own State (`useViewer`)

The viewer store contains **only presentation state**:

- `selection` — which nodes are highlighted
- `cameraMode` — perspective / orthographic
- `levelMode` — stacked / exploded / solo / manual
- `wallMode` — up / cutaway / down
- `theme` — light / dark
- Display toggles: `showScans`, `showGuides`, `showGrid`

If a piece of state is only meaningful inside the editor (e.g. active tool, phase, edit mode) — it belongs in `useEditor`, not `useViewer`.

## Nested Viewer for Editor-Specific Features

When an editor feature needs to live "inside" the canvas but must not pollute the viewer package, inject it as a child:

```tsx
// ✅ Editor-specific overlay injected as child
<Viewer>
  <SelectionBoxOverlay />   {/* editor only */}
  <SnapIndicator />         {/* editor only */}
  <ToolManager />           {/* editor only */}
</Viewer>
```

This pattern lets the viewer stay ignorant of these components while they still have access to the R3F context.

## Plugin presentation contributions

Presentation-only plugin content uses the viewer-owned registry rather than a
route-specific scene slot. The core `Plugin` manifest stays rendering-agnostic:
the host registers a separate contribution during bootstrap and mounts the
registry once inside each viewer that should show presentation.

```tsx
import {
  registerViewerPresentation,
  Viewer,
  ViewerPresentations,
  type ViewerPresentationContribution,
} from '@pascal-app/viewer'

const presentation: ViewerPresentationContribution = {
  id: 'acme:landscape:presentation',
  pluginId: 'acme:landscape',
  component: () => import('./presentation'),
}

registerViewerPresentation(presentation)

<Viewer>
  <ViewerPresentations />
</Viewer>
```

`ViewerPresentations` filters `pluginId` through the current project's
`installedPlugins`. Uninstalling a plugin therefore unmounts its contribution;
reinstalling remounts it without hot-removing the session's code or node
definitions. Every lazy contribution has its own Suspense and error boundary,
so a failed plugin does not take down the authored scene or its siblings.

The mount is a sibling of `scene-renderer`, never one of its descendants. It
must not create semantic nodes, selection targets, history entries, or query
results. Authored model export remains rooted at `scene-renderer`. A registered
presentation may additionally provide a `staticExport` builder: GLB and USDZ
include that contribution only when explicitly selected. The builder derives
finite, export-owned geometry from its inputs rather than cloning the live
presentation's camera-dependent visibility or LOD.

Raw `<Viewer>` embedders opt into registered presentation by mounting
`<ViewerPresentations />`; snapshot inclusion remains an explicit host policy.
The reusable `<Editor>` already mounts it in its normal and preview compositions.

Registration does not persist plugin configuration. A plugin that exposes
versioned configuration export/import still needs its host to store that value
in a project sidecar and restore it before or after the viewer mounts.

Static builders receive a complete semantic node snapshot, a detached
configuration captured when export starts, and output visibility/type filters.
They return a detached world-space root without creating scene nodes or history.
Returned geometry, materials, and textures belong to the artifact. Cached
presentation texture handles must be marked with
`markViewerPresentationTextureBorrowed`; the host clones those handles before
attaching the contribution and never disposes the borrowed source.

## Checklist Before Adding Code to `packages/viewer`

- [ ] Does this feature make sense in the read-only viewer route?
- [ ] Does it reference `useEditor`, tool state, or phase/mode?
- [ ] Could it be passed in as a prop or child instead?

If any answer is "editor-specific", keep it in `apps/editor` and inject it via children or props.
