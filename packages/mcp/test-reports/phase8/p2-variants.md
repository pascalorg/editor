# P2 Phase 8 — `generate_variants` report

Generated: 2026-04-19T18:19:47.106Z
Data dir: `/tmp/pascal-phase8-p2`
Transport: stdio (`bun packages/mcp/dist/bin/pascal-mcp.js --stdio`)
Total run time: 32 ms

## Setup

- template: `two-bedroom`
- base nodeCount: **25**
- base saved: **true** (id=`4a051220b1e6`)

## Per-mutation results

| # | Mutation | Status | nodeCounts | Summary |
|---|----------|--------|------------|---------|
| 1 | `wall-thickness` | PASS | [25, 25] | 2 variants, nodeCounts=[25,25], min=25 |
| 2 | `wall-height` | PASS | [25, 25] | 2 variants, nodeCounts=[25,25], min=25 |
| 3 | `zone-labels` | PASS | [25, 25] | 2 variants, nodeCounts=[25,25], min=25 |
| 4 | `room-proportions` | PASS | [25, 25] | 2 variants, nodeCounts=[25,25], min=25 |
| 5 | `open-plan` | FAIL | [23, 24] | variant nodeCount 23 < min 24 (base=25) |
| 6 | `door-positions` | PASS | [25, 25] | 2 variants, nodeCounts=[25,25], min=25 |
| 7 | `fence-style` | PASS | [25, 25] | 2 variants, nodeCounts=[25,25], min=25 |

### Variant descriptions

- **wall-thickness**: "wall thickness 0.2m", "wall thickness 0.25m"
- **wall-height**: "wall height 2.7m", "wall height 3m"
- **zone-labels**: "zones [Living / Kitchen, Bedroom 2, Bedroom 1, Bath]", "zones [Bath, Bedroom 1, Living / Kitchen, Bedroom 2]"
- **room-proportions**: "room proportions nudged", "room proportions nudged"
- **open-plan**: "open-plan", "open-plan"
- **door-positions**: "doors repositioned", "doors repositioned"
- **fence-style**: "no-op", "no-op"

## Determinism

- Status: **PASS**
- Detail: 3 variant graphs identical (after ID normalization) across calls (wall-thickness, seed=1337)

## Save path

- Status: **PASS**
- Detail: variants saved=3, list_scenes returned 4 (expected 4)
- Variants saved in step: 3
- `list_scenes` after save: 4

## Combined mutation validation

- Status: **PASS**
- Detail: combined variant sceneId=18e32febadc7, valid=true, errors=0, description="wall thickness 0.1m, wall height 2.7m, zones [Bedroom 2, Living / Kitchen, Bath, Bedroom 1], room proportions nudged, open-plan, doors repositioned"
- valid: true, errorCount: 0

## Error path

- Status: **PASS**
- Detail: isError with text: MCP error -32602: scene_not_found

## Totals

- Total variants saved across the run: **4**

## Overall summary

**Summary (≤150 words):**

Per-mutation: 6/7 PASS. Determinism: PASS (identical after id normalization; `forkSceneGraph` regenerates ids so raw JSON can't match). Save path: PASS — 3 variants saved, `list_scenes` returned 4 (expected 4). Combined mutation: PASS (variant validates). Error path: PASS. Total variants saved: 4. Total variants exercised across the run: ~21.

Note: the only failing mutation is `open-plan` — nodeCounts [23, 24] with base=25. The spec rule `>= base - 1` assumes open-plan drops only the wall node, but `applyOpenPlan` also drops any openings (doors/windows) attached to the removed wall — so a variant may drop 2+ nodes. The mutation itself is working correctly; the spec's lower-bound rule is tighter than the implementation.