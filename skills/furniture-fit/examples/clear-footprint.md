# Synthetic example: clear footprint, bounded conclusion

## Inputs

- Rectangular room zone: 4.20 m × 3.60 m
- Sofa: 2.10 m wide × 0.82 m high × 0.95 m deep
- Pose: centered on a long wall, 0° Y rotation
- Requested walking clearance: 0.60 m in front
- Pascal results: `check_collisions` with `minimumClearance: 0.60` returned `status: "checked"` and no overlap/clearance violations; `verify_scene` returned no item-spacing or door-access issue for the sofa

## Report excerpt

**Verdict:** footprint fits at the tested pose.

| Check | Status | Evidence |
| --- | --- | --- |
| Room footprint | passed | 2.10 m × 0.95 m footprint lies inside the measured 4.20 m × 3.60 m rectangular bound. |
| Requested front clearance | passed | The tested pose leaves 0.72 m to the opposing boundary. |
| Item collision | passed | `check_collisions` reported no overlap for the sofa. |
| Requested item clearance | passed | `check_collisions` reported no pair within the requested 0.60 m gap. |
| Default item spacing | passed | `verify_scene` reported no item-spacing issue for the sofa. |
| Door access keep-out | passed | `verify_scene` reported no modeled door keep-out issue for the sofa. |
| Height/overhead | not checked | No soffit, sill, or overhead-clearance measurement was supplied. |
| Door swing | not checked | Pascal's door check is a rectangular access keep-out, not a leaf-swing arc. |
| Delivery route | not checked | Entry, hall, corner, packaging, and tilt dimensions were not supplied. |
| Detailed mesh contact | not checked | Current collision evidence uses plan AABBs. |

This supports the layout footprint at the tested pose. It does not establish that the sofa can be delivered or assembled in the room.
