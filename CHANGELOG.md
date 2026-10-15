# Changelog

## Unreleased

### Features

- **`view_scene` sees the house as a front photo does.** `from` also takes the sides a photo is named by, standing in the street: `street`, `street-left`, `street-right`, `left`, `right`, `back`, `back-left`, `back-right`, from the street edge the site records, else the house's own front (its −z, the way a generated house faces; core's `buildingStreet`, which the hosted Architect's street-relative tools read too). `camera: 'current'` looks through the person's own view where the host has one (the MCP refuses it, `no_current_camera`), `lighting` renders the picture in a photo's light (`day`, `overcast`, `sunset`, `dusk`, `night`) and `maxPx` makes it smaller (a picture is never longer than 1920 px). A view of a building, or of the whole scene, frames its roofs with its storeys, and a plugin's node on a level (a roof plane) up to its storey's top; a street side with buildings on several sites and no target or interior floor is refused (`which_building`). A `SceneViewHost` receives the `lighting` to render in. `camera-controls:capture-session` is a typed event, counted once in core (`isCaptureSessionOn`, `subscribeCaptureSessions`) from the moment it loads: runs that overlap (a sheet's pictures, an agent's view) present the finished house once and put the person's view back after the last, and a plugin draws its own finished view from the same count. Every picture is planned at 1920 × 1200, and `interior: { levelId }` looks inside one floor ([#1034](https://github.com/pascalorg/editor/pull/1034), [#1051](https://github.com/pascalorg/editor/pull/1051), [#1075](https://github.com/pascalorg/editor/pull/1075))
- **One finder, one node read, one scene check.** `find_by_type` takes `find_nodes`' filters (`parentId`, `zoneId`, `sourceId`, `sourceIdPrefix`, or none, with `limit`), `get_node` gives what `describe_node` added (`ancestorIds`, resolved heights and thicknesses, `displayName`, `missingChildIds`), and `verify_scene` lists every schema error by node and path and the spaces the walls leave without a room ([#1081](https://github.com/pascalorg/editor/pull/1081), [#1084](https://github.com/pascalorg/editor/pull/1084))
- **The site comes first.** `get_site` reads the lot, its buildable area, street, north, ground and zoning, each buildable edge with its frontage and depth, and the 30–45% footprint a house usually covers; `place_building` stands a house on its lot by moving the building node only ([#1044](https://github.com/pascalorg/editor/pull/1044), [#1080](https://github.com/pascalorg/editor/pull/1080))
- **One notation.** Every length and angle of the shared tools reads a bare number in its field's unit or text in any unit (inches, feet, millimetres included); `roofPitch()` reads a pitch as degrees or rise over run (`"6:12"`, `"6/12"`, `"6 in 12"`), and `create_roof`'s `overhang` is the eaves' reach in plan ([#1079](https://github.com/pascalorg/editor/pull/1079))
- **One finish tool.** `paint` gives every part with surfaces a finish (blocks, stairs, cabinets, roof fascias, wall faces by their rooms) and keeps native materials as scene materials; `search_materials` searches and browses the library a page at a time ([#1034](https://github.com/pascalorg/editor/pull/1034), [#1076](https://github.com/pascalorg/editor/pull/1076))
- **L and U stairs.** `create_stair` takes `layout: 'l' | 'u'`, `turn`, `lowerSteps`, railing styles and materials, and `toLevelId: null` for porch or deck steps ([#1073](https://github.com/pascalorg/editor/pull/1073))
- **Roofs on the roof level.** A roof lives on the level directly above the walls that carry it: `create_roof`, the Roof tool, `apply_patch`, paste, duplicate and every other writer seat it there; `verify_scene` reports older roofs (`roof_mixed_in_storey`) and `move_roofs_to_roof_level` or a roof panel's "Move to the roof level" moves them without changing how they look ([#1039](https://github.com/pascalorg/editor/pull/1039), [#1047](https://github.com/pascalorg/editor/pull/1047), [#1057](https://github.com/pascalorg/editor/pull/1057))
- **Gable overhang.** A roof segment's `gableOverhang` sets how far its gable ends reach past their walls, apart from the eaves, with a "Gable overhang" slider; left out, the ends reach as the eaves do ([#1082](https://github.com/pascalorg/editor/pull/1082))
- **Barrel and glazed roofs.** `roofType: 'barrel'` arches a segment; `roofSystem: 'glazed'` builds a gable, straight shed or barrel roof as panes and framing, with grids, panel overrides and `glazing-frame` / `glazing-glass` / `glazing-solid` paint slots. See `wiki/glazed-roofs.md` ([#1055](https://github.com/pascalorg/editor/pull/1055))
- **Blender geometry scripts.** An authored object, window, door or column can be a `bpy` module (`language: 'bpy'`), built by a host-configured `BlenderScriptBuilder` or, on a local MCP, the binary `PASCAL_BLENDER` names. See `wiki/blender-geometry-scripts.md` ([#1033](https://github.com/pascalorg/editor/pull/1033))
- **Plugin agent tools.** A plugin ships `./agent-tools` contracts and `./agent-operations` beside its manifest; an MCP host registers them with `registerOperationTool`, and a chat extension can add cards, `/` actions and a start screen ([#1026](https://github.com/pascalorg/editor/pull/1026), [#1043](https://github.com/pascalorg/editor/pull/1043))
- **Views.** The stage is one or two panes, each a view: 3D, 2D or a plugin's (`registerEditorHostView`, `openEditorView`), with a view bar per pane and a plugin directory view (`PLUGINS_VIEW_ID`) ([#1023](https://github.com/pascalorg/editor/pull/1023))
- **More for hosts.** `loadingSlot` supplies the loading surface, `actionMenuPlacement: 'top'` docks the tool menu under the toolbar, and `selectZoneOrRoom`, `frameViewerNode`, `enterUnitFocus`, `IconRefGlyph` and `IconRefImage` are exported; the plan frames a node when it is the only view and lights what a host's chat points at. See `packages/editor/README.md` ([#995](https://github.com/pascalorg/editor/pull/995), [#1040](https://github.com/pascalorg/editor/pull/1040), [#1043](https://github.com/pascalorg/editor/pull/1043), [#1070](https://github.com/pascalorg/editor/pull/1070))
- **Light chrome.** The editor follows the host's `.dark` class instead of forcing dark, and `InterfaceThemeRow` gives a host's settings a System / Light / Dark row ([#1041](https://github.com/pascalorg/editor/pull/1041))
- **Self-hosting is one container.** `ghcr.io/pascalorg/pascal-editor:<version>` ships the same portable runtime as the CLI, multi-arch, published by the release workflow. The public URL is read per request (`PASCAL_PUBLIC_URL`, replacing the build-time `NEXT_PUBLIC_APP_URL` and `MINT_PASCAL_HOST_ORIGIN`), so one image serves any domain or port. A single admin password (`PASCAL_ADMIN_PASSWORD`) gates every page and API behind `/login`; agents keep the `PASCAL_SCENE_API_TOKEN` bearer; a network host with nothing configured serves a setup page and nothing else; `PASCAL_AUTH=proxy` defers to an authenticating reverse proxy. See `SETUP.md`, "Self-hosting" ([#1032](https://github.com/pascalorg/editor/pull/1032), [#1038](https://github.com/pascalorg/editor/pull/1038))
- **The standalone app is a product, not a shell.** Home at `/` lists projects (the unsaved scratch canvas and `/scenes` are gone; `/scenes` and `/scene/<id>` redirect to `/` and `/project/<id>`), new ones are named `Project #n`, each card renames and deletes; the editor gets a navbar (logo back to home, inline rename, Preview); `/settings` holds the instance info, the agent endpoint and sign-out; thumbnails are captured after edits and stored under the data directory. `/privacy`, `/terms` and `vercel.json` leave the open-source app.
- **Public embeds.** A Share button in the editor navbar turns on a per-project public link: a read-only 3D view at `/embed/<id>` that needs no password and can be iframed, with a copyable link and `<iframe>` snippet. Projects are private until shared, and turning the link off makes it a 404 again. See `SETUP.md`, "Self-hosting" ([#1032](https://github.com/pascalorg/editor/pull/1032))

### Breaking

- **Three MCP tools retired.** `validate_scene` → `verify_scene`, `find_nodes` → `find_by_type`, `describe_node` → `get_node`. They are no longer listed; a call to one answers `tool_retired` with its `replacement` ([#1081](https://github.com/pascalorg/editor/pull/1081), [#1084](https://github.com/pascalorg/editor/pull/1084))
- **The editor no longer forces dark chrome.** A host that wants it dark puts `dark` on an ancestor and on `<body>` (or `<html>`) for the menus that portal there; the standalone app does ([#1041](https://github.com/pascalorg/editor/pull/1041))
- **`viewMode` / `setViewMode` are deprecated** for views (`viewLayouts`, `visibleScene`, `isViewVisible`). They still work and old preferences migrate ([#1023](https://github.com/pascalorg/editor/pull/1023))
- **`wall.assembly` is now F2 assembly layers** (breaking change to the additive plugin v1 contract; the WS5 shape shipped days earlier in #937). Walls store `{ layers: [{ id, role, thickness, core?, material?, … }], face?, presetId?, cavityInsulation? }` instead of `{ exterior, sheathing, framing, interior, preset }`. Scenes saved with the old shape are converted on load and at the scene API boundary, so `thickness` and every drawing stay the same. Plugins that read `wall.assembly.exterior` / `.framing` / `.preset` directly should read `wallAssemblyToLegacy(wall.assembly)` (the old shape, or `null` for a stack it cannot express), `wallAssemblyFraming(wall)` or `wallAssemblyExteriorFinish(wall)`; `WALL_ASSEMBLY_PRESETS[i].assembly` is F2 too.

### Release process

- The Release workflow checks that every package already exists on npm before it builds anything, so a package never published by hand fails the run at the start instead of mid-publish; `wiki/npm-release.md` has "Adding a package" ([#1049](https://github.com/pascalorg/editor/pull/1049))
- The release commit and tags are pushed with the `RELEASE_DEPLOY_KEY` deploy key, which the `main` ruleset lets through ([#1050](https://github.com/pascalorg/editor/pull/1050))

## 1.0.0 (2026-09-12)

### Features

- Add plugin-contributed editor panels and viewer presentations with project-local configuration persistence.
- Include Environment in the standalone app's Plugins catalogue, with a pinned GitHub dependency and registered editor panel and viewer presentation.
- Refresh Environment's authoring controls and include its interactive color picker.
- Update Environment to its pinned global-visibility release, with a session-wide master control and isolation-aware presentation visibility.
- Expose generic atmosphere and ground-replacement adapters, Site-scoped floorplan output, bake-only GLB geometry, and plugin-owned selection materials.
- Add portable GLB/USDZ downloads with asynchronous material baking, procedural-content filters, and opt-in static viewer-presentation exports.
- **Public agent skills** — `pascal-3d` and `furniture-fit` teach MCP-capable agents to build, inspect, validate, and hand off scenes, and to report measured furniture footprints with evidence-scoped conclusions, fail-closed input gates, blocker-aware next actions, and an optional no-sign-in footprint pre-check link ([#777](https://github.com/pascalorg/editor/pull/777), [#781](https://github.com/pascalorg/editor/pull/781), [#791](https://github.com/pascalorg/editor/pull/791), [#794](https://github.com/pascalorg/editor/pull/794), [#824](https://github.com/pascalorg/editor/pull/824))
- **Plugin bundles 0.1.3 → 0.1.8** — the same canonical `skills/` source ships as one versioned plugin with a recorded validation ledger per bundle ([#782](https://github.com/pascalorg/editor/pull/782), [#795](https://github.com/pascalorg/editor/pull/795), [#802](https://github.com/pascalorg/editor/pull/802), [#811](https://github.com/pascalorg/editor/pull/811), [#825](https://github.com/pascalorg/editor/pull/825))
- **Claude Code and Codex plugin marketplaces** — this repository is installable as `pascal-agent-skills@pascal`, with a credential-free local `pascal mcp connect` server bundled for Claude Code ([#777](https://github.com/pascalorg/editor/pull/777), [#810](https://github.com/pascalorg/editor/pull/810))
- **Hosted MCP server in the Claude Code plugin** — `pascal-agent-skills@pascal` now also bundles a `pascal-hosted` Streamable HTTP server for `https://editor.pascal.app/api/mcp`, authenticated with an optional Pascal API key collected as sensitive plugin user configuration and stored in the OS keychain rather than any file ([#835](https://github.com/pascalorg/editor/pull/835))
- **OpenAI portable plugin manifest** — root `plugin.json` carries the Agent Plugins schema, listing metadata, branding assets, a With MCP review packet, and per-tool annotation justifications for all 46 MCP tools ([#796](https://github.com/pascalorg/editor/pull/796), [#797](https://github.com/pascalorg/editor/pull/797), [#799](https://github.com/pascalorg/editor/pull/799), [#812](https://github.com/pascalorg/editor/pull/812), [#813](https://github.com/pascalorg/editor/pull/813))
- **ClawHub publication readiness** — scoped `.clawhubignore` policies with regression tests that reject re-inclusion and legacy-override rules ([#798](https://github.com/pascalorg/editor/pull/798), [#806](https://github.com/pascalorg/editor/pull/806))
- **Official MCP Registry entry** — `io.github.pascalorg/editor` 0.6.1 publishes the hosted Streamable HTTP endpoint, with CI validating the manifest against the live API catalog ([#808](https://github.com/pascalorg/editor/pull/808), [#809](https://github.com/pascalorg/editor/pull/809))
- **Portable `mcp.json`, Cursor manifest, Gemini extension, plate logo** — Codex and Cursor now register the bundled MCP server (the spec reads root `mcp.json`, not `.mcp.json`); `.cursor-plugin/plugin.json` and `gemini-extension.json` add those marketplaces; the MCP Registry entry gains `repository` and `icons`; marketplace logos use the brand mark on its `#171717` plate; `bun run skills:validate` asserts parity across every descriptor ([#829](https://github.com/pascalorg/editor/pull/829))
- **`pascal agent claim` and `pascal agent status`** — an agent can open a prefilled 15-minute human handoff and verify its hosted key without storing or printing it, shipped in the npm-published CLI ([#815](https://github.com/pascalorg/editor/pull/815), [#818](https://github.com/pascalorg/editor/pull/818), [#819](https://github.com/pascalorg/editor/pull/819), [#821](https://github.com/pascalorg/editor/pull/821), [#822](https://github.com/pascalorg/editor/pull/822))
- **Small CLI, downloaded web runtime** — `@pascal-app/cli` now installs from a 0.5 MB npm package instead of 65 MB: the MCP service ships inside it, so `pascal mcp connect` works with no editor process and no download, while the web editor runtime is fetched once per version from its release asset, verified against a SHA-256 digest published in the package, and installed atomically; `--runtime <directory-or-archive>` covers offline hosts, `HTTPS_PROXY`/`NO_PROXY` are honoured, and an editor started by a pre-split CLI keeps its own MCP child, which must be stopped once by hand after upgrading (#845)
- **Optional hosted key in the Cursor plugin** — `.cursor-plugin/plugin.json` declares an optional `PASCAL_API_KEY` variable and points at a Cursor-dialect `.cursor-plugin/mcp.json` that adds a `pascal-hosted` server for `https://editor.pascal.app/api/mcp`, so a Cursor install can reach hosted projects, Capture scans, and shared workspaces while the credential-free local server keeps working; the portable `mcp.json` stays credential-free because Agent Plugins 1.0.0 forbids secrets and placeholder expansion in `headers`, so Codex configures the hosted endpoint with `codex mcp add --bearer-token-env-var PASCAL_API_KEY` instead ([#849](https://github.com/pascalorg/editor/pull/849))
- **Capture packages folded into core and viewer** — `@pascal-app/capture-protocol` is now `@pascal-app/core/capture` and `@pascal-app/capture-viewer` is now `@pascal-app/viewer/capture` (plus `@pascal-app/viewer/capture/preview`), so 1.0.0 ships seven packages instead of nine. Neither package was ever published to npm, so there is no npm migration; in-repo and workspace consumers change their import paths only.

### Fixes

- Preserve native and active presentation skies in snapshots and keep preset captures transparent.
- Localize terrain and ground-cover brush updates, preserve pending dab uploads, and keep Environment's day/night light graph stable.
- Keep Site-scoped floorplan overlays aligned with live move and rotation previews.
- Preserve Site ownership and same-kind sibling context in synchronous and asynchronous export geometry, including Site children without a parent ID.
- Exclude detached Site children and their descendants from visible-only exports when their owning Site is hidden, including children without a parent ID.
- Preserve unsaved presentation settings when a project receives its first ID, without overwriting an existing project's stored configuration.
- Avoid native TypeScript compiler inference overflow in atmosphere fog references without changing rendering.
- Omit stale viewer-surroundings selections from GLB/USDZ downloads after a presentation is unregistered or its plugin is uninstalled.
- Keep export settings scrollable and group advanced model options in a keyboard-accessible disclosure.
- Preserve child geometry when exporting empty mesh containers to USDZ.
- Export the viewer's shadow-only layer for plugin consumers.
- Remove the nonworking god-ray post-process and its dedicated viewer API; preserve sky, fog, lighting, and ordinary shadows.
- Preserve grass and procedural material colors in portable exports; freeze instancing and deformation without changing the live scene or saved-viewer animation clips.
- Stop registered placement tools when their plugin is uninstalled in either view, preserving authored nodes and requiring explicit reactivation after reinstall.
- Include enabled, visible Site contributions below architecture in floorplan PDFs, preserving building transforms, inline images, and even-odd holes. Hidden Sites also hide children associated through their declared child list.
- The Claude Code plugin root is now `skills/` instead of the repository root, so installing `pascal-agent-skills@pascal` copies the two skill bundles and their MCP configuration instead of caching the whole monorepo and running `bun install` against the root lockfile ([#832](https://github.com/pascalorg/editor/pull/832))
- Preserve custom scene materials across save, load, clone, fork, and live sync. Materials were dropped at every persistence boundary, so a scene reopened with default surfaces. Collections were dropped on MCP import for the same reason ([#597](https://github.com/pascalorg/editor/pull/597)) by [@ShiroKSH](https://github.com/ShiroKSH)
- Wall junction mitering is now deterministic for exactly-collinear walls, so identical scenes produce identical geometry regardless of node iteration order ([#596](https://github.com/pascalorg/editor/pull/596)) by [@tomatotomata](https://github.com/tomatotomata)

### Packages

All seven public packages are published as `1.0.0` under the npm `latest`
dist-tag: `core`, `viewer`, `editor`, `nodes`, `mcp`, `ifc-converter`, and
`cli`. `@pascal-app/capture-protocol` and `@pascal-app/capture-viewer` were
folded into `@pascal-app/core/capture` and `@pascal-app/viewer/capture` before
the release and were never published.

### Contributors

Thank you to [@wass08](https://github.com/wass08),
[@Snoopy147](https://github.com/Snoopy147),
[@sudhir9297](https://github.com/sudhir9297),
[@ActArtech](https://github.com/ActArtech),
[@anton-pascal](https://github.com/anton-pascal),
[@toycenterboss-bot](https://github.com/toycenterboss-bot),
[@JimmyZheng-ZJU](https://github.com/JimmyZheng-ZJU),
[@ShiroKSH](https://github.com/ShiroKSH),
[@tomatotomata](https://github.com/tomatotomata),
[@alxbouchard](https://github.com/alxbouchard),
[@SomSamantray](https://github.com/SomSamantray),
[@konevenkatesh](https://github.com/konevenkatesh),
[@maherm](https://github.com/maherm),
[@rootsbymenda](https://github.com/rootsbymenda),
[@tamg](https://github.com/tamg),
[@tylergibbs1](https://github.com/tylergibbs1),
[@vjureta](https://github.com/vjureta),
[@yorhodes](https://github.com/yorhodes), and
[@ztffn](https://github.com/ztffn) for their work across the editor, viewer,
node library, MCP integration, plugins, documentation, and stability fixes.

**Full changelog**:
https://github.com/pascalorg/editor/compare/v1.0.0-beta.1...v1.0.0

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
