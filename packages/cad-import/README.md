# @pascal-app/cad-import

DXF → Pascal CAD underlay geometry. Pure logic — no DOM, no React, no
dependencies.

The editor imports a CAD drawing as a **locked reference underlay**, not as a
model: the user draws walls on top of it and snaps to its geometry. So this
package's only job is to reduce a drawing to line segments grouped by layer.
Arcs, circles, polyline bulges and block references are all flattened at parse
time — nothing downstream needs the curve back.

```ts
import { parseDxf, toUnderlayBuffer } from '@pascal-app/cad-import'

const drawing = parseDxf(await file.text())
const asset = toUnderlayBuffer(drawing) // → saveAsset()
```

## What it reads

| | |
|---|---|
| Geometry | `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` (incl. bulges), `POLYLINE`/`VERTEX`, `INSERT` |
| Tables | `LAYER` — name, colour index, off/frozen state |
| Header | `$INSUNITS` → metres per drawing unit |

Anything else is counted in `stats.skippedTypes` so the import UI can tell the
user what was dropped rather than silently losing part of their drawing.
`SPLINE` and `HATCH` are the notable absences.

Binary DXF throws with an actionable message. DWG is not handled here — it is
converted to DXF upstream (see `PLAN.md`, Faz 5).

## Notes on the design

**No parser dependency.** Benchmarked against the two maintained MIT options on
a 13 MB / 200k-entity drawing: `dxf@5.3.1` took 32 s and 645 MB, `dxf-parser`
~170 ms to build an object tree that still needed flattening on top. The
group-code streamer here does the whole job — parse, flatten, emit, bounds — in
about the same time as `dxf-parser` spends on its half.

**Coordinates stay in drawing units.** `toUnderlayBuffer` recentres on the
drawing's own origin (which is what makes `Float32Array` storage safe for
survey-referenced files) but does not convert to metres. Unit conversion is the
node's `scale`, so recalibrating is a property change rather than a rewrite of
a multi-megabyte asset.

**Curve tolerance derives from `$INSUNITS`.** An absolute sagitta would
tessellate the same building differently depending on whether the file was
drawn in millimetres or metres — in the metre case collapsing every circle to a
single chord. Unitless drawings fall back to a radius-relative budget.

## Tests

```sh
bun test tests
```

Fixtures are hand-written DXF fragments (`tests/fixtures.ts`) rather than
generated ones: a fixture built from the parser's own assumptions would prove
nothing.
