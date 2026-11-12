# @pascal-app/viewer

3D viewer component for Pascal building editor.

## Installation

```bash
npm install @pascal-app/core @pascal-app/viewer @pascal-app/nodes
```

## Peer Dependencies

```bash
npm install react react-dom three @react-three/fiber @react-three/drei lucide-react zustand
```

## What's Included

- **Viewer Component** - WebGPU-powered 3D viewer with camera controls
- **Node Rendering Runtime** - Registry-driven dispatch for node renderers supplied by `@pascal-app/nodes`
- **Post-Processing** - SSGI (ambient occlusion + global illumination), TRAA (anti-aliasing), outline effects
- **Level System** - Level visibility and positioning (stacked/exploded/solo modes)
- **Wall Cutout System** - Dynamic wall hiding based on camera position
- **Asset URL Helpers** - CDN URL resolution for models and textures

## Usage

The live render entry rebuilds geometry from a scene graph in ordinary React applications,
including Vite. It requires neither Next.js, Tailwind, nor `@pascal-app/editor`.

```tsx
import { acquireSceneReadOnlyLease, loadPlugin, useScene } from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, Viewer } from '@pascal-app/viewer'
import { OrbitControls } from '@react-three/drei'
import scene from './scene.json'

configureViewer({
  assetsBaseUrl: 'https://editor.pascal.app',
  storageUrl: 'https://your-storage.example',
  // Optional self-hosted decoder directories (include the trailing slash):
  // decoders: { dracoPath: '/decoders/draco/', basisPath: '/decoders/basis/' },
})
await loadPlugin(renderPlugin)
const releaseReadOnly = acquireSceneReadOnlyLease()
useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
  materials: scene.materials,
  collections: scene.collections,
  installedPlugins: scene.installedPlugins,
})

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Viewer>
        <OrbitControls makeDefault target={[0, 1, 0]} />
      </Viewer>
    </div>
  )
}

// On teardown, unmount App before releasing the lease:
// releaseReadOnly()
```

Load exactly one built-in plugin per runtime: `renderPlugin` for a viewer, or the full
`builtinPlugin` from `@pascal-app/nodes` for an editor. Without registration, nodes cannot render.
The read-only lease suppresses document-writing systems while the live geometry systems rebuild
from the supplied graph. Keep it until the viewer unmounts.

**One active scene per page/package instance.** `useScene`, `useViewer`, the node registry,
`sceneRegistry`, loader caches and viewer systems are shared singletons. Concurrent viewers cannot
own independent graphs. Unmount the previous viewer and release its read-only lease and host
subscriptions before switching projects; hydrate the new graph and reset the host's viewer
selection/project presentation before remounting. Use a separate page/iframe for independent graphs.

`configureViewer` resolves asset and storage origins at call time. Without configuration, assets
use `https://editor.pascal.app`, with the existing `NEXT_PUBLIC_ASSETS_CDN_URL` and
`NEXT_PUBLIC_SUPABASE_URL` environments used when available. Next hosts should pass those values
explicitly at bootstrap. Draco defaults to version 1.5.5 and Basis to the Three.js 0.187.0
transcoder. Configure before loading assets: changing paths does not unload cached models or
already initialized decoder workers. KTX2 support is detected per renderer and misaligned textures
retain the RGBA fallback. Denied browser storage disables preference persistence without blocking
rendering.

See [`fixtures/viewer-live`](../../fixtures/viewer-live) for a complete small graph and the
isolated packed-package dev/production smoke test.

## Walkthrough for live scenes

`LiveWalkthroughController` is a 3D controller from the main `@pascal-app/viewer` entry.
Mount it inside `Viewer` alongside your live graph rendered with `renderPlugin`. It is dormant
until `useViewer.walkthroughMode` is true. `walkthroughMovement` chooses `walk` (gravity,
BVH collision, crouch, jump and door/window/item/elevator interaction) or `drone` (free flight).
No editor state, editing plugin or baked asset is required.

