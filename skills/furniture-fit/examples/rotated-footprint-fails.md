# Synthetic example: rotation changes the answer

## Inputs

- Rectangular alcove: 2.30 m wide × 1.15 m deep
- Cabinet: 2.00 m wide × 2.20 m high × 0.60 m deep
- Pose A: 0° Y rotation
- Pose B: 90° Y rotation
- Context: project `project_example`, revision `4`, graph hash `sha256:example-rotated-footprint`, level `level_ground`, zone `zone_alcove`, candidate `cabinet_candidate`

## Report excerpt

**Verdict:** the footprint fits at 0° and does not fit at 90°.

At 0°, the plan footprint is 2.00 m × 0.60 m, leaving 0.30 m across the width and 0.55 m across the depth before any requested clearance.

At 90°, Pascal's rotation convention swaps the effective plan dimensions to 0.60 m × 2.00 m. The 2.00 m depth exceeds the alcove's 1.15 m depth by 0.85 m, so that pose fails even though the unrotated pose fits.

Height remains `not checked` until the alcove's clear vertical height is measured. Delivery remains `not checked` until the route and packaging dimensions are known.

```yaml
nextAction:
  kind: check_alternate_pose
  task: Re-check the cabinet centered in the same alcove at 0° Y rotation with the user's required clearance applied.
  requiredInput: The required clearance, if it has not already been supplied.
  context:
    projectId: project_example
    revision: 4
    graphHash: sha256:example-rotated-footprint
    levelId: level_ground
    zoneId: zone_alcove
    itemId: cabinet_candidate
  authority: Read-only; the 0° pose is proposed for a fresh check and is not authorization to place or save it.
  cost: No rendering, generation, paid job, or additional spend authorized.
```

Do not call the alternate a pass until the fresh containment, collision, requested-clearance, and applicable door checks succeed against the then-current graph.
