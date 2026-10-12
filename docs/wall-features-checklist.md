# Wall niche and bump implementation checklist

Implement one numbered item at a time. Check its implementation tasks as they
land, record the checks actually run, and check the numbered item only after its
acceptance checks pass. Keep unfinished work unchecked.

First release: rectangular niches and bumps on straight, solid walls, including
a niche inside a bump. Curved walls, arbitrary overlapping boolean stacks,
automatic trim wrapping, and an emissive niche strip are follow-up work.

Architecture references: [DECISIONS.md](../DECISIONS.md),
[wall frame](../wiki/architecture/wall-frame.md),
[node definitions](../wiki/architecture/node-definitions.md),
[tools](../wiki/architecture/tools.md), and
[plugin authoring](../wiki/architecture/plugin-authoring.md).

## Checklist

- [x] **1. Define the scene model**
  - [x] Add the core `WallFeatureNode` schema, type, ID, union membership, and exports.
  - [x] Register `wall-feature` in the built-in plugin with `niche` and `bump` modes.
  - [x] Store host ownership through `parentId`; retain feature and item children.
  - [x] Define metres-based `u`, `bottom`, `width`, `height`, and `depth`, face `a`/`b`, and finish slots.
  - [x] Define direct-wall coordinates and nested host-relative coordinates.
  - [x] Preserve loading of scenes without wall features; update schema versions where existing schemas change.
  - [x] Check: create, serialize, and reload direct and nested features through package exports; load an existing scene.

- [x] **2. Centralize placement and validation**
  - [x] Resolve the root wall, face, base/top elevations, and feature frame in pure core logic.
  - [x] Enforce positive finite dimensions and horizontal/vertical host bounds.
  - [x] Enforce niche backing thickness, initially 0.02 m, including opposite-face recesses.
  - [x] Include bump depth in a nested niche's available depth.
  - [x] Reject unrelated overlap and unsupported curved or curtain-wall hosts.
  - [x] Validate parent resize and mode changes against nested children.
  - [x] Share rules across placement, inspector changes, wall transformations, and agent operations.
  - [x] Check: valid placements and clear refusals for invalid bounds, backing, overlap, nesting, and hosts.

- [x] **3. Integrate wall boolean geometry**
  - [x] Compose feature geometry with the existing node-owned wall adapter and rebuild lifecycle.
  - [x] Apply operations in order: wall body, bumps, niches, then door/window cuts.
  - [x] Extract the opening subtraction stage as needed so bumps cannot fill existing openings.
  - [x] Resolve nested volumes and effective live overrides without duplicating visible solids.
  - [x] Invalidate the root wall when features change, disappear, or change visibility.
  - [x] Include feature inputs in caches and propagate rebuild notifications to batching and bake paths.
  - [x] Dispose temporary boolean geometry and retain correct bounds and normals.
  - [x] Check: solid volume/bounds, preserved backing, niche inside bump, openings through bumps, visibility, rebuilds, and batch output.

- [x] **4. Add selection and editing controls**
  - [x] Add feature-owned selection targets that follow the boolean result.
  - [x] Make nested niches selectable ahead of their bumps and hosted objects ahead of feature targets.
  - [x] Add move, anchored width/height, and depth handles.
  - [x] Add inspector controls for mode, dimensions, position, elevation, face, and finish.
  - [x] Validate mode conversion and side changes with existing descendants.
  - [x] Exclude selection targets and handles from exports; placement ghosts follow in step 5.
  - [x] Check: select wall/feature/nested feature/item correctly; resize with anchored edges; reject invalid conversions.

- [x] **5. Implement 3D placement and gesture flows**
  - [x] Add Add niche and Add bump wall actions and placement tools.
  - [x] Resolve cursor placement on either wall face; allow niche placement within a selected bump.
  - [x] Preview niches around cursor height and bumps initially at the wall base.
  - [x] Integrate snapping, guides, Shift-tap mode cycling, Alt force behavior, and interaction scope.
  - [x] Publish gesture changes through `useLiveNodeOverrides` with immediate handles and cheap ghosts.
  - [x] Rebuild final boolean geometry on commit and record one undo step for the gesture.
  - [x] Clear overrides and previews on Escape, cancellation, and unmount.
  - [x] Exclude placement ghosts from exports.
  - [x] Check: place, move, resize, cancel, undo, and redo; verify no per-tick scene writes.

