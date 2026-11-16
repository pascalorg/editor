import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { setSiteLotTool } from '../agent-tools/terrain'
import { heightAt, type TerrainField } from '../lib/terrain-field'
import { distance2D, pointInPolygon, polygonArea, polygonBounds, type Vec2 } from './plan-geometry'
import { footprintOf, groundOf } from './terrain'
import type { AgentOperation } from './types'

const inputSchema = z.strictObject(setSiteLotTool.input)
type LotInput = z.output<typeof inputSchema>

function lotPolygon(input: LotInput, current: Vec2[]): Vec2[] {
  if (input.polygon) {
    if (input.widthM !== undefined || input.depthM !== undefined || input.anchor !== undefined)
      refuse('invalid_input', 'Give a polygon or rectangle dimensions, not both.')
    return footprintOf(input.polygon)
  }
  if (input.widthM === undefined || input.depthM === undefined)
    refuse('invalid_input', 'Give a polygon, or both widthM and depthM.')
  const bounds = polygonBounds(current)
  const [x, z] = input.anchor ?? [bounds.minX + bounds.width / 2, bounds.minZ + bounds.depth / 2]
  if (x === undefined || z === undefined)
    refuse('invalid_input', 'The rectangle anchor needs two coordinates [x,z].')
  const halfWidth = input.widthM / 2
  const halfDepth = input.depthM / 2
  return footprintOf([
    [x - halfWidth, z - halfDepth],
    [x + halfWidth, z - halfDepth],
    [x + halfWidth, z + halfDepth],
    [x - halfWidth, z + halfDepth],
  ])
}

function lotHeightRange(field: TerrainField | null, polygon: Vec2[]) {
  const bounds = polygonBounds(polygon)
  const perimeter = polygon.reduce((sum, from, index) => {
    const to = polygon[(index + 1) % polygon.length]
    return sum + (to ? distance2D(from, to) : 0)
  }, 0)
  // Bound facts independently of lot size; tiles impose no fixed dimension ceiling.
  const cellM = Math.max(0.5, bounds.width / 100, bounds.depth / 100, perimeter / 4000)
  let minM = Infinity
  let maxM = -Infinity
  let sampleCount = 0
  const sample = (x: number, z: number) => {
    const height = field ? heightAt(field, x, z) : 0
    if (!Number.isFinite(height))
      refuse('no_terrain', 'The ground cannot produce finite lot heights.')
    minM = Math.min(minM, height)
    maxM = Math.max(maxM, height)
    sampleCount++
  }
  for (const [index, from] of polygon.entries()) {
    const to = polygon[(index + 1) % polygon.length]
    if (!to) continue
    const steps = Math.max(1, Math.ceil(distance2D(from, to) / cellM))
    for (let step = 0; step < steps; step++) {
      const fraction = step / steps
      sample(from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction)
    }
  }
  const cols = Math.ceil(bounds.width / cellM)
  const rows = Math.ceil(bounds.depth / cellM)
  for (let row = 0; row <= rows; row++) {
    const z = bounds.minZ + (row / rows) * bounds.depth
    for (let col = 0; col <= cols; col++) {
      const x = bounds.minX + (col / cols) * bounds.width
      if (pointInPolygon([x, z], polygon)) sample(x, z)
    }
  }
  return { minM, maxM, cellM, sampleCount }
}

export const setSiteLot: AgentOperation<LotInput> = (nodes, input) => {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const { site, field } = groundOf(nodes)
  const polygon = lotPolygon(parsed.data, footprintOf(site.polygon.points))
  const { minM, maxM, cellM, sampleCount } = lotHeightRange(field, polygon)
  return {
    result: {
      siteId: site.id,
      polygon,
      areaM2: polygonArea(polygon),
      minM,
      maxM,
      sampling: {
        approximate: true,
        method: 'lot_grid_and_edges',
        spacingM: field?.spacing ?? 0.5,
        heightStepM: field?.step ?? 0.01,
        cellM,
        sampleCount,
      },
    },
    changes: { update: [{ id: site.id, data: { polygon: { type: 'polygon', points: polygon } } }] },
  }
}
