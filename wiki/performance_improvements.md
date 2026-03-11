# Performance Improvements & Project Switching Fixes

> Branch: `feat/roof` | Date: 2026-03-11

## Context

After introducing roof and roof-segment nodes with CSG-based geometry generation, several issues surfaced when switching between projects in the editor. The canvas would frequently go black, requiring multiple browser refreshes to recover. This document captures the root causes, fixes applied, and remaining known issues.

---

## Root Causes Identified

### 1. Canvas Destroyed on Every Project Switch

**Location:** `apps/editor/components/editor/index.tsx`

The editor conditionally rendered either a `<SceneLoader>` OR the `<Viewer>` based on loading state:

```tsx
// BEFORE (broken)
if (isLoading) {
  return <SceneLoader fullScreen />
}
return <Viewer>...</Viewer>
```

This meant every project switch:
1. Unmounted the entire R3F `<Canvas>` and WebGPU renderer
2. Showed a loading screen
3. Remounted the Canvas, requiring a new async `await renderer.init()` call

WebGPU initialization is async and non-trivial. If it raced with scene loading or failed silently, the canvas stayed black.

Additionally, `<ErrorBoundary key={projectId}>` wrapped the Viewer, causing React to unmount and remount the entire Canvas subtree on every `projectId` change — even before the loading screen appeared.

**Fix:** The Canvas now stays mounted at all times. The loader overlays on top via `fixed inset-0 z-60`. Editor-only children (SelectionManager, ToolManager, FloatingActionMenu, ZoneLabelEditorSystem) are gated with `!isLoading` to prevent interaction during transitions. The `key={projectId}` was removed from ErrorBoundary.

### 2. Post-Processing Pipeline Never Rebuilt Across Projects

**Location:** `packages/viewer/src/components/viewer/post-processing.tsx`

The post-processing pipeline (SSGI + TRAA + Outlines) was built once with deps `[renderer, scene, camera, isInitialized]`. None of these change between project switches — they're the same R3F-managed objects. So the pipeline was created exactly once and never rebuilt.

If the pipeline errored during a transition (e.g., from stale Object3D refs in the outline passes), `hasPipelineErrorRef` was set to `true` permanently. From that point on, every frame returned early from `useFrame` without rendering, producing a black canvas. The only recovery was a page reload.

**Fix:**
- Added `projectId` (from `useViewer` store) as a dependency to force pipeline rebuild on project switch.
- Added auto-retry logic: up to 3 attempts with 500ms delay via a `pipelineVersion` state bump.
- Retry counter resets when `projectId` changes.

### 3. Stale Object3D References in Outliner Arrays

**Location:** `apps/editor/features/community/lib/models/hooks.ts`

The outline post-processing passes are created with references to `useViewer.getState().outliner.selectedObjects` and `hoveredObjects`. These are mutable arrays that the `EditorOutlinerSync` component populates via a React effect.

During project switches, the effect cleanup is asynchronous. In the frames between the old scene unmounting and the effect firing, the arrays still held disposed Object3D references from the previous project. When the outline pass tried to render these disposed objects, it caused GPU errors.

**Fix:** `resetEditorInteractionState()` now clears the outliner arrays synchronously (`.length = 0`) before any new scene is loaded, in addition to resetting selection and hover state.

### 4. `sceneRegistry` Never Cleared on Project Switch

**Location:** `packages/core/src/hooks/scene-registry/scene-registry.ts`

The `sceneRegistry` is a module-level `Map<string, THREE.Object3D>` that maps node IDs to live Three.js objects. When switching projects, old entries were never removed. Systems querying the registry could get stale or disposed objects.

While individual renderer components clean up their entries on unmount via `useLayoutEffect` cleanup in `useRegistry`, the timing of unmount vs. new scene load created windows where stale entries existed.

**Fix:** Added a `sceneRegistry.clear()` method that empties both `nodes` and all `byType` sets. Called during `resetEditorInteractionState()` on every project transition.

### 5. `pendingRoofUpdates` Persisted Across Scenes

**Location:** `packages/core/src/systems/roof/roof-system.tsx`

The `pendingRoofUpdates` Set is module-level and tracks roof node IDs queued for merged geometry updates. After a scene switch, it could still contain IDs from the previous project. While the system already null-checked nodes before processing, this was wasteful and could theoretically cause issues with coincidental ID collisions.

