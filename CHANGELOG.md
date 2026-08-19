# Changelog

## Unreleased

### Features

- Undo/Redo buttons in the viewer toolbar (top-left, alongside the collapse and view-mode controls). The buttons subscribe to the history store via `subscribeHistoryCommandState`, dispatch through `runUndo`/`runRedo` (respecting the collaborative history delegate), and disable when nothing can be undone/redone. Keyboard shortcuts were already wired: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo.

### Fixes

- Preserve custom scene materials across save, load, clone, fork, and live sync. Materials were dropped at every persistence boundary, so a scene reopened with default surfaces. Collections were dropped on MCP import for the same reason ([#597](https://github.com/pascalorg/editor/pull/597)) by [@ShiroKSH](https://github.com/ShiroKSH)
- Wall junction mitering is now deterministic for exactly-collinear walls, so identical scenes produce identical geometry regardless of node iteration order ([#596](https://github.com/pascalorg/editor/pull/596)) by [@tomatotomata](https://github.com/tomatotomata)

## 1.0.0-beta.1 (2026-07-30)

The first Pascal Editor 1.0 beta. Relative to
[v0.9.1](https://github.com/pascalorg/editor/releases/tag/v0.9.1), this release
focuses the editor around a stable extensible scene model and production-grade
architectural workflows.

### Highlights

- **Terrain sculpting** — raise, lower, flatten, and smooth a compact height field with a persistent brush, live grid feedback, subtle continuous sound, undo-safe strokes, terrain raycasting, and first-person collision.
- **Terrain-aware construction** — walls, slabs, stairs, fences, columns, items, and other floor-placed nodes resolve stacked support and update live while terrain is sculpted. Wall and slab foundations can fill down to terrain without changing authored height or thickness.
- **Vertical modeling** — stored storey heights, raised-support drafting, explicit elevation anchors and guides, slab/deck stacking, auto-room surface elevation, wall/ceiling clamps, and support-aware placement above or below slabs.
- **Plugin and node architecture** — public node definitions, the built-in nodes package, plugin management, host integration primitives, and first-party Nature and MEP workflows.
- **Floor-plan and export workflows** — faster navigation, contextual dimensions and modes, more reliable placement and selection, textured GLB plus STL/OBJ export, capture framing, and hardened bake/walkthrough paths.
- **Rendering and interaction quality** — grounded lighting, safer WebGPU/WebGL fallbacks, deterministic snapping, group manipulation, improved camera/compass synchronization, and resilient legacy-scene migration.

### Packages

All public packages are published as `1.0.0-beta.1` under the npm `beta`
dist-tag. Stable `latest` installations remain on the 0.x line during the beta.

### Contributors

Thank you to [@wass08](https://github.com/wass08),
[@sudhir9297](https://github.com/sudhir9297),
[@anton-pascal](https://github.com/anton-pascal),
[@konevenkatesh](https://github.com/konevenkatesh),
[@MateoSaettone](https://github.com/MateoSaettone),
[@ruok-dev](https://github.com/ruok-dev),
[@mvanhorn](https://github.com/mvanhorn), and
[@kuishou68](https://github.com/kuishou68) for their work across the editor,
viewer, node library, MCP integration, documentation, and stability fixes.

**Full changelog**:
https://github.com/pascalorg/editor/compare/v0.9.1...v1.0.0-beta.1

## 0.6.0 (2026-04-21)

### Features

- **Multi-surface material system** — per-surface materials for walls, stairs, roofs with click-targeted 3D editing ([#266](https://github.com/pascalorg/editor/pull/266)) by [@sudhir9297](https://github.com/sudhir9297)
- **Automatic wall-room generation** — closed wall loops auto-split and generate slabs ([#255](https://github.com/pascalorg/editor/pull/255), [#257](https://github.com/pascalorg/editor/pull/257)) by [@sudhir9297](https://github.com/sudhir9297)
- **Stair-slab integration** — stair-driven cutouts in slabs and ceilings, auto ceilings from wall loops
- **Curved fence support** + endpoint move tools ([#267](https://github.com/pascalorg/editor/pull/267)) by [@sudhir9297](https://github.com/sudhir9297)
- **13 material presets** — granite, marble, parquet, wallpaper, wood and more ([#231](https://github.com/pascalorg/editor/pull/231)) by [@sudhir9297](https://github.com/sudhir9297)
- **Export scene system** — GLB, STL, OBJ formats ([#203](https://github.com/pascalorg/editor/pull/203)) by [@zephran-dev](https://github.com/zephran-dev), with STL/OBJ groundwork by [@mvanhorn](https://github.com/mvanhorn) ([#175](https://github.com/pascalorg/editor/pull/175))
- **Street view / walkthrough mode** ([#173](https://github.com/pascalorg/editor/pull/173)) by [@Yashism](https://github.com/Yashism)
- **Duplicate project** ([#178](https://github.com/pascalorg/editor/pull/178)) by [@kleenkanteen](https://github.com/kleenkanteen)
- **Editable wall length slider** ([#195](https://github.com/pascalorg/editor/pull/195)) by [@zephran-dev](https://github.com/zephran-dev)
- **Infinity dragging slider** using PointerLock API ([#206](https://github.com/pascalorg/editor/pull/206)) by [@claygeo](https://github.com/claygeo)
- **Material system enhancements** ([#201](https://github.com/pascalorg/editor/pull/201)) by [@PMAT77](https://github.com/PMAT77)
- **Editor layout redesign v2** + 3D box select
- **Move/rotate building** + relative positioning for all tools
- **Grid snap toolbar controls**
- **Cut-out button** in floating action menu for slabs and ceilings

### Fixes

- **WebGPU renderer** — await `renderer.init()` in Canvas GL factory ([#233](https://github.com/pascalorg/editor/pull/233)) by [@b9llach](https://github.com/b9llach)
- **WebGPU fallback** — skip post-processing when unavailable ([#234](https://github.com/pascalorg/editor/pull/234)) by [@b9llach](https://github.com/b9llach)
- **Crash on mode switch** — fix crash when switching to Furniture mode ([#237](https://github.com/pascalorg/editor/pull/237)) by [@txhno](https://github.com/txhno)
- **Crash on duplicate** — prevent crash when duplicating elements ([#239](https://github.com/pascalorg/editor/pull/239)) by [@nnhhoang](https://github.com/nnhhoang)
- **Delete walls/slabs** via floating action menu ([#180](https://github.com/pascalorg/editor/pull/180)) by [@nnhhoang](https://github.com/nnhhoang)
- **Counter-clockwise rotation** — T key for CCW rotation on selected nodes ([#184](https://github.com/pascalorg/editor/pull/184)) by [@nnhhoang](https://github.com/nnhhoang)
- **Scene singleton cleanup** — release singletons on Editor unmount ([#214](https://github.com/pascalorg/editor/pull/214)) by [@geopenta](https://github.com/geopenta)
- **State management & memory leaks** ([#152](https://github.com/pascalorg/editor/pull/152)) by [@hobostay](https://github.com/hobostay)
- **Ghost wall prevention** — use WALL_MIN_LENGTH constant ([#168](https://github.com/pascalorg/editor/pull/168)) by [@zephran-dev](https://github.com/zephran-dev)
- **Catalog image optimization** — add sizes and loading props ([#189](https://github.com/pascalorg/editor/pull/189)) by [@korvixhq](https://github.com/korvixhq)
- **Code cleanup** — remove unused `@ts-expect-error` directive ([#150](https://github.com/pascalorg/editor/pull/150)) by [@cs68614-hash](https://github.com/cs68614-hash)
- Robust undo/redo with nested history pause/resume
- Post-processing recovery after duplicate scene mutations
- Improved snapping across all geometry types
- Thumbnails, placement, and responsiveness improvements
- Stair elevation sync with floor slabs

### Contributors

A huge thank you to everyone who contributed to this release! 🎉

- [@sudhir9297](https://github.com/sudhir9297) — material system, wall-room generation, curved walls, stairs, fences (7 PRs!)
- [@zephran-dev](https://github.com/zephran-dev) — export system, wall length slider, ghost wall fix
- [@nnhhoang](https://github.com/nnhhoang) — rotation controls, delete actions, crash fix
- [@b9llach](https://github.com/b9llach) — WebGPU renderer fixes
- [@txhno](https://github.com/txhno) — furniture mode crash fix
- [@Yashism](https://github.com/Yashism) — street view / walkthrough mode
- [@claygeo](https://github.com/claygeo) — infinity dragging slider
- [@geopenta](https://github.com/geopenta) — scene singleton cleanup
- [@kleenkanteen](https://github.com/kleenkanteen) — duplicate project feature
- [@mvanhorn](https://github.com/mvanhorn) — STL/OBJ export formats
- [@PMAT77](https://github.com/PMAT77) — material system enhancements
- [@korvixhq](https://github.com/korvixhq) — catalog image optimization
- [@hobostay](https://github.com/hobostay) — state management & memory leak fixes
- [@cs68614-hash](https://github.com/cs68614-hash) — code cleanup
