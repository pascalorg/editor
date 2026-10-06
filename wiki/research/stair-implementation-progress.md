# Stair implementation progress

Implementation follows the [stair modeling review](stair-modeling-review.md). Each slice is independently reviewed before the next starts. This is a working record; remaining work is not claimed complete.

| Slice | Status | Verification |
| --- | --- | --- |
| Walking-surface elevations and integrated spiral landing arrival | Approved | 36 tests; independent 512 layout cases and 8 mounted renderer cases |
| Atomic parent/flight rise edits, live preview, undo and multi-selection | Approved after revision | 58 focused tests; exported handle/inspector probes; Plugin v1 conformance |
| Plan counts, signed multi-turn sweeps, radii, going and SVG circles | Approved after revision | 89 stair suite tests; independent 24 floorplans, 8 SVG cases and 45 focused tests |
| Shared chained transforms and unused viewer railing removal | Approved | 89 stair suite tests and package builds; independent 405 transforms, 81 footprint chains and mounted viewer updates |
| Selected/merged paint and flight material parity | Approved after revisions | Mounted renderer regression (8 tests, 57 assertions), paint/erase/orphan probes and node/dependency builds |
| Shared sizing, uniform-riser repair and measurements | Approved after revisions | 60 core/MCP tests, 348 assertions; independent 600 sizing cases and 13 contract tests |
| Shared creation defaults | Approved after revisions | 88 independently run feature tests, 534 assertions; 81 support/destination cases, mounted preview/commit/disposal checks |
| Walking clearance, headroom and opening calculations | Approved after revision | 14 independently run opening tests, 55 assertions; 117 exported geometry and budget checks |
| Layout presets, fit alternatives and winding controls | Approved | 63 independently run tests, 427 assertions; 450 public layout probes and atomic GUI undo |
| Selected walking line in both views | Approved | 56 tests, 833 assertions; 71 independent paths and mounted live/disposal/export checks |
| Straight construction details | Approved after revisions | 125 feature tests; independent 15,930 construction/clearance checks and live downstream body regression |
| Arc construction | Approved after UV revision | 68 independently run tests; 122,040 triangle edges verified within 0.000001 m UV scale error; mounted disposal and actual GPU/plan checks |
| Continuous railing styles and independent handrails | Approved after revision | 71 feature tests; 10,836 independent API checks and mounted live preview, cancel and disposal checks |
| Dimension limits and handle parity | Approved after revisions | 142 feature tests, 1451 assertions; independent 85 public probes and 12 mounted live/selection/export checks |
| IFC flight properties and landing classes | Approved after revision | 91 feature tests; independent 77 tests, 55,830 assertions, parsed WebIFC properties, identifiers, hidden ownership and both signed spiral landings |
| Legacy implicit-opening load preservation and diagnostic contract | Approved | 60 tests, 580 assertions; 24 independent public probes for shapes, signed sweeps, offsets, idempotence, authored holes and explicit clearance edits |
| Headless migration and fallback flight boundary | Approved | 132 feature tests; independent 79 tests, 67,260 assertions, clean 268-module Node bundle, 24 fallback-rise and 6 raised-support/destination probes |
| Stair test browser-global isolation | Approved | Independent 73 tests, 54,966 assertions; absent/defined descriptor probes; full nodes suite 4,636 pass, 1 existing skip |
| Final repository checks and visual verification | Passed | `bun run ci`: check, skill validation, 13 type-check tasks, 15 test tasks and 9 build tasks; actual GPU/browser and GLB/USDZ checks |

Actual GPU/browser checks covered straight and U layouts, 2D plans, a 400° spiral with side stringers, a negative waist spiral with an integrated landing, and U glass guards with separate handrails. No page errors occurred in these checks.

Public GLB and native USDZ exports passed for U waist/glass, +400° spiral side stringers/metal, and −400° spiral waist with integrated landing. Re-imported GLB bounds match exactly, painted tread colors and handrail metadata survive, overlays are absent, USDZ files contain native geometry, and no export warnings occurred. These were mounted renderer probes; they are not a broad visual review of every scene.

Design targets are configurable guidance. Headroom queries cover slabs, ceilings and stair bodies; arbitrary furniture, roof and imported-mesh obstacles remain outside that query. Unknown IFC headroom is omitted. Arbitrary path design and repeated multi-storey stairs remain later extensions as scoped in the research. L/U winders are covered by the next improvements below.

All implementation and corrective slices have independent approval. Final `bun run ci` passed on 2026-10-06, including both standalone app production builds. Package suites include 3,630 core tests, 1,911 editor tests, 4,636 nodes tests (one existing skip), 537 MCP tests, 507 viewer tests, and 89 IFC converter tests. Biome reports 154 warnings and 8 informational diagnostics; no errors. `git diff --check` passed.

## Next improvements

Independent handrail end details are implemented and independently approved: optional bottom sloped and top horizontal extensions, geometric wall/post/floor returns, signed arc tangents, source/arrival floor endpoints, and computation-budget accounting. Absent end settings preserve previous paths. Wall/post returns are geometric and do not attach to host nodes; corners are straight rather than rounded fittings.

Verification for this slice: 68 feature tests with 67,196 assertions, 64 public API floor-return cases across straight/L/U and signed arc layouts, 64 arc tangent/outward-return checks, and seven successful typecheck/build tasks. 

L/U winders are implemented and independently approved after revisions. Quarter-turn segments compose L/U layouts with equal-going or equal-angle divisions, configurable inner gaps and walking-line offsets, measured narrow ends, uniform risers, shared 2D/3D geometry, five construction modes, continuous guards and independent handrails. The inspector, sizing, MCP fit/measure tools and semantic IFC export use the same geometry. Existing scenes retain landing layouts unless winders are explicitly selected.

Review corrections covered preset visibility, connected zero-gap inner guards/handrails, terminal quarter-winder extensions/returns, and JSON-safe MCP measurement fields. Every correction received fresh independent approval. At a zero-radius inner pivot, the bottom handrail extension uses the nominal walking-line incline; wall/post returns remain geometric rather than hosted connections.

Verification includes 480 independent construction cases, 80 revised layout/rail cases, 76 core stair tests with 13,548 assertions, the full 538-test MCP suite, actual browser 2D/3D views and one-step layout undo. Mounted GLB/native USDZ checks passed for six L/U cases across positive and zero inner gaps, both turns and selected construction/guard styles: exact re-imported GLB bounds, retained painted colors/handrail metadata, no overlays and no export warnings. These probes do not cover every parameter combination.

Final `bun run ci` passed on 2026-10-06: formatting/checks, skill validation, all 13 type-check tasks, all 15 test tasks and all nine build tasks, including both standalone app production builds. Core: 3,638 tests; nodes: 4,638 tests (one existing skip); MCP: 538 tests; IFC converter: 90 tests. `git diff --check` passed.

## Railing model refinement

Balusters are implemented and independently approved after three corrective slices. Original and continuous layouts now use square newels, connected top/bottom rails, plumb pickets with controlled spacing, metre-scale UVs and shared signed arc paths. Curved and spiral guards use at most 5-degree path intervals; integrated landings and zero-gap winder pivots retain guards. Terminal reach/top-post settings and computation budgets were independently checked across editor-generated straight, curved, spiral, L/U landing and winder layouts.

Verification: full `bun run ci` passed on 2026-10-06. Independent review ran 130 stair tests and 83 export/IFC/MCP tests plus architecture and registration gates. External Chrome checks covered original/continuous curved guards, positive and negative 400-degree spirals with integrated landings, and L/U winders including zero and positive inner gaps. Mounted public-package GLB/native USDZ probes passed for ten original/continuous curved, signed spiral and L/U winder cases: exact re-imported bounds, retained paint and handrail metadata, no overlays or export warnings.

The continuous builder assumes paths run bottom to top; the reviewer confirmed this for every editor preset, but identified a degenerate hand-authored top-landing chain that can reverse a path. This is a low-severity durability limitation. Post-and-rail, cable, boards, glass and metal model refinements remain pending.

Post-and-rail is independently approved after correcting the original straight guard's per-nosing computation budget. Its shared path model adds substantial square posts, a broad cap, top/bottom rails and square pickets across straight, curved, signed spiral, landing and winder paths. The extraction of shared guard geometry preserved the approved baluster model. Dense explicit and implicit flights now refuse before rail allocation while retaining authored dimensions/counts.

Verification: full `bun run ci` passed after the correction. The fresh reviewer ran 58 stair tests and 21 guard geometry tests and checked fallback, landing and multi-flight budget accounting. Ten mounted public-package GLB/native USDZ cases passed with exact bounds, retained paint/handrail metadata and no export warnings. External Chrome checks covered an L winder and original/continuous positive and original negative 400-degree spiral guards. Cable, boards, glass and metal refinements remain pending.

Cable is independently approved after correcting sharp-corner anchoring and the corner-sleeve budget. Round metre-UV cables span straight between support posts, with terminal sleeves and supports at isolated and consecutive sharp turns. Smooth arc sampling does not create a post at every vertex. Full CI passed after the correction; 30 guard tests and the previously failing mounted continuous-guard regression passed. External Chrome views checked a U landing's corner anchors and a 400-degree spiral. Ten mounted export cases passed before the corner correction; the refreshed export probe is being repeated. Outer curved cable chords sit inward of the curved cap by design; the original-layout cable budget remains conservative for unusually tall or dense flights. Boards, glass and metal refinements remain pending.

Boards are independently approved with the original-layout per-nosing/course budget corrected. Shared geometry now renders substantial posts, a broad cap and consistent plank courses across all stair shapes; legacy split renderers were removed. Full CI passed after the correction, and the dense guard regression preserves authored counts/dimensions while accepting ordinary flights. External Chrome checked continuous U landing connections and a 400-degree spiral. Mounted GLB/native USDZ export checks covered ten original/continuous curved, signed spiral and L/U winder cases. Glass and metal model refinements remain pending.

Glass is independently approved after two geometry corrections: outer flat panes move away from the walking volume, and extended clamps bridge the resulting standoff back to the posts. Panels have reveals, plumb edges and thickness; frame and transparent infill retain separate paint slots and metre UVs. Full CI passed after the clamp correction; fresh review independently checked clamp/post overlap on straight, default curved and tight spiral cases. External Chrome inspected the final 400-degree spiral, and ten refreshed mounted GLB/native USDZ probes passed. Clearance follows the sampled rail polyline; ideal-arc residual grows with tessellation and radius. Metal remains the last pending model refinement.
