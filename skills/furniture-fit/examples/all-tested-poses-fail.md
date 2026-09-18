# Synthetic example: every tested pose fails

## Inputs

- Rectangular alcove: 1.50 m wide × 1.10 m deep
- Cabinet: 1.80 m wide × 1.20 m deep
- Tested poses: centered at 0° and 90° Y rotation
- Known alternatives: none; no offset, other room, or smaller item was supplied or established by measured evidence
- Context: project `project_example`, revision `5`, graph hash `sha256:example-all-poses-fail`, level `level_ground`, zone `zone_alcove`, candidate `cabinet_candidate`

## Report excerpt

**Verdict:** the footprint does not fit at either tested pose.

At 0°, the 1.80 m width exceeds the alcove's 1.50 m width by 0.30 m. At 90°, the effective 1.80 m depth exceeds the alcove's 1.10 m depth by 0.70 m. The measured evidence supports no untested pose, so the report does not fabricate a position or rotation.

```yaml
nextAction:
  kind: request_alternate_item_or_target
  task: Provide one exact alternate cabinet, target room or zone, or pose for a fresh read-only assessment.
  requiredInput: One alternate with exact dimensions and target context.
  context:
    projectId: project_example
    revision: 5
    graphHash: sha256:example-all-poses-fail
    levelId: level_ground
    zoneId: zone_alcove
    itemId: cabinet_candidate
  authority: Read-only; no account or workspace changes, publication, save, or project mutation authorized.
  cost: No rendering, generation, paid operation, or additional spending authorized.
```