- [x] **6. Implement floor-plan parity**
  - [x] Draw selectable feature footprints/symbols on the correct wall face.
  - [x] Represent depth and distinguish features relative to the plan cut height.
  - [x] Support 2D placement, horizontal movement, width editing, and depth editing.
  - [x] Provide height and bottom elevation through the shared inspector.
  - [x] Reuse the same placement rules, snap behavior, live overrides, and commit semantics as 3D.
  - [x] Check: equivalent 2D/3D edits produce the same saved state; validate split-view and 2D-only gestures.

- [ ] **7. Integrate finishes and object hosting**
  - [x] Inherit the nearest host finish by default and support feature slot overrides.
  - [x] Preserve metre-scale UVs on bump faces, niche back, shelf, and reveals.
  - [x] Continue applicable wall paint regions onto feature surfaces.
  - [x] Expose bump tops and niche shelves through existing surface-hosting capabilities.
  - [x] Keep hosted items attached through feature and wall edits.
  - [x] Define cutaway behavior and trim behavior at feature intersections.
  - [ ] Check: inherited/overridden finishes, texture scale, paint regions, shelf/top placement, visibility, and hosted-item movement.

- [ ] **8. Handle wall transformations and deletion**
  - [x] Carry feature trees through wall move, rotation, reference changes, and justification changes.
  - [x] Remap feature position and face on actual wall direction reversal.
  - [x] Transfer features wholly on one side of a wall split; refuse a split crossing a feature.
  - [x] Remap ownership and coordinates when walls merge.
  - [x] Validate features when wall length, height, or thickness changes.
  - [x] Remap subtree IDs and ownership on duplication.
  - [x] Delete owned descendants atomically when deleting a wall or bump.
  - [x] Keep room boundary topology consistent while collision/support accounts for feature solids.
  - [ ] Check: each transformation preserves physical placement, references, descendants, and single-step undo.

- [ ] **9. Ship agent and export support**
  - [x] Add plugin-owned create/update contracts and pure operations using the shared validation.
  - [x] Publish `./agent-tools` and `./agent-operations` from the node package under E-016.
  - [x] Register operations in MCP and update public agent guidance.
  - [ ] Verify generic deletion supports feature subtree semantics.
  - [ ] Track and complete hosted-chat registration using the same contracts and operations.
  - [x] Preserve feature identity and hierarchy in scene persistence.
  - [ ] Include finished geometry once in published viewer, bake, and mesh exports.
  - [ ] Export niches as IFC openings and bumps as additive feature geometry.
  - [ ] Check: agent/manual validation parity, MCP execution, save/reload, hosted integration, and exported geometry.

- [ ] **10. Complete acceptance and repository checks**
  - [ ] Verify direct features on both wall faces and a niche inside a bump.
  - [ ] Verify distinct finishes, paint regions, and an object resting on a niche shelf.
  - [ ] Verify placement, resize, move, cancellation, undo, and redo in both views.
  - [ ] Verify raised-floor bases, plane-bound tops, and justified walls.
  - [ ] Verify split, merge, reverse, duplicate, hide, and delete behavior.
  - [ ] Verify reload and agreement between interactive, batched, baked, and exported geometry.
  - [x] Add meaningful contract/behavior tests through package exports under T-001.
  - [ ] Check complex-scene interaction and rebuild performance in the existing benchmark lane.
  - [x] Run `bun run ci` and resolve relevant failures.
  - [x] Record remaining scope and any external integration dependencies accurately.

## Check record

Append one entry after each numbered item. Record actual results, including
failures and remaining work. A pending hosted integration remains unchecked.

