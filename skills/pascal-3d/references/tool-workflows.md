# Pascal MCP tool workflows

Source reviewed on 2026-09-08 against repository code whose package version field is `@pascal-app/mcp` 1.0.0-beta.6. This is not a claim that the package was published or natively host-tested. Installed and hosted releases may expose a different schema, so inspect the advertised tools first.

Inspect the server's advertised tools because hosted and local releases may differ. Never call a guessed tool.

## Inspect an existing project

1. `list_scenes`
2. `load_scene`
3. `get_project_status`
4. `list_levels`
5. `get_level_summary`, `get_walls`, `get_zones`, `find_nodes`, or `get_node`
6. `validate_scene`
7. `verify_scene`

`get_scene` returns the full graph and is useful when a compact summary omits a field needed for a calculation, such as an item's scale.

## Open a room scan (hosted only)

These three tools exist only on the hosted Pascal server. A local CLI connection does not advertise them, so inspect the advertised tools before assuming this path is available.

1. `list_captures`, optionally narrowed by `projectId`, `status`, or `limit`.
2. `get_capture` with the `captureId`, adding `includeScanMetrics` when the answer needs scan quality numbers.
3. `open_capture_as_project` once the capture reports `processed`, to bind the owning project's persisted draft into the session.
4. Continue with the project workflows above.

All three require edit access on the scan's own project; view access, including a public project owned by someone else, is refused as not found. The first two are read-only. `open_capture_as_project` creates nothing and is idempotent, but it carries the same non-read-only annotation as `get_project_status` because it changes the project the session is bound to.

## Create an editable project

1. `create_project`
2. `create_house_from_brief` for a supported quick start, or semantic construction tools for precise control
3. Add openings and furniture with semantic tools
4. `validate_scene`
5. `verify_scene`
6. `save_scene` with `saveMode: "draft"`
7. `get_project_status`

Use `checkpoint` only at a meaningful milestone. A browser-visible draft and a durable checkpoint are distinct states.

## Make a bounded edit

1. Read the target and its surrounding level.
2. Record the pre-edit project version or graph hash when available.
3. Apply one semantic edit. Use `apply_patch` only when necessary; its batch is atomic and forms one undo step.
4. Re-read the target and validate the scene.
5. Save and report the changed IDs.

If a live-sync version conflict occurs, call `load_scene`, inspect the newer graph, and rebase the requested edit. Do not retry an old whole-scene write blindly.

## Build a scripted object (hosted)

`add_object`, and `add_window`, `add_door` or `add_column` with `code` or new params on a scripted node, compile in the user's open Pascal editor tab of the project. When none is open the call answers `editor_tab_required` with `editorUrl` and `mutationApplied: false`; nothing changed. Show the user the link, wait until they confirm the tab is open, and repeat the same call. `editor_tab_timeout` means the tab stopped answering; ask whether it is still open, then retry. `script_failed` is the module's own error: fix the code.

## Look at the result

`view_scene` returns a picture of the building from the viewpoint you pick, to compare with a reference before fixing. It is read-only and creates nothing. On the hosted server the user's open editor tab renders it: `editor_tab_required` comes with `editorUrl` (show it, wait until the tab is open, repeat the call) and `editor_tab_hidden` means the tab is in the background (ask the user to bring it forward, repeat). A server with no renderer answers `view_unavailable`. A picture is not a measure.

## Start over

`clear_scene` empties the project on purpose, back to a site, a building and one level, when the person asked to start over; put their words in `reason`. It is the only way to empty a project: a write that would leave it empty is refused with `scene_wipe_blocked`, nothing changes in the project or the session, and the next write builds on the project as stored.

## Read-only spatial answer

Do not mutate just to make a report unless the user authorizes a temporary or saved layout change. Use scene queries, `measure`, `check_collisions`, and `verify_scene`. Name the exact check and units. A plan-footprint check is not a detailed 3D, structural, regulatory, or delivery-path analysis.

## Outputs and limitations

- `export_json` returns the editable scene graph.
- `export_glb` in the open-source headless server currently reports `status: "not_implemented"`; protocol success is not artifact success.
- `photo_to_scene` needs host sampling. Without it, expect `sampling_unavailable`.
- `place_items` uses catalog dimensions and refuses an ID the library lacks (`asset_not_found`) rather than placing a placeholder. It places items on a level's floor, or on the host each names (`targetNodeId`): a wall (`y` is the height of the item's bottom; it hangs on the side of the wall the point is on), a ceiling, or an item standing on the floor (on an object built with `add_object`, the real surface under the point; the result names it in `restingOn`). Positions are level coordinates. A floor item standing in a door's clearance is refused with `blocks_door`, naming the door and a spot that clears every door, and one its room cannot hold in any turn with `too_large_for_room`, with both sizes: move or turn it, or pick a smaller one with `search_assets`. Items overlapping each other (a chair under its table) are not refused.
- `check_collisions` checks rotation-aware scaled item footprints using plan AABBs. Pass `minimumClearance` explicitly: zero reports overlap; a positive measurement also reports pairs closer than that gap. Inspect `status`, `checkedItems`, `skippedItems`, and `unsupportedChecks` before drawing a conclusion.
- `verify_scene` adds practical issues, including item separation and rectangular door-access keep-outs. It does not model a door-leaf swing arc or a delivery route.
- No tool starts a room scan or clones a scan into a new project. Scans are created only by the Pascal iOS app, and `open_capture_as_project` opens the scan's existing owning project.

When a requested deliverable is unsupported, return `partial` or `failed` with the tool status and the next supported action. Do not substitute an invented file, URL, or capability.
