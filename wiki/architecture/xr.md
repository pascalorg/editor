# WebXR

WebXR is an optional presentation and input path for the existing editor scene. The runtime lives in the external `@webxr/plugin` package, pinned to a GitHub commit in `apps/editor/package.json` and resolved by `bun.lock`. It does not add XR state to the persisted scene graph.

## Ownership

- **Plugin:** `src/runtime.tsx` prepares native WebXR or the development emulator. `src/session.tsx` owns session entry, exit, error handling, and cleanup. `src/xr/` owns controller/hand presentation, frame timing, God/Human navigation, and spatial workspace UI.
- **Plugin's Pascal integration:** `src/integrations/pascal-editor/` adapts the runtime to Pascal's editor events, shared panel models, registry settings, material paint, and terrain controls. Its `usePascalWebXR(bindings)` hook supplies the immersive session wrappers.
- **App:** `apps/editor/components/webxr-feature-gate.tsx` mounts the hook only when `webxr:core` is installed. `build-tab.tsx` supplies `webXRWandBindings`, including the shared build palette and tool options.
- **Editor:** owns selection, interaction scopes, snapping preferences, tool execution, and commits. Spatial rays feed the same handle and placement paths as desktop input.
- **Viewer:** exposes generic `ViewerImmersiveSession` wrappers through the `immersive` prop, plus presentation and spatial-input primitives. It does not import the plugin or editor-specific tool state.
- **Core:** owns pure model-coordinate math and scene data. XR scale and player transforms are presentation state, not stored node transforms.

Kind-specific settings and geometry rules remain in `packages/nodes/src/<kind>/`. For example, desktop and spatial wall panels call the same pure wall-length patch helper; neither UI invokes the other UI's rows to edit geometry.

## Session and rendering

The normal editor pages compose `WebXRFeatureRuntime`, `WebXRFeatureConsumer`, and `<Editor immersive={feature?.immersive}>`. There is no separate `/xr` preview route or preview-window snapshot handoff: desktop and immersive editing use the current scene store.

The toolbar's `PascalWebXRButton` enters or exits VR. The plugin's WebXR sidebar panel exposes the same active session controls, readiness/errors, starting God/Human view, and a controls guide. Session controls are published with an owner token so an unmount cannot clear another owner's controls.

Entering a session switches the editor to 3D selection mode and the viewer to perspective, stacked levels, and walls up. Cleanup restores the previous view, camera, wall, and level modes while leaving the editor in Select. Session teardown also removes emulator overlays.

The viewer selects a forced WebGL backend for immersive presentation. Plugin-provided session and scene wrappers integrate the XR frame loop and navigation with the viewer; desktop renderer selection and post-processing remain viewer concerns. God-mode scaling, rotation, and translation affect only presentation. Human mode uses the plugin's standing-target and locomotion flow.

## Input and editing

Controller trigger and tracked-hand pinch are adapted by the plugin's editor input bridge to existing grid, host-surface, and spatial-pointer events. Captured handle drags use the same preview, commit, and cancellation lifecycle as mouse drags. The spatial workspace suppresses scene authoring when its controls own the pointer.

Snapping reads the editor's active context and remembered mode. Rotation handles use the `rotation` context (Angles/Off); desktop Shift cycles that mode and Alt temporarily permits free rotation. XR handlers must not synthesize Shift or force free rotation. Coordinate conversion and grid snapping operate in model-world units, independent of the rendered scene's God-mode scale.

The spatial workspace consumes shared build/tool models and registry-derived settings, including nested and linked settings supported by the plugin. Node changes use the editor's existing commit helpers. Paint and terrain use their existing editor state and history boundaries, not parallel XR editing state.

## Local testing

Run from the repository root:

```bash
bun install
bun run --cwd apps/editor dev --port 3002
```

Open `http://localhost:3002`, enable the WebXR plugin, and enter VR from the toolbar or WebXR panel.

- Development browsers without native immersive support load IWER and its DevUI from the plugin. Native-supported browsers use their own runtime; production does not install IWER.
- The emulator exposes headset/controller controls. The development-only `__pascalXRTestHarness` drives spatial controls and reports delivered input events and scene state.
- Check snapped and free rotation, transformed-scene placement, release-to-commit, cancellation, and session exit. Confirm that desktop editing still operates on the same scene afterward.
- The normal development server uses HTTP. A physical headset accessing a LAN address needs a separately configured secure origin; this command does not create HTTPS or manage certificates.

When updating the plugin, change the GitHub commit pin and run Bun install from the root. Do not add the neighboring checkout to this repo's workspaces or hardcode its filesystem path in the app configuration.
