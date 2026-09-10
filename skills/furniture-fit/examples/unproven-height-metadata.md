# Synthetic example: nominal height metadata is not a measurement

## Inputs

- Wardrobe: 1.00 m wide × 3.10 m high × 0.60 m deep
- Room footprint: measured and large enough for the tested pose
- Scene metadata: `level.height` and `zone.ceilingHeight` are both 2.70 m
- Modeled vertical evidence: no ceiling, soffit, sill, railing, or overhead obstacle nodes
- Provenance for the 2.70 m values: unknown
- Context: project `project_example`, revision `3`, graph hash `sha256:example-unproven-height`, level `level_ground`, zone `zone_bedroom`, candidate `wardrobe_candidate`

## Report excerpt

**Verdict:** footprint fits at the tested pose.

Height remains `insufficient evidence`.

| Check | Status | Evidence |
| --- | --- | --- |
| Room footprint | passed | The tested plan footprint lies inside the measured room boundary. |
| Height/overhead | insufficient evidence | The 2.70 m values are nominal metadata without measurement provenance, and no ceiling or obstacle geometry establishes the actual clearance above this footprint. |
| Door access keep-out | not checked | No modeled doors include the prospective candidate. |
| Delivery route | not checked | Route, opening, packaging, and turning measurements were not supplied. |

The 3.10 m wardrobe may conflict with the nominal 2.70 m values, so measure the clear floor-to-obstacle height at the intended position. Do not report height as passed or failed until that user-supplied measurement, or modeled geometry with recorded measurement provenance covering the exact overhead path, is available.

```yaml
nextAction:
  kind: request_measurement
  task: Measure the clear floor-to-obstacle height over the wardrobe's exact footprint.
  requiredInput: One measured clear height with its provenance and spatial coverage.
  context:
    projectId: project_example
    revision: 3
    graphHash: sha256:example-unproven-height
    levelId: level_ground
    zoneId: zone_bedroom
    itemId: wardrobe_candidate
  authority: Read-only; no account or workspace changes, publication, save, or project mutation authorized.
  cost: No rendering, generation, paid operation, or additional spending authorized.
```