| Item | Implementation summary | Checks run and result | Remaining work |
|---|---|---|---|
| Planning | Checklist created; implementation has not started | No implementation checks run | Items 1–10 |
| 1 | Added the wall-feature schema and public exports, plugin registration, wall child support, and wall schema version 11. Defined direct and nested coordinate contracts with inherited faces. | Passed: 13 core tests covering schema, ownership, persistence, wall behavior, and legacy loading; 18 node tests covering registration and wall definition; filtered node/dependency build; available type checks for the affected packages; Biome on 12 changed source files; `git diff --check`. | Items 2–10. Geometry and editing UI are not implemented yet. |
| 2 | Added pure frame resolution, create/edit proposal planning, and validation of a proposed wall graph. Exported the shared rules from core and core/building for subsequent manual, inspector, transformation, and agent integrations. Validation covers host bounds, each face's floor datum, resolved tops, nested niches, backing between opposing recesses, overlaps, cycles, and parent edits without mutating or clamping the graph. | Passed: 81 tests across feature placement/persistence, existing opening rules, wall frames, slab support, and core architecture, including 22 placement tests; filtered node/dependency build; available affected-package type checks; Biome on 4 source files; `git diff --check`. | Items 3–10. The shared functions will be connected to geometry, tools, inspectors, wall commands, and agent executors in their respective items. |
| 3 | Added a generic wall body modifier before opening subtraction and composed it with the curtain-wall adapter. Features union/subtract into the root wall, inherit its face finish, retain metre-scale UVs, and follow the renderer's live support datum. Extended cutters cross bumps while preserving physical reveal radii. A registered feature system caches effective inputs and invalidates former/current roots for edits, live overrides, visibility, rehosting, and deletion; the existing wall queue supplies rebuild notifications and the completed source geometry to batching/capture. Walls with features cannot be curved through their action menu. | Passed: 19 feature geometry/lifecycle tests; existing node registration, wall definition, curtain-wall, batching, wall CSG/opening, finish, floor-step, terrain, underpinning, cutaway-cache, placement/persistence, and core architecture regressions. Plain-wall geometry retains its existing golden bytes. Filtered node/dependency build, available affected-package type checks, Biome on 15 source files, and `git diff --check` passed. | Items 4–10. Feature selection/editing UI, feature finish overrides, object hosting, and complete export acceptance remain in their scheduled items. |
| 4 | Added a registered feature renderer that picks surfaces from the finished root-wall body, including recess backs and later opening cuts. Cached registered ownership gives nested niches and hosted selectable objects priority while passive helpers pass through. Width/height grips keep lower edges fixed; depth and two position grips use validated live overrides. Inspector edits validate descendants, preview without document writes, and commit in one undo step. Finish selection and inheritance feed the root wall material palette; nested niches inherit the bump override. Selection meshes are stripped from export and feature groups retain hosted children. | Passed: 71 focused feature, registry, selection ownership, wall finish, and CSG tests; filtered node/dependency build, affected type checks, Biome, and `git diff --check`. | Free movement uses horizontal/vertical grips because the generic translate descriptor has no renderer. 2D controls remain in step 6; paint integration and object hosting remain in step 7. Interactive browser acceptance remains in step 10. |
| 5 | Added wall Add niche/Add bump actions and Add niche on a selected bump, with host-sized defaults and physical refusal messages. Registered 3D placement and move tools use root-wall ray hits on either face, wall-local grid/magnetic snapping, Shift-tap mode cycling, Alt raw cursor, wall-plane lattice and dimension guides. Source solids remain unchanged during move, resize, and inspector gestures; live overrides drive stripped ghosts and handles. Commit revalidates, writes once, selects the feature, and rebuilds affected roots. Escape, tool/view changes, revoked edit rights, host deletion, and unmount clear owned preview fields and listeners. Registry help now honors tool-owned placement/move hints. | Passed: 92 focused feature, validation, registration, help, snapping, and handle-history tests; filtered node/dependency build; affected type checks; Biome on 20 source files; `git diff --check`. Collaborative-browser checks covered niche placement, move commit, Escape cancellation, undo/redo, and Shift-tap cycling. Browser checking found and corrected thin-wall default depth and repeat-placement initialization ordering. | 2D placement and editing remain in step 6. Full acceptance, complex-scene benchmarks, and complete CI remain in step 10. |

