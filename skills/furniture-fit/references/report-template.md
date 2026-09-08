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
| Height/overhead | not checked / insufficient evidence | Needed vertical measurements or separate evidence |
| Door swing | not checked / insufficient evidence | Rectangular keep-out is not a swing arc |
| Delivery route | not checked / insufficient evidence | Needed route and packaging measurements |
| Detailed mesh contact | not checked | Current check uses plan AABBs |

## Issues and alternatives

- Blocking issues:
- Verified alternatives:
- Smallest missing measurement or next supported action:

## Handoff

- Saved: yes / no
- Changed node IDs:
- Editor URL returned by Pascal:

Use `footprint` in the verdict sentence. Never turn untested rows into an unqualified purchase, delivery, safety, or code-compliance assurance.

An empty issue list with missing geometry is not a pass. State `not checked` or `insufficient evidence` and name the missing geometry. A read-only candidate is absent from `verify_scene`; do not borrow that tool's clean result for the candidate.