```tsx
import { LiveWalkthroughController, useFirstPersonHud, useViewer, Viewer } from '@pascal-app/viewer'
import { WalkthroughHud } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'

function LiveViewer() {
  const walking = useViewer(s => s.walkthroughMode)
  const suspended = useViewer(s => s.walkthroughSuspended)
  const floorLabel = useFirstPersonHud(s => s.floorLabel)
  const zoneLabel = useFirstPersonHud(s => s.zoneLabel)
  const interact = useFirstPersonHud(s => s.interact)
  const exit = () => useViewer.getState().setWalkthroughMode(false)
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Viewer>
        <OrbitControls enabled={!walking} makeDefault />
        <LiveWalkthroughController />
      </Viewer>
      <button onClick={() => useViewer.getState().setWalkthroughMode(!walking)}>Walkthrough</button>
      {walking && <WalkthroughHud floorLabel={floorLabel} zoneLabel={zoneLabel}
        interact={interact} suspended={suspended} onExit={exit} />}
    </div>
  )
}
```

Use the UI styling setup below for the HUD. Click the canvas to lock the pointer; WASD/arrows move,
Space jumps, Shift runs, Ctrl crouches, E/R or a locked-pointer click operates the targeted object,
and T closes it. P frees the cursor and click/P resumes. Escape or losing pointer lock exits.
A placed spawn controls entry position and heading; otherwise the controller derives a grounded
spawn from the camera and live collider world. Disable other camera controls while walking.

The controller publishes floor, room and interaction prompts to `useFirstPersonHud`. Its main and
`viewer/ui` exports reference the same store. Mount the HUD outside the canvas and pass those
values explicitly. Door and drawer cues emit core `interaction:sound`; opt into playback with
`initInteractionSounds` from `viewer/sfx`. Movement and interaction do not persist document edits.

Optional `LiveWalkthroughControllerProps` let a host own framing: `paused` freezes movement/look,
`externalFov` (a function, read when walkthrough starts and ends) leaves FOV application/restoration to the host while it returns true, `pointerInteraction={false}` reserves
locked-pointer clicks for the host, and `suspendOnUnlock` keeps walkthrough active when pointer lock
is lost (Escape with a free cursor exits). `onExit` runs after the controller clears
`walkthroughMode`. Props remain current during a session without releasing pointer lock.
For baked scenes, continue using `GlbWalkthroughController`; `DroneController` also works with
either scene source when only free flight is needed.

## Custom Camera Controls

```typescript
import { Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'

function App() {
  return (
    <Viewer selectionManager="custom">
      <CameraControls />
    </Viewer>
  )
}
```

## 2D and Split-View Embeds

`@pascal-app/viewer` owns the 3D canvas. The npm-facing multi-view shell lives in
`@pascal-app/editor`, where it can compose that canvas with the read-only SVG floor plan without
coupling editor-only floor-plan state into the viewer runtime.

Use `modes` to expose any combination of `3d`, `2d`, and `split`. A single enabled mode hides the
switcher automatically. `mode` and `onModeChange` can be supplied for controlled embeds; otherwise
`defaultMode` is used.

```tsx
import { ViewerStage, useViewerCameraNavigationSync } from '@pascal-app/editor'
import { Viewer } from '@pascal-app/viewer'
import { CameraControls, type CameraControlsImpl } from '@react-three/drei'
import { useRef } from 'react'

function SyncedCameraControls() {
  const controls = useRef<CameraControlsImpl>(null)
  const publishCameraPose = useViewerCameraNavigationSync(controls)

  return <CameraControls makeDefault onUpdate={publishCameraPose} ref={controls} />
}

function EmbeddedViewer() {
  return (
    <div style={{ width: 960, height: 640 }}>
      <ViewerStage defaultMode="3d" modes={['3d', '2d']}>
        <Viewer>
          <SyncedCameraControls />
        </Viewer>
      </ViewerStage>
    </div>
  )
}
```

Common configurations:

```tsx
<ViewerStage modes={['3d']}>{viewer}</ViewerStage>
<ViewerStage modes={['2d']} />
<ViewerStage modes={['3d', '2d']}>{viewer}</ViewerStage>
<ViewerStage modes={['3d', 'split']}>{viewer}</ViewerStage>
<ViewerStage modes={['3d', '2d', 'split']}>{viewer}</ViewerStage>
```

