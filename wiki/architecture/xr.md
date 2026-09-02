# WebXR

WebXR is an optional presentation path for the existing scene. It does not add XR data to the scene graph and therefore has no code in `packages/core`.

## Folder structure

```text
packages/viewer/src/xr/
├── god-mode/        # Encapsulates God-scale scene transforms, controller grips, palm grabs, and reset state.
├── human-mode/      # Owns first-person movement, snap turn, hand locomotion, comfort, and scene collision.
├── mode-switching/  # Coordinates God/Human transitions without changing persisted scene data.
├── presentation-context.tsx # Tells renderers when the scene is using direct immersive presentation.
├── session-root.tsx  # Connects the R3F scene to an XR store and hands frame timing to the headset.
├── store.ts          # Creates the reusable XR session store with default hand/controller rendering.
└── support.ts        # Performs the safe immersive-vr browser capability check.

apps/editor/components/xr/
├── wand-panel/                # Left-hand three-face Build, Paint, and selection-aware Settings UI.
├── xr-editor-input-bridge.tsx # Adapts controller trigger and hand pinch rays to the editor's existing pointer/event pipeline.
├── xr-preview-environment.tsx # Dedicated scene loader and launch surface for XR testing.
└── xr-runtime.tsx             # Owns XR runtime state, session requests, and the Viewer XR configuration.

apps/editor/lib/xr/
├── editor-input.ts   # Pure controller/hand source selection and XR button edge detection.
├── emulator.ts       # Installs the Quest 3 IWER emulator only in local development when native XR is absent.
└── preview-window.ts # Opens or focuses the standalone XR testing window.

apps/editor/lib/build-palette.ts # Shared palette definitions and activators used by desktop and XR build surfaces.

apps/editor/app/xr/
├── page.tsx          # Tests the local editor scene.
└── scene/[id]/page.tsx # Tests a persisted scene by id.
```

## Ownership

- `packages/viewer` owns renderer and session integration because those are generic presentation concerns. Its public API is `createViewerXRStore()`, `getImmersiveVRSupport()`, and the optional `Viewer.xr` configuration. `Viewer.xr.inputSourceOverlay` is a presentation-only extension point rendered inside each controller/hand context.
- `packages/viewer/src/xr/god-mode` owns the reusable God-scale interaction module. It transforms a presentation-only scene root and never writes scene graph data.
- `packages/viewer/src/xr/human-mode` owns reusable first-person XR input and collision. It operates on the XR origin and rendered mesh BVHs, not editor tools or scene graph state.
- `packages/viewer/src/xr/mode-switching` owns the presentation-only transition between God and Human scale and restores the prior God transform when switching back.
- `packages/editor` only passes the host-provided XR configuration through to its main viewer canvas.
- `apps/editor` owns the dedicated XR routes, toolbar button, development emulator, tracked-input adapter, and spatial editor panels. The panels select tools through the shared build palette, materials through the core material library, and settings through registry parametrics; they do not duplicate placement or geometry rules.
- `packages/core` remains unchanged because entering XR does not change persisted scene data.

## Renderer policy

Desktop mode keeps the existing automatic renderer selection: WebGPU is preferred and WebGL2 is the fallback.

XR mode runs only under `/xr` or `/xr/scene/[id]` and mounts the canvas with `WebGPURenderer({ forceWebGL: true, multiview: false })`. The editor keeps its existing desktop renderer and does not remount when XR begins. The XR renderer remains Three.js `WebGPURenderer`, but its backend is WebGL2. This gives WebXR a predictable WebGL context and isolates emulator state from the editing session. Three.js `0.185.1` is pinned at the workspace root. Multiview remains disabled for the initial compatibility baseline and can be enabled after validation on physical headsets.

The icon-only VR button sits beside Walkthrough and Preview in the editor toolbar. Its click opens or focuses a named XR testing window. That window has its own explicit session-start button because native WebXR requires user activation in the same browsing context that requests the immersive session.

The TSL post-processing pipeline is unmounted while XR mode is configured. XR uses one dedicated direct-render driver after scene systems run, avoiding SSGI, denoise, ink, and outline passes that have not been validated for stereo XR rendering. The driver updates Three's stereo union camera before drawing and prevents a second automatic camera update during that draw.

The desktop frame limiter pauses while an immersive session is active. React Three Fiber then renders from the WebXR animation loop at the headset's cadence and receives the current `XRFrame`.

The standalone XR route mounts the editor's existing selection manager, grid, node handles, and `ToolManager` as children of `<Viewer>`. Desktop camera controls, labels, post-processing, and thumbnail capture remain unmounted. Ending or unmounting XR also ends its active session.

Controller trigger and tracked-hand pinch use the pointer implementation supplied by `@react-three/xr`. The app-level XR input bridge independently intersects the controller/hand target ray with the existing editor grid and emits the same `grid:move`, `grid:pointerdown`, `grid:pointerup`, and `grid:click` events consumed on desktop. Holding trigger or pinch on an already-selected movable node enters the existing press-drag move path; release is forwarded to its existing commit-on-release listener. The right controller B button emits the existing `tool:cancel` event. No XR-specific scene mutation or placement algorithm exists.

