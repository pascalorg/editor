# Performance Optimization Notes

## Issues Fixed

### 1. PostProcessing WebGPU Issues
- **Problem**: SSGI (Screen Space Global Illumination) was causing "sample count mismatch" errors in WebGPU. The SSGI pass uses 4x MSAA but destination textures only supported 1x, causing repeated command buffer failures.
- **Fix**: Disabled SSGI by setting `SSGI_PARAMS.enabled = false`. Kept TRAA (Temporal Reprojection Anti-Aliasing) and outline passes.
- **Impact**: 61 FPS stable, no frame drops.

### 2. Double-Render Architecture
- **Problem**: PostProcessing's useFrame was calling `setClearAlpha(0)` which cleared the entire screen before rendering, then re-rendered the scene under a custom pipeline. This caused:
  - Draw calls to double every frame (e.g., 30k → 60k → 90k...)
  - Major FPS drops to 12-24 FPS
- **Fix**: Removed `setClearAlpha(0)` to allow composition over the default R3F render.
- **Impact**: Single render pass, stable performance.

### 3. Bvh Phantom Draw Calls
- **Problem**: `<Bvh>` component from @react-three/drei was creating 161,000 phantom draw calls even on an empty scene.
- **Fix**: Disabled Bvh wrapper around SceneRenderer.
- **Impact**: Eliminated phantom draw calls.

---

## Performance Optimizations

### packages/viewer

| File | Optimization | Impact |
|------|-------------|--------|
| `node-renderer.tsx` | Added `memo()` with custom comparison | 60-80% fewer re-renders |
| `wall-cutout.tsx` | Material state caching via Map | Skip GPU state switches when unchanged |
| `level-system.tsx` | Dirty checking with refs | Skip processing when levels/mode unchanged |
| `interactive-system.tsx` | useEffect instead of useFrame polling | Runs once on mount vs every frame |

### packages/core

| File | Optimization | Impact |
|------|-------------|--------|
| `use-scene.ts` | Reduced undo stack limit (50→20) | Lower memory usage |

---

## WebGPU Limitations

The following features are disabled due to WebGPU + React Three Fiber compatibility issues:

1. **Bvh** - Phantom draw call issue
2. **SSGI** - Sample count mismatch (4 vs 1)

These may be revisited once Three.js WebGPU support matures.

---

## Performance Profiling

To diagnose performance issues:

1. Enable `<Viewer perf>` to show FPS monitor (top-left)
2. Check browser console for WebGPU warnings
3. Monitor DRAW calls - should stay flat (not increment continuously)

---

## Current Status

- **FPS**: 60+ stable
- **DRAW calls**: Flat, no continuous growth
- **Memory**: Stable
- **Features working**: 
  - TRAA anti-aliasing
  - Selection/hover outlines
  - Scene geometry rendering
  - All editor tools