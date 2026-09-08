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

## Read-only spatial answer

Do not mutate just to make a report unless the user authorizes a temporary or saved layout change. Use scene queries, `measure`, `check_collisions`, and `verify_scene`. Name the exact check and units. A plan-footprint check is not a detailed 3D, structural, regulatory, or delivery-path analysis.

## Outputs and limitations

- `export_json` returns the editable scene graph.
- `export_glb` in the open-source headless server currently reports `status: "not_implemented"`; protocol success is not artifact success.
- `photo_to_scene` needs host sampling. Without it, expect `sampling_unavailable`.
- `place_item` uses catalog dimensions. If a catalog item is unavailable, its placeholder dimensions are not evidence for a real product.
- `check_collisions` checks rotation-aware scaled item footprints using plan AABBs. Pass `minimumClearance` explicitly: zero reports overlap; a positive measurement also reports pairs closer than that gap. Inspect `status`, `checkedItems`, `skippedItems`, and `unsupportedChecks` before drawing a conclusion.
- `verify_scene` adds practical issues, including item separation and rectangular door-access keep-outs. It does not model a door-leaf swing arc or a delivery route.

When a requested deliverable is unsupported, return `partial` or `failed` with the tool status and the next supported action. Do not substitute an invented file, URL, or capability.
