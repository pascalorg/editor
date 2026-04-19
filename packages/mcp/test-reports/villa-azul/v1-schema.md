# Phase 9 Verifier V1 — Villa Azul Zod Schema Validation

- Scene: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`
- Scene id: `a6e7919eacbe`
- Scene name: `Villa Azul`
- Declared nodeCount: 56
- Dict size: 56
- AnyNode.safeParse: **56/56 pass, 0 fail**
- parentId integrity: **PASS** (0 issues)
- children[] id integrity (non-site): **PASS** (0 issues)
- SiteNode.children embedded objects (CROSS_CUTTING §2): **PASS** (0 issues)
- Sanity parse (wall/door/window/zone/fence/slab): **PASS**
- **Overall: PASS**

## Per-type counts

| type | total | pass | fail |
| --- | --- | --- | --- |
| building | 1 | 1 | 0 |
| door | 10 | 10 | 0 |
| fence | 5 | 5 | 0 |
| level | 1 | 1 | 0 |
| site | 1 | 1 | 0 |
| slab | 1 | 1 | 0 |
| wall | 12 | 12 | 0 |
| window | 12 | 12 | 0 |
| zone | 13 | 13 | 0 |
| **TOTAL** | **56** | **56** | **0** |

## AnyNode.safeParse failures

_No validation failures._

## parentId reference issues

_None._

## children[] reference issues (non-site nodes)

_None._

## SiteNode.children embedded-object check (CROSS_CUTTING §2)

_None._

Per CROSS_CUTTING §2, `SiteNode.children` is declared as
`z.array(z.discriminatedUnion('type', [BuildingNode, ItemNode]))` and must hold
full embedded building/item objects, not string ids. All other containers use
`string[]`.

## Sanity-parse results (AnyNode.parse, throwing)

| kind | id | status | detail |
| --- | --- | --- | --- |
| wall | `wall_qgrnmxmo0go9yy3q` | PASS | parsed without throw |
| door | `door_333ygsrz65ijnrqv` | PASS | parsed without throw |
| window | `window_8nqg3fvdnb13c0sx` | PASS | parsed without throw |
| zone | `zone_iqi6kkt195pgsdcb` | PASS | parsed without throw |
| fence | `fence_0t2fy6fnsnm5lycx` | PASS | parsed without throw |
| slab | `slab_azul_pool` | PASS | parsed without throw |

## Source

- Script: `packages/mcp/test-reports/villa-azul/v1-schema.ts`
- Input: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`
- Schema: `@pascal-app/core/schema` (AnyNode discriminated union)