| 5 recheck | Revalidated 3D placement and editing before starting floor-plan work. | Passed: 92 focused tests and filtered node/dependency build. | Full acceptance remains in item 10. |
| 6 | Added registered floor-plan footprints on the resolved physical face, including nested niches and live ancestor changes. Symbols and line styles distinguish a feature above, below, or intersecting the conventional 1.2 m plan cut. Registered 2D placement, separate width/depth grips, and the canonical move handle share 3D validation, snapping, preview ownership, and single-commit history. Horizontal edits retain bottom elevation; the shared inspector supplies height/bottom edits. Split-view driver handoff protects current previews, and cancellation hooks release transient geometry deferral. Host-sized niche defaults now fit short bumps. | Passed: 96 focused feature, placement, persistence, floor-plan, and dispatcher tests, including equivalent 2D/3D saved coordinates, undo/redo, anchored dimensions, cancellation, and split-view session handoff; filtered node/dependency build; 7 affected/dependency type-check tasks; Biome and `git diff --check`. Collaborative-browser checking confirmed 2D-only niche placement, width/depth preview guides, and selection. Final browser grip recheck could not finish because the collaborative preview began failing snapshots after reload; automated grip and scope tests passed. | Items 7–10. Full interactive split-view/grip acceptance, complex-scene benchmarks, and full CI remain in item 10. The plan cut currently uses a fixed 1.2 m convention. |
| 7 | Integrated feature slot overrides with nearest-host and wall-region finish fallback; wall body UV projection keeps feature faces and reveals at metre scale. Feature surfaces carry wall paint-region assignment, bump tops/niche shelves use the registered hosting protocol, and hosted children follow feature and wall transforms. Trim ranges stop at visible feature mouths; feature renderers now follow cutaway wall visibility. | Not run during this continuation. | Item 7 acceptance checks still need to run before checking the numbered item; full interactive acceptance, benchmarks, and CI remain in item 10. |
| 8 (in progress) | Added wall-feature remapping to straight wall split and merge plans, including face/u reflection when the source direction reverses. Exact endpoint reversal through `setWallGeometry` now uses the wall reversal mapping and remaps each direct feature. Wall geometry edits validate all hosted feature bounds, overlap, nesting, and niche backing. Existing relation-driven subtree cloning and cascade deletion keep feature descendants with their host; features remain outside room boundary topology while the modified wall body and feature top surfaces supply collision/support geometry. | Passed: focused wall topology and merge suites now assert feature ownership/station mapping on split and face/station mapping on a reversed merge. | Step 8 acceptance checks remain; full transformation, complex-scene, and undo verification is pending. |
| 9 (in progress) | Added `pascal_create_wall_feature` and `pascal_update_wall_feature` contracts and pure operations in the nodes plugin. Operations create/update host-child links and use the shared wall-feature placement validator. Added `@pascal-app/nodes/agent-tools` and `@pascal-app/nodes/agent-operations` exports. MCP hosts can register reviewed plugin operation packs through `pluginTools`; only tools with host-supplied annotations are offered. Updated the MCP README, `pascal://agent-guide`, and public `pascal-3d` skill. | Passed: the public nodes-package operation test creates and updates features, checks host hierarchy, and verifies invalid placement refusal; full MCP package tests pass in CI. | MCP registration needs an actual host configuration and real-client check. Generic deletion check, hosted-chat registration, export acceptance, and IFC mapping remain. |
| 10 (in progress) | Added public-contract tests for agent create/update operations and wall split/merge feature remapping. Fixed plan-view wall-feature movement to use the feature's resolved host level rather than stale viewer selection. Updated the legacy node-kind corpus and reference inventory for the new feature kind and its hosted-surface references. | Passed: 52 focused topology/merge/agent tests; 170 reference-inventory and host-child tests; 58 node host-audit tests; `bun run ci` (check, skills validation, type checks, all package tests, and builds). Build emitted the existing dynamic-filesystem tracing warning for the MCP artifact route. | Manual both-face/nesting/finish/paint/shelf/raised-floor/justification/split-view/reload/export acceptance and the complex-scene benchmark remain. Hosted-chat and IFC export work remain external integration dependencies; therefore step 10 and items 7–9 remain unchecked. |