The left controller grip or left middle-finger metacarpal carries the three-face wand panel copied from the WebXR Home attachment geometry. Its labels use canvas textures and its borders use standard Three.js lines because Drei's Troika text and fat-line shader materials are incompatible with the XR renderer's node-material path. Ring arrows rotate between Build, Paint, and Settings. Build is paginated and exposes nested Roof and MEP pages using the same icons and activation functions as the desktop Build tab. Paint is always present and pages through the live core material library. Settings follows the single selected node and derives number, boolean, enum, vector, and read-only fallback rows from `nodeRegistry`; writes use the same derive/reconcile commit helper as the desktop parametric inspector. The input bridge suppresses grid authoring while a target ray intersects the wand, so pressing a panel control cannot also place scene geometry.

## Local testing

Run:

```bash
bun dev:xr
```

This starts the Next.js editor on all interfaces with its development HTTPS certificate. Open a scene and click the VR headset icon beside Walkthrough and Preview. Clicking the active icon exits VR.

- On a desktop browser without native immersive WebXR, the app dynamically imports IWER and emulates a Meta Quest 3. The emulator is registered once across development hot reloads.
- The IWER DevUI is registered with the emulated device, so entering VR shows headset and controller transforms, buttons, sticks, reset, play mode, and session-exit controls over the XR canvas.
- The standalone test environment explicitly mounts the DevUI canvas and controls while an emulated session is active. This covers Three's forced-WebGL backend, which can initialize the XR session without invoking IWER's normal base-layer attachment callback.
- Controllers and hands use the same `DefaultXRController` and `DefaultXRHand` implementations as WebXR Home, with the editor-owned wand injected through the generic viewer input overlay.
- The XR camera uses the reference project's `0.001–10000` clipping range and an explicit `XROrigin`. The standalone preview starts in God mode at the reference project's elevated `[0, 4.5, 8]` origin.
- God mode wraps only rendered scene geometry in `god-scale-scene-root`; lights, cameras, controller/hand models, and the XR origin remain outside that transform. One grip pans the scene, two grips pan/rotate/scale it, and a held three-finger curl exposes the same grab interaction for tracked hands.
- Reset restores the scene root to identity and the XR origin to the default God-view pose. These are presentation transforms and are never persisted to `packages/core`.
- Human mode restores the scene to world scale. The left controller stick moves relative to head direction, the right stick snap-turns, and movement is resolved through a player capsule against the rendered scene's BVHs.
- With hand tracking, pinching inside the left wrist zone drives locomotion and pinching inside the right wrist zone drives turning. Movement and turns use the same comfort vignette and haptic feedback behavior as WebXR Home.
- Press the left controller Y button, hold both tracked thumb tips together for 0.8 seconds, or use the mode button in the test environment to switch between God and Human mode. The hand gesture fires once per hold and rearms after the thumbs separate. Returning to God mode restores the scene transform captured before entering Human mode.
- XR supplies a plain theme background because the desktop sky gradient belongs to the post-processing pipeline.
- The site's presentation-only horizon disc is suppressed in immersive XR because its fade depends on the desktop post-processing backdrop. The real site ground, slabs, terrain, and scene geometry remain visible.
- The Synthetic Environment Module is not registered for VR testing because it adds its own floor grid and environment canvas. Add it only when an AR/MR feature needs synthetic planes, meshes, depth, or hit testing.
- On a browser or headset with native immersive WebXR, the emulator is not installed.
- Production builds never load or install IWER.
- A physical headset must trust the development certificate when connecting over the local network. `localhost` testing can use the normal development command, but HTTPS is the reliable path for another device.

The neighboring `WebXR Home` project uses `@iwsdk/vite-plugin-dev`. That plugin is intentionally not copied because this app runs on Next.js rather than Vite. Direct IWER initialization provides the equivalent local emulator without adding a second app runtime or IWSDK scene engine.

The toolbar remains icon-only. Hovering the headset icon reports `Enter VR with IWER emulator` when the emulated runtime is active. After entry, use the DevUI panels to connect or move controllers and the top controls to move or reset the headset. No Chrome extension is required for this development path.

## Current scope

The XR preview renders the existing scene with default controller and hand models, God-scale navigation, Human-mode locomotion, the existing 3D authoring tools, and the left-hand three-face editor wand. The active desktop phase/mode/tool preference is rehydrated in the standalone XR window. Trigger or hand pinch can draw and place through the existing grid and node event pipeline; selecting a movable node and holding the trigger/pinch routes through its existing mover. Custom DOM-only inspector editors remain desktop-only and appear as read-only fallback rows in the spatial Settings face. XR-specific scene mutations remain out of scope.
