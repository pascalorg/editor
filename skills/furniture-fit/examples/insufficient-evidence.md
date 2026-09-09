# Synthetic example: insufficient dimensions

## User request

> Will this sectional from a listing photo fit through my entry and under the living-room soffit? The room looks about 12 feet wide.

## Correct response shape

**Verdict:** insufficient evidence.

The photo and approximate room width do not establish the sectional's width, height, depth, packaging or disassembly state, soffit clearance, or the route through the entry. A clear footprint check also would not prove delivery.

Request the first decisive input only: the sectional's exact width × height × depth, including the original unit and packaged-piece dimensions if it ships in sections. Those dimensions block every requested comparison. Ask for the soffit and route measurements only after the item dimensions are known and only if they remain necessary.

Stop there. Do not add conditional maximum-size, fit, height, route, or alternate-pose suggestions while that decisive input is missing.

Do not create a placeholder with guessed dimensions and report it as a verified fit.

```yaml
nextAction:
  kind: request_measurement
  task: Provide the sectional's exact width, height, and depth in the source unit, plus packaged-piece dimensions if it ships in sections.
  requiredInput: Exact sectional and packaged-piece dimensions only.
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
