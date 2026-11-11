# Live viewer fixture

This directory is deliberately outside the workspace globs. Run from the repository root:

```sh
bun run check:viewer-live
```

The script builds core/viewer/nodes, packs their distributions, copies this app into `/tmp`,
installs the tarballs and explicit React/Three/R3F/drei peers with npm, and rejects editor/Next
anywhere in `npm ls --all`. It builds Vite and tests both dev and preview with Playwright and
SwiftShader, with normal and denied localStorage. It requires a local Chrome or Playwright Chromium
(`bunx playwright-core install chromium`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides the executable.
`PASCAL_VIEWER_BUILD_ROOT` optionally selects an enclosing Turbo workspace for the package build.
`KEEP_VIEWER_LIVE_FIXTURE=1` retains the temporary install for debugging.

`scene.json` was generated with core's node parsers and its recessed-downlight recipe fixture.
It contains four walls, a door/window, a roof segment, a zone, a separator,
a measurement, a ceiling with a procedural downlight cut, and a GLTF item with a painted material slot. `public/cube.gltf`
is a tiny self-contained cube with a `slot_body` material. There is no baked scene asset.

The readiness probe requires the viewer's scene-ready callback, no pending build work, real node
geometry and actual draw calls. It also rejects model failures, browser errors and a process
polyfill. The page styles `@pascal-app/viewer/ui` with Tailwind and the shipped `theme.css`, as
that entry's README describes, and mounts the viewer inside `ViewerStage` with the controls bar and
loader; the check requires their icons to load from `assetsBaseUrl` and a sound from `sfxBaseUrl`.
It then mounts `ParametricViewerRooms` with only the level selected, requires the zone's room pill,
clicks it, and requires the room's highlight on the overlay layer and its callout. Last, it clicks
the stage switcher's 2D and Split buttons and requires the read-only plan to draw outlines for the
walls, door, window, roof, ceiling, zone and item from `renderPlugin` alone, beside the 3D view in Split.
No Next configuration or editor package is used.
