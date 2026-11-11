# Viewer Isolation

*Viewer must be editor-agnostic — controlled from outside via props and children.*

Applies to: `packages/viewer/**`.

`@pascal-app/viewer` is a standalone 3D canvas library. It must never know about editor-specific features, UI state, or tools. This keeps it usable in the read-only `/viewer/[id]` route and in external React applications.

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
import { Viewer } from '@pascal-app/viewer'
import { ToolManager } from '../tools/tool-manager'

export function EditorCanvas() {
  return (
    <Viewer selectionManager="custom">
      <ToolManager />
    </Viewer>
  )
}
```

The viewer accepts `children` inside its R3F canvas. This is the extension point for controls,
tools, overlays and host-specific systems. Live scene rendering is available through
`@pascal-app/nodes/render`; it does not depend on the full editing plugin, Next.js or Tailwind.
The render-bundle gate inspects all static and lazy chunks for editor/Next dependencies, and the
isolated Vite fixture verifies packed packages in dev and production.

The read-only chrome (controls bar, scene header, HUDs, loader, the viewer selection model and the
primitives they use) is the `@pascal-app/viewer/ui` entry, styled with Tailwind and its shipped
`theme.css`. It is editor-agnostic like the rest of the package: the editor imports its stores and
controls from there (one camera-pose, first-person HUD and Follow Pascal store), never the reverse.
Router pieces come in as props (`linkComponent`); Biome bans `next` in the package and the bundle
gate builds the entry with editor/Next resolution forbidden.

## Live graph bootstrap and ownership

```tsx
import { acquireSceneReadOnlyLease, loadPlugin, useScene } from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, Viewer } from '@pascal-app/viewer'
import { OrbitControls } from '@react-three/drei'

configureViewer({ assetsBaseUrl, storageUrl, decoders: { dracoPath, basisPath } })
await loadPlugin(renderPlugin)
const releaseReadOnly = acquireSceneReadOnlyLease()
useScene.getState().setScene(nodes, rootNodeIds, { materials, collections, installedPlugins })

// Mount into a container with an explicit width and height:
<Viewer><OrbitControls makeDefault /></Viewer>
// After unmounting, releaseReadOnly().
```

Load exactly one built-in plugin per runtime: the render entry for read-only hosts, the full
`builtinPlugin` for editors. The read-only lease keeps document writers from modifying the hydrated
graph while geometry systems build it. Asset/storage configuration is resolved at call time; hosts
should configure before the first asset load. Next hosts pass their public environments explicitly.
Decoders have pinned defaults and can be self-hosted; initialized workers/models remain cached.

**One active scene per page/package instance.** The scene and viewer stores, node registry,
`sceneRegistry`, loader caches and viewer systems are singletons. Two canvases cannot own independent
graphs. On project switch, unmount the previous viewer, release its read-only lease and host
subscriptions, then hydrate the new graph, reset host selection/project presentation and remount.
Use separate pages/iframes for independent graphs. This limit applies to the live graph path;
baked-asset rendering remains a separate host composition.

## Viewer's Own State (`useViewer`)

The viewer store contains **only presentation state**:

- `selection` — which nodes are highlighted
- `cameraMode` — perspective / orthographic
- `levelMode` — stacked / exploded / solo / manual
- `wallMode` — up / cutaway / down
- `theme` — light / dark
- Display toggles: `showScans`, `showGuides`, `showGrid`

If a piece of state is only meaningful inside the editor (e.g. active tool, phase, edit mode) — it belongs in `useEditor`, not `useViewer`.

The site's optional `presentation` field owns saved rendering defaults. The existing viewer store resolves explicit per-project browser choices above those defaults, then the normal theme. `sceneAppearance` is the resolved lighting/background/exposure/postprocessing used by the canvas and snapshots; `showSceneTheme` temporarily previews a preset without saving a choice. Anonymous embeds retain usable local controls without persisting an anonymous project entry. Site's Save current look writes through the normal scene owner; Use project look clears the local look. This does not change geometry, level ownership or plugin atmosphere precedence.

Graph-backed viewers read the root site's presentation. A baked-asset host supplies the same saved value with `<Viewer presentation={site.presentation ?? null}>`; it does not need to mount the native graph. `presentation={null}` explicitly ignores authored appearance, as canonical bake/thumbnail hosts require; such hosts also pass `daylight={false}` to keep the neutral studio look instead of the colored appearance's built-in daylight (sun, sky, ground, time and weather presets), which is on by default. Supported fields are declared in `core/src/schema/site-presentation.ts`; display-family filtering and solar simulation are not implemented by this rendering slice.

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