For a 2D-only embed, no 3D canvas is mounted. When 3D or split is enabled, the 3D canvas stays
mounted while 2D is active, avoiding renderer reinitialization. Camera poses,
floor-plan pan/zoom/rotation, and the compass synchronize through transient subscriptions; live
navigation does not require a React render per frame. Set `showCompass={false}` or
`showSwitcher={false}` when the host supplies its own controls.

## Capture Sessions

`@pascal-app/viewer/capture` holds the optional capture runtime and its reference layers. Mount
`CaptureRuntime` as a child of `Viewer` and provide a source resolver. The host owns access control
and transport; the runtime owns source lifecycle, scan-node placement, layer visibility, and
reference renderers for RoomPlan models, device trajectories, and PLY/live point clouds. The
session contracts it consumes live in `@pascal-app/core/capture`.

```tsx
import { createHttpCaptureSource } from '@pascal-app/core/capture'
import { Viewer } from '@pascal-app/viewer'
import { CaptureRuntime } from '@pascal-app/viewer/capture'

function CaptureViewer() {
  return (
    <Viewer>
      <CaptureRuntime
        onError={(error, context) => reportCaptureError(error, context)}
        resolveSource={(locator) => createHttpCaptureSource(locator, { credentials: 'include' })}
        retryKey={retryVersion}
      />
    </Viewer>
  )
}
```

Unknown streams remain in the descriptor and can be rendered by passing a custom renderer keyed by
stream role or kind. A live transport implements `CaptureSource.subscribe()`; no particular
WebSocket, WebRTC, or collaboration backend is required.

`CaptureRuntime` keeps telemetry host-neutral: pass `onError` to report source or per-stream
failures in the host, then increment `retryKey` to reload every affected session. Direct
`useCaptureSource()` consumers can call its `retry()` function instead.

Hosts can pass `defaultLayerVisibility` to keep expensive optional layers disabled until a user
enables them. Persisted values in the scan node's `layers` map always override those host defaults;
without host defaults, every available layer remains visible for backwards compatibility. Hidden
sessions and layers are unmounted rather than only made visually transparent, so they stop
raycasting, artifact work, animation, and live packet subscriptions while disabled.

### Local surface previews

`@pascal-app/viewer/capture/preview` exports `createSurfaceMeshGeometry` and `createClayMatcap`
without importing the React viewer runtime, so a capture client can render a locally saved surface
immediately, before its archive is uploaded. The geometry decoder uses the shared
`@pascal-app/core/capture` validator, including the native 20,000-face budget, byte lengths, and
index bounds. It returns `null` for invalid input. The host owns the returned geometry and matcap
texture and must dispose them on teardown.

Direct `CaptureStreamLayer` consumers can pass
`meshPresentation={{ previewMaterial: 'clay', dollhouse: true }}`. Clay replaces preliminary vertex
colors; dollhouse enables front-face rendering for surface previews and room models, revealing
inward-facing room surfaces from outside. It changes per-instance materials, not geometry or
loader-cached materials. Omitting these options preserves the existing presentation.

## Scene Snapshots

`createSnapshotPipeline` renders offscreen snapshots with the scene theme's backdrop by default.
Inside a `Viewer`, pass the source returned by `useSceneAtmosphere()` as `atmosphere` to capture
the active presentation's sky instead. Recreate the pipeline when that source changes; updates
to its existing uniforms do not require rebuilding it.

Use `applyEnvironment({ ..., transparent: true })` to retain scene alpha without compositing a
backdrop. The snapshot scene pass owns its transparent clear so intermediate post-processing
passes cannot turn empty sky into opaque pixels. Dispose the pipeline when it is replaced or
no longer needed.

## Viewer State

```typescript
import { useViewer } from '@pascal-app/viewer'

function ViewerControls() {
  const levelMode = useViewer(s => s.levelMode)
  const setLevelMode = useViewer(s => s.setLevelMode)
  const wallMode = useViewer(s => s.wallMode)
  const setWallMode = useViewer(s => s.setWallMode)

  return (
    <div>
      <button onClick={() => setLevelMode('stacked')}>Stacked</button>
      <button onClick={() => setLevelMode('exploded')}>Exploded</button>
      <button onClick={() => setWallMode('cutaway')}>Cutaway</button>
      <button onClick={() => setWallMode('up')}>Full Height</button>
    </div>
  )
}
```