**Fix:** RoofSystem now checks `rootNodeIds.length === 0` (scene unloaded) at the start of `useFrame` and clears the pending set.

### 6. `hoveredId` Not Cleared on Project Switch

**Location:** `apps/editor/components/editor/index.tsx`

The viewer store's `hoveredId` from the previous project could persist, referencing a node that no longer exists.

**Fix:** Added `useViewer.getState().setHoveredId(null)` in the `projectId` change effect.

---

## Performance Improvements

### JSON.stringify Replaced with Reference Equality for Autosave

**Location:** `apps/editor/features/community/lib/models/hooks.ts`

The autosave subscriber previously called `JSON.stringify(state.nodes)` on every Zustand store update to detect whether nodes had changed. For large scenes (the House project has 100+ nodes with complex wall/roof geometry), this was an expensive O(n) operation running on every state change.

**Fix:** Replaced with reference equality (`state.nodes === lastNodesRef`). Zustand creates a new `nodes` object reference on every mutation via its immutable `set()` pattern, so reference equality is a reliable O(1) change detector. The tradeoff is that undo/redo cycles back to a previously-saved state may trigger an unnecessary save, but this is a no-op on the server side and far cheaper than serializing the entire scene on every frame.

### Roof System Throttling (Pre-existing)

The roof system already had per-frame budgets:
- `MAX_SEGMENTS_PER_FRAME = 3` — limits individual CSG segment computations
- `MAX_ROOFS_PER_FRAME = 1` — limits merged roof geometry rebuilds

These are important because CSG operations (via `three-bvh-csg`) are CPU-intensive. The throttling spreads the cost across frames to maintain interactive framerate.

---

## Debug Cleanup

Removed 3 `console.log` statements from `apps/editor/components/editor/selection-manager.tsx` that were left from development:
- `computeNextIds` debug output
- `[SelectionManager] Valid click on` logging
- `onGridClick triggered! Deselecting.` logging

---

## WebGPU Device Loss Detection

**Location:** `packages/viewer/src/components/viewer/index.tsx`

Added a `GPUDeviceWatcher` component inside the Canvas that listens for the WebGPU device `lost` promise. When the GPU device is lost (tab backgrounded, driver crash, OS reclaims GPU), it logs a clear error message. This is currently informational only — there is no automatic recovery mechanism for device loss since it requires a full page reload.

---

## Known Issues / Future Work

### WebGPU Depth Texture Sample Count Mismatch

During testing, the browser console shows repeated warnings:

```
Source [Texture "depth"] sample count (4) doesn't match...
[Invalid CommandBuffer from CommandEncoder]
```

These appear on every project (not just after switches) and seem related to the post-processing pipeline's interaction with MSAA. The `dpr={[1, 1.5]}` Canvas setting enables multisampling, but the depth texture used by the SSGI pass may not be configured for the same sample count.

**Impact:** These are warnings, not errors. Rendering still works. However, they indicate invalid GPU command buffers are being submitted, which wastes GPU cycles and could degrade performance.

**Suggested investigation:**
- Check whether the `scenePass.getTexture('depth')` returns a multisampled texture
- Consider whether SSGI needs a resolved (non-multisampled) depth copy
- Review Three.js WebGPU post-processing documentation for MSAA-compatible depth handling

### `hasInitializedEditorRuntime` Module-Level Flag

The `initializeEditorRuntime()` function in `editor/index.tsx` uses a module-level boolean to ensure spatial grid sync, space detection, and SFX are only initialized once. This is fine for production but can cause issues during hot module replacement in development — if the module is re-evaluated, the flag persists but the subscriptions may be stale.

**Suggested improvement:** Consider using a ref or checking whether subscriptions are already active instead of a boolean flag.

---

## Test Results

Verified with Playwright across 5 consecutive project switches:

| Test | Result | FPS | Console Errors |
|------|--------|-----|----------------|
| Initial load: House | Renders correctly | 116 | 0 |
| Community hub: Roofs | Renders correctly | 120 | 0 |
| Direct switch: Roofs to House | Renders correctly | 53 | 0 |
| Direct switch: House to Roofs | Renders correctly | 61 | 0 |
| Direct switch: Roofs to House | Renders correctly | 51 | 0 |

All transitions loaded the correct scene graph, rendered 3D content, and displayed the correct project metadata. No black canvas observed.
