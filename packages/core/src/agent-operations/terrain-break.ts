import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { addTerrainBreakTool } from '../agent-tools/terrain'
import { pointInPolygon } from '../lib/polygon-relations'
import {
  terrainBreakFacts,
  terrainBreaksOf,
  terrainLinePolygonCrossings,
  validateTerrainBreak,
  validateTerrainBreakLotSpan,
} from '../lib/terrain-breaks'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import { queryNodes } from '../runtime/node-queries'
import type { SiteNode } from '../schema/nodes/site'
import { TerrainBreakNode } from '../schema/nodes/terrain-break'
import type { AgentOperation, SceneNodes } from './types'

const inputSchema = z.strictObject(addTerrainBreakTool.input)
type Point = [number, number]

function segmentInside(from: Point, to: Point, polygon: Point[]): boolean {
  if (!pointInPolygon(from, polygon) || !pointInPolygon(to, polygon)) return false
  const cuts = [
    0,
    ...terrainLinePolygonCrossings(from, to, polygon).filter((t) => t > 0 && t < 1),
    1,
  ]
  return cuts.slice(1).every((end, i) => {
    const start = cuts[i]
    if (start === undefined) return false
    const t = (start + end) / 2
    return pointInPolygon(
      [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
      polygon,
    )
  })
}

export function validateTerrainBreakPlacement(
  nodes: SceneNodes,
  site: SiteNode,
  boundary: TerrainBreakNode,
  scope: 'lot' | 'context' = 'lot',
): void {
  validateTerrainBreak(boundary)
  const polygon = site.polygon.points
  if (polygon.length < 3 || polygon.some((point) => !point.every(Number.isFinite)))
    refuse('invalid_polygon', 'The site needs a finite property polygon.')
  for (let i = 1; i < boundary.line.length; i++) {
    const from = boundary.line[i - 1]
    const to = boundary.line[i]
    if (!from || !to) refuse('invalid_input', 'The terrain-break line has a missing point.')
    if (scope === 'lot' && !segmentInside(from, to, polygon))
      refuse(
        'outside_property',
        'The terrain-break line leaves the property; use scope context explicitly.',
      )
  }
  validateTerrainBreakLotSpan(boundary, polygon)
  terrainBreaksOf(site, { ...nodes, [boundary.id]: boundary })
}

export const addTerrainBreak: AgentOperation<z.infer<typeof inputSchema>> = (nodes, raw) => {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const line = parsed.data.line.map((point): Point => {
    const [x, z] = point
    if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z))
      refuse('invalid_input', 'A terrain-break point must have two finite coordinates [x,z].')
    return [x, z]
  })
  const input = { ...parsed.data, line }
  validateTerrainBreak(input)
  const sites = queryNodes(nodes, { type: 'site' }).filter(
    (node): node is SiteNode => node.type === 'site',
  )
  if (!sites.length) refuse('no_site', 'The scene has no site for a terrain break.')
  if (sites.length !== 1) refuse('ambiguous_site', 'The scene has more than one site.')
  const site = sites[0]
  if (!site) refuse('no_site', 'The scene has no site for a terrain break.')
  const boundary = TerrainBreakNode.parse({ ...input, parentId: site.id })
  validateTerrainBreakPlacement(nodes, site, boundary, input.scope)
  const current = persistedTerrainFieldOf(site, nodes)
  if (site.terrain && !current) refuse('no_terrain', 'The persisted terrain field cannot be read.')
  const field = persistedTerrainFieldOf(site, { ...nodes, [boundary.id]: boundary })
  if (!field) refuse('no_terrain', 'The terrain-break field cannot be read.')
  const result = terrainBreakFacts(boundary, field)
  return { result, changes: { create: [{ node: boundary, parentId: site.id }] } }
}
