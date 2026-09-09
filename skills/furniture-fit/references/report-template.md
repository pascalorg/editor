# Furniture fit assessment

**Verdict:** footprint fits | footprint does not fit | insufficient evidence

**Scope:** read-only assessment | temporary test reverted | saved placement

## Evidence

- Project / scene:
- Persisted revision when separately returned:
- Assessment graph hash (`assessmentGraphHash`, not a persisted revision):
- Room or zone ID:
- Room boundary and source:
- Item ID or supplied product:
- Candidate evidence: existing node / read-only candidate ID / preliminary calculation
- Item dimensions: `[width, height, depth]` meters; original values:
- Tested pose: position `[x, y, z]`, Y rotation:
- User-requested clearance:
- Input cross-check: supplied dimensions, pose, clearance, and source IDs match the tool call and report:
- Collision result status: checked / partial / insufficient_evidence / unavailable on connected release
- Checked item IDs and skipped item reasons:

## Checks

| Check | Status | Evidence |
| --- | --- | --- |
| Room footprint | passed / failed / not checked / insufficient evidence | Boundary, effective rotated footprint, and method |
| Item collision | passed / failed / not checked / insufficient evidence | `check_collisions` overlap results and IDs |
| Requested item clearance | passed / failed / not checked / insufficient evidence | `check_collisions` result at the explicit minimum clearance |
| Default item spacing | passed / failed / not checked / insufficient evidence | Evidence that includes this item; `verify_scene` excludes read-only candidates |
| Door access keep-out | passed / failed / not checked / insufficient evidence | Modeled door and item IDs; absent doors or an unchecked candidate mean not checked |
| Height/overhead | passed / failed only by a labeled manual comparison using measured evidence; otherwise not checked / insufficient evidence | User-supplied clear height or modeled ceiling/obstacle geometry with recorded measurement provenance and spatial coverage of the exact tested footprint; nominal metadata can only flag a possible mismatch |
| Door swing | not checked / insufficient evidence | Rectangular keep-out is not a swing arc |
| Delivery route | not checked / insufficient evidence | Needed route and packaging measurements |
| Detailed mesh contact | not checked | Current check uses plan AABBs |

## Issues and alternatives

- Blocking issues:
- Verified alternatives:

## nextAction

```yaml
nextAction:
  kind: request_measurement | check_alternate_pose | request_alternate_item_or_target | complete_unresolved_check | check_related_item_or_pose
  task: One self-contained measurement request, bounded user choice or input request, or read-only check
  requiredInput: Only the values, capability, or choice needed for that task
  context:
    projectId: Exact ID or null
    revision: Exact persisted revision or null
    graphHash: Exact assessed graph hash or null
    levelId: Exact ID or null
    zoneId: Exact ID or null
    itemId: Exact existing or candidate ID or null
  authority: Read-only; no account or workspace changes, publication, save, or project mutation authorized.
  cost: No rendering, generation, paid operation, or additional spending authorized.
```

Choose the `kind` from the unresolved blocker in the requested decision, not only from the footprint verdict:

- a missing or unproven decisive measurement → `request_measurement`, even when the footprint passes;
- a failed requested footprint with one geometry-supported untested pose → `check_alternate_pose`, labeled proposed and unverified and requiring a fresh check;
- all tested footprint poses, or another requested physical constraint, conclusively fail with no evidence-backed alternative → `request_alternate_item_or_target`, asking the user for one exact alternate rather than inventing it;
- a requested constraint has the needed inputs but the available read-only path did not include it → `complete_unresolved_check`, naming the missing capability and retaining the current limitation;
- no unresolved requested blocker and the footprint fits → `check_related_item_or_pose` for one optional related check in the same measured context.

The next action is optional. Do not execute it, create or switch accounts/workspaces, broaden project scope, save, publish, render, generate, or spend without the user's separate authorization. Re-read project status before an accepted follow-up because the recorded revision and graph hash may no longer be current.

## Handoff

- Saved: yes / no
- Changed node IDs:
- Editor URL returned by Pascal:

Use `footprint` in the verdict sentence. Never turn untested rows into an unqualified purchase, delivery, safety, or code-compliance assurance.

An empty issue list with missing geometry is not a pass. State `not checked` or `insufficient evidence` and name the missing geometry. A read-only candidate is absent from `verify_scene`; do not borrow that tool's clean result for the candidate.

Do not turn nominal `level.height`, `zone.ceilingHeight`, wall height, catalog labels, template defaults, or imported metadata into a categorical height pass or failure. A ceiling-shaped node is not sufficient by itself. Without a user-supplied clear-height measurement or modeled geometry whose recorded measurement provenance and spatial coverage establish the exact overhead path, report the possible mismatch and request the smallest decisive measurement. If that evidence exists, identify it and describe the result as a manual height-versus-clear-height comparison rather than a Pascal footprint-tool result.
