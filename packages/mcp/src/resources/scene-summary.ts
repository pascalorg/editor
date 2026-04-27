import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeType } from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'

type Poly2D = ReadonlyArray<readonly [number, number]>

/** Shoelace polygon area (absolute, square meters). */
function polygonArea(poly: Poly2D): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (!a || !b) continue
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

type BBox = {
  min: [number, number, number]
  max: [number, number, number]
  empty: boolean
}

function emptyBBox(): BBox {
  return {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    empty: true,
  }
}

function expandBBox(bbox: BBox, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
  bbox.empty = false
  if (x < bbox.min[0]) bbox.min[0] = x
  if (y < bbox.min[1]) bbox.min[1] = y
  if (z < bbox.min[2]) bbox.min[2] = z
  if (x > bbox.max[0]) bbox.max[0] = x
  if (y > bbox.max[1]) bbox.max[1] = y
  if (z > bbox.max[2]) bbox.max[2] = z
}

/** Fold a node's world-relevant points into the running bbox. */
function foldNodeIntoBBox(node: AnyNode, bbox: BBox): void {
  // Walls / fences: 2D start/end. Treat missing y as 0.
  if (node.type === 'wall' || node.type === 'fence') {
    const anyNode = node as { start?: [number, number]; end?: [number, number] }
    if (anyNode.start) expandBBox(bbox, anyNode.start[0], 0, anyNode.start[1])
    if (anyNode.end) expandBBox(bbox, anyNode.end[0], 0, anyNode.end[1])
    return
  }
  // Zone / slab / ceiling: polygon + optional holes. Treat ground plane y=0.
  if (node.type === 'zone' || node.type === 'slab' || node.type === 'ceiling') {
    const poly = (node as { polygon?: Array<[number, number]> }).polygon
    if (Array.isArray(poly)) {
      for (const p of poly) {
        if (Array.isArray(p) && p.length >= 2) expandBBox(bbox, p[0], 0, p[1])
      }
    }
    return
  }
  // Positioned nodes (building/item/roof/stair/scan/guide/...):
  const pos = (node as { position?: [number, number, number] }).position
  if (Array.isArray(pos) && pos.length >= 3) {
    expandBBox(bbox, pos[0], pos[1], pos[2])
  }
}

function countByType(nodes: AnyNode[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of nodes) {
    out[n.type] = (out[n.type] ?? 0) + 1
  }
  return out
}

/** Build the markdown summary. Pure over the SceneGraph snapshot. */
export function buildSceneSummaryMarkdown(
  snapshot: ReturnType<SceneOperations['exportJSON']>,
): string {
  const { nodes, rootNodeIds } = snapshot
  const allNodes = Object.values(nodes) as AnyNode[]

  const sites = allNodes.filter((n) => n.type === 'site')
  const buildings = allNodes.filter((n) => n.type === 'building')
  const levels = allNodes.filter((n) => n.type === 'level')

  const bbox = emptyBBox()
  for (const n of allNodes) foldNodeIntoBBox(n, bbox)

  const lines: string[] = []
  lines.push('# Scene summary')
  lines.push('')
  lines.push(`- Sites: ${sites.length}  Buildings: ${buildings.length}  Levels: ${levels.length}`)
  lines.push(`- Root nodes: ${rootNodeIds.length}`)
  lines.push(`- Total nodes: ${allNodes.length}`)
  lines.push('')

  // Hierarchy table
  lines.push('## Hierarchy')
  lines.push('')
  lines.push('| Site | Building | Level |')
  lines.push('| --- | --- | --- |')
  if (sites.length === 0 && buildings.length === 0 && levels.length === 0) {
    lines.push('| _(empty scene)_ | | |')
  } else {
    for (const site of sites) {
      const sName = (site as { name?: string }).name ?? site.id
      const siteBuildings = allNodes.filter((n) => n.type === 'building' && n.parentId === site.id)
      if (siteBuildings.length === 0) {
        lines.push(`| ${sName} | _(none)_ | |`)
        continue
      }
      for (const b of siteBuildings) {
        const bName = (b as { name?: string }).name ?? b.id
        const bLevels = allNodes.filter((n) => n.type === 'level' && n.parentId === b.id)
        if (bLevels.length === 0) {
          lines.push(`| ${sName} | ${bName} | _(none)_ |`)
          continue
        }
        for (const l of bLevels) {
          const lName = (l as { name?: string }).name ?? l.id
          lines.push(`| ${sName} | ${bName} | ${lName} |`)
        }
      }
    }
  }
  lines.push('')

  // Per-level detail
  if (levels.length > 0) {
    lines.push('## Per level')
    lines.push('')
    for (const level of levels) {
      const lName = (level as { name?: string }).name ?? level.id
      // Nodes whose ancestry includes this level.
      const levelNodes = allNodes.filter(
        (n) => n.id !== level.id && walkToLevel(n, nodes as Record<string, AnyNode>) === level.id,
      )
      const counts = countByType(levelNodes)
      const countKeys = Object.keys(counts).sort() as AnyNodeType[]

      // Estimated floor area = sum of zone polygon areas on this level.
      const zones = levelNodes.filter((n) => n.type === 'zone') as Array<
        AnyNode & { polygon: Array<[number, number]> }
      >
      let floorAreaSq = 0
      for (const z of zones) {
        floorAreaSq += polygonArea(z.polygon)
      }

      lines.push(`### ${lName}`)
      lines.push('')
      if (countKeys.length === 0) {
        lines.push('- _(no descendants)_')
      } else {
        const parts = countKeys.map((k) => `${k}=${counts[k]}`)
        lines.push(`- Node counts: ${parts.join(', ')}`)
      }
      lines.push(`- Estimated floor area (zones): ${floorAreaSq.toFixed(2)} m^2`)
      lines.push('')
    }
  }

  // BBox
  lines.push('## Scene bbox (meters)')
  lines.push('')
  if (bbox.empty) {
    lines.push('- _(no positioned nodes)_')
  } else {
    lines.push(`- min: [${bbox.min.map((v) => v.toFixed(3)).join(', ')}]`)
    lines.push(`- max: [${bbox.max.map((v) => v.toFixed(3)).join(', ')}]`)
  }

  return lines.join('\n')
}

/** Walk up parentId until we find a level; return its id or null. */
function walkToLevel(node: AnyNode, nodes: Record<string, AnyNode>): string | null {
  const seen = new Set<string>()
  let current: AnyNode | undefined = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.type === 'level') return current.id
    const pid: string | null = current.parentId
    if (!pid) return null
    current = nodes[pid]
  }
  return null
}

/**
 * `pascal://scene/current/summary` — human-readable scene overview.
 * MIME `text/markdown`.
 */
export function registerSceneSummary(server: McpServer, bridge: SceneOperations): void {
  server.registerResource(
    'scene-summary',
    'pascal://scene/current/summary',
    {
      title: 'Scene summary (markdown)',
      description:
        'Markdown overview: sites/buildings/levels, per-level node counts, zone floor areas, scene bbox.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: buildSceneSummaryMarkdown(bridge.exportJSON()),
        },
      ],
    }),
  )
}