## Sound effects (`@pascal-app/viewer/sfx`)

Opt in to building interactions and selection/hover cues from any viewer or custom UI.
The default files come from `https://editor.pascal.app/audios/sfx`; hosts serving the files
locally should configure their own base URL before preloading. Importing the entry creates no
Howl instances or interaction subscriptions. Playback starts after the browser allows audio;
selection/hover cues stay silent until user activation and during walkthrough.

```tsx
import { useEffect } from 'react'
import { configureViewer } from '@pascal-app/viewer'
import { initInteractionSounds, playSound, useAudioSettings, useViewerUiSounds } from '@pascal-app/viewer/sfx'
configureViewer({ sfxBaseUrl: '/audios/sfx' })
function SoundControls() {
  useEffect(() => initInteractionSounds(), [])
  useViewerUiSounds()
  const toggleMute = useAudioSettings(s => s.toggleMute)
  return <button onPointerEnter={() => playSound('menuHover')} onClick={() => { playSound('menuClick'); toggleMute() }}>Toggle sound</button>
}
```

`SOUNDS` lists the built-in cue definitions. `playSound(name, options?)` supports gain
(`volumeMultiplier`) and stereo positioning. `preloadSounds()` warms files without playing;
`disposeSounds()` releases the shared cache when the host runtime shuts down. Host cues can use
`SoundDefinition` objects with the same player, including `startSoundLoop` / `stopSoundLoop`.
`useAudioSettings` shares master/effects volumes across tabs and keeps mute per tab, preserving
existing Pascal storage keys. Denied storage falls back to memory. Existing radio preferences
remain in the same settings record so editor consumers continue to share one store.

## Viewer UI (`@pascal-app/viewer/ui`)

Pascal's read-only viewer chrome as React components: the 3D / 2D / Split stage (`ViewerStage`)
with its read-only floor plan (`FloorplanPreview`, kept in step with the 3D camera, with its compass
and floor picker), the controls bar (levels, walls, display, daylight, sky, walkthrough), the scene
header (project card, breadcrumb, floor list), the hover label, the room pills, room highlight and
selected-room callout (`ViewerRooms`), the walkthrough and drone HUDs, the loader, the selection
model behind them
(`applyViewerClick`, `ViewerSelectionManager`) and the primitives they are built from (`Button`,
`DropdownMenu*`, `Popover*`, `Tooltip*`, `Switch`). The entry never imports the editor or Next.

The components are styled with Tailwind v4 classes. Point Tailwind at the built entry and import
the theme (tokens, `shadow-elevation-*`, `corner-smooth`, the loader animations):

```css
@import "tailwindcss";
@import "@pascal-app/viewer/ui/theme.css";
@source "../node_modules/@pascal-app/viewer/dist/ui";
```

Override any token after the import (`:root { --radius: 0.5rem }`). The docks and menus scope
themselves with a `dark` class. Control icons load from `configureViewer({ iconsBaseUrl })` (default
`https://editor.pascal.app/icons`); button sounds play through `@pascal-app/viewer/sfx`.

```tsx
import { LiveWalkthroughController, useViewer, Viewer } from '@pascal-app/viewer'
import {
  ParametricViewerRooms,
  SceneLoader,
  ViewerCameraControls,
  ViewerControlsBar,
  ViewerSceneHeader,
  ViewerSelectionManager,
  ViewerStage,
  WalkthroughHud,
} from '@pascal-app/viewer/ui'

function ProjectViewer({ ready, name }: { ready: boolean; name: string }) {
  const walking = useViewer((s) => s.walkthroughMode)
  const toggleWalk = () => useViewer.getState().setWalkthroughMode(!walking)
  return (
    <div className="relative h-full w-full">
      <ViewerStage>
        <Viewer selectionManager="custom">
          <ViewerCameraControls />
          <LiveWalkthroughController />
          <ViewerSelectionManager />
          <ParametricViewerRooms />
        </Viewer>
      </ViewerStage>
      <ViewerSceneHeader backHref={null} linkComponent={MyLink} projectName={name} />
      <ViewerControlsBar onWalkthroughToggle={toggleWalk} walkthroughActive={walking} />
      {walking && <WalkthroughHud onExit={toggleWalk} />}
      {!ready && <SceneLoader />}
    </div>
  )
}
```

