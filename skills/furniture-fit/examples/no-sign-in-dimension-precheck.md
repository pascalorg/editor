# Synthetic example: no-sign-in dimension pre-check

## Inputs

- Rectangular room: 400 cm wide × 350 cm deep
- Rectangular sofa footprint: 210 cm wide × 95 cm deep
- Uniform requested clearance: 20 cm on every side
- Exact source unit: centimeters
- The user explicitly asked for a Pascal link using these measurements
- No project, person, address, workspace, or private scene value is required for the pre-check

## Report excerpt

**Open dimension-only footprint pre-check:** https://editor.pascal.app/tools/furniture-fit?entry=agent_report&roomWidth=400&roomDepth=350&itemWidth=210&itemDepth=95&clearance=20&unit=cm&shared=1

This no-sign-in link sends the visible measurements to `editor.pascal.app` and may retain them in browser history and service request logs. It recomputes only the stated empty rectangular room and item footprints at 0° and 90° with 20 cm on every side. It does not carry or prove the report's project, position, collisions, existing-object spacing, doors, height, delivery route, detailed mesh, or scene-backed verdict.

Do not add project IDs, revisions, graph hashes, node IDs, addresses, people, accounts, workspaces, credentials, signed URLs, flow IDs, or scene labels to the query string.

```yaml
nextAction:
  kind: check_related_item_or_pose
  task: Check one other exact rectangular item footprint in the same measured room.
  requiredInput: One exact item width and depth in centimeters.
  context:
    projectId: null
    revision: null
    graphHash: null
    levelId: null
    zoneId: null
    itemId: null
  authority: Read-only; no account or workspace changes, publication, save, or project mutation authorized.
  cost: No rendering, generation, paid operation, or additional spending authorized.
```
