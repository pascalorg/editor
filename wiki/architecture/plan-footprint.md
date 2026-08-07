# Plan footprint math (shared core)

*Pure XZ footprint helpers for floor-placed items — one source for MCP layout clearance, spatial-grid, and alignment anchors.*

Applies to: `packages/core/src/lib/plan-footprint.ts`, re-exported from `@pascal-app/core/spatial-grid` and `@pascal-app/core/plan-footprint`.

## Why

After MCP layout clearance (#569), Aymericr noted footprint / AABB overlap should not be a third parallel implementation next to spatial-grid. This module **extracts** the spatial-grid corner + AABB formulas into a pure Node-safe surface.

## API (pure)

| Helper | Role |
|---|---|
| `planFootprintCorners` | 4 XZ corners (optional inset) |
| `planFootprintAABB` | Conservative rotation-aware AABB |
| `aabbsOverlapPlan(a, b, gap?)` | Expand-then-intersect; `gap` = min free space |
| `planFootprintAABBForItem` | Scaled dims; **null** for wall/ceiling hosts |

## Gap call-site meanings

| Call site | Typical `gap` | Meaning |
|---|---|---|
| Furnish / packing | ~0.08 m | Breathing room between items |
| `check_collisions` / hard verify | `0` | True interpenetration only |

Do not share one default blindly across both questions.

## Non-goals (this foundation)

- Door keep-outs, level ancestry, planned entrances (layout policy)
- Full MCP/editor rewire of furnish / verify
- Polygon-exact collision as the only API (`itemOverlapsPolygon` remains)

## Imports

```ts
// Pure (preferred for MCP / Node)
import { planFootprintAABB, aabbsOverlapPlan } from '@pascal-app/core/plan-footprint'

// Also re-exported next to spatial-grid manager
import { planFootprintAABB } from '@pascal-app/core/spatial-grid'
```