`ViewerStage` shows its children (the 3D canvas) in 3D, the floor plan in 2D, and both side by side
in Split; the switcher picks among `modes` (all three by default) and Split falls back to 2D on
narrow screens. Panning, zooming or turning the plan moves the 3D camera and the reverse, through the
navigation pose store (`navigationSyncPoseStore`); on the 3D side, drive your drei `CameraControls`
through `useViewerCameraNavigationSync(controlsRef)`, as Pascal's camera does
(`synchronizeNavigation={false}` turns the link off). The plan draws each kind's `def.floorplan`,
which `renderPlugin` carries; without a `scene` prop it reads the live scene store, and a host with
another node source passes `scene={{ nodes, installedPlugins }}`. Picking a floor in 2D selects that
level in the viewer. Room names show as the plan's drawn tags. Control the mode with `mode` /
`onModeChange` or let the stage hold it (`defaultMode`).

`linkComponent` renders the header's links (a plain `<a>` by default); pass your router's link,
e.g. Next's `Link`. `ParametricViewerRooms` is `ViewerRooms` over the live scene store; a host with
another node source (a baked scene) passes `<ViewerRooms source={{ nodes, objectFor }} />`. While
mounted, zones draw no tinted volume: a room shows through its pill and highlight instead. The walkthrough toggle flips `walkthroughMode`; the mounted
`LiveWalkthroughController` moves the camera. Read `useFirstPersonHud` for the HUD's room and
interaction props, as in the live walkthrough example above.

### Camera controls and opening poses

Mount `ViewerCameraControls` (`ViewerCameraControlsProps`) inside `Viewer` for right-drag orbit,
middle-drag or Space + left-drag pan, wheel dolly (orthographic zoom), touch controls and the
controls bar's frame, top-view and 90° orbit events. It synchronizes navigation with the floor
plan, opens live scenes on the site's saved camera and unmounts its controls during walkthrough.
Both optional props default to `false`: `glbActive` lets `GlbScene` frame the baked scene, and
`holdOpening` leaves the opening view to an explicit pose. Distance limits remain 5–100 metres.

`parseOpeningCamera(raw: string | null)` reads `px,py,pz,tx,ty,tz[,fov]` or returns `'saved'`;
invalid input returns `null`. Coordinates are bounded to ±1000 metres, position and target must
be at least 0.01 metres apart, and optional FOV is 10–120 degrees. `savedSceneCamera(nodes)`
resolves the site's saved camera, then the building's, returning `OpeningCameraPose | null`.
`OpeningCameraPose` has `position` and `target` tuples and an optional `fov`.

For an explicit pose, pass `holdOpening={true}` to the controls and mount `ViewerOpeningCamera`
(`ViewerOpeningCameraProps`) inside `Viewer` with `pose`, `ready` and `onApplied`. Once the scene
is ready and controls exist, it applies the pose on the next animation frame without a transition,
updates perspective FOV when supplied, then calls `onApplied`. It applies once per mount; keep
the loader visible until the callback fires. Resolve `'saved'` through `savedSceneCamera` before
passing a pose. These components and helpers all export from `@pascal-app/viewer/ui`.

## Asset CDN Helpers

```typescript
import { resolveCdnUrl } from '@pascal-app/viewer'

// Resolves relative paths to CDN URLs
const url = resolveCdnUrl('/items/chair/model.glb')
// → 'https://editor.pascal.app/items/chair/model.glb'

// Handles external URLs and asset:// protocol
const externalUrl = resolveCdnUrl('https://example.com/model.glb')
// → 'https://example.com/model.glb' (unchanged)
```

## Features

- **WebGPU Rendering** - Hardware-accelerated rendering via Three.js WebGPU
- **Post-Processing** - SSGI for realistic lighting, outline effects for selection
- **Level Modes** - Stacked, exploded, or solo level display
- **Wall Cutaway** - Automatic wall hiding for interior views
- **Camera Modes** - Perspective and orthographic projection
- **Scan/Guide Support** - 3D scans and 2D guide images

## License

MIT
