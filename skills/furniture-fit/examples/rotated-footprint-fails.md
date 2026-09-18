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
  kind: request_measurement
  task: Measure the clear floor-to-obstacle height over the cabinet's 0° footprint before making an order decision.
  requiredInput: One measured clear height with its provenance and spatial coverage.
  context:
    projectId: project_example
    revision: 4
    graphHash: sha256:example-rotated-footprint
    levelId: level_ground
    zoneId: zone_alcove
    itemId: cabinet_candidate
  authority: Read-only; no account or workspace changes, publication, save, or project mutation authorized.
  cost: No rendering, generation, paid operation, or additional spending authorized.
```

The failed 90° pose is not the next blocker because the tested 0° footprint already fits. The missing clear-height evidence blocks the requested order decision.
