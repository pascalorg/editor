import { floorsOf } from '../../agent-operations/circulation-spaces'
import { difference } from '../../lib/polygon-boolean'
import type { FloorRegion, Skipped } from './types'
import type { Nodes } from './walls'

/**
 * The floor a person stands on, level by level: each slab's walking surface less the floor openings
 * and lift shafts cut through it, at the height the circulation graph reads (`floorsOf`), so the
 * usage checks and the circulation report stand on the same floor. A slab draped over terrain is one
 * flat height here and is marked approximate; a recessed slab (a pool) is not a floor.
 */
export function levelFloors(nodes: Nodes): {
  floors: Map<string, FloorRegion[]>
  skipped: Skipped[]
} {
  const floors = new Map<string, FloorRegion[]>()
  const skipped: Skipped[] = []
  for (const floor of floorsOf(nodes).floors) {
    const cuts = [...floor.voids, ...floor.shafts].map((ring) => ({ outer: ring, holes: [] }))
    const regions: FloorRegion[] = []
    for (const slab of floor.slabs) {
      const source = nodes[slab.id]
      if (source?.type === 'slab' && source.recessed) {
        skipped.push({ nodeId: slab.id, why: 'a recessed slab is not a floor to stand on' })
        continue
      }
      const pieces = difference({ outer: slab.polygon, holes: slab.holes }, cuts)
      for (const [index, piece] of pieces.entries())
        regions.push({
          id: `${slab.id}#floor${pieces.length > 1 ? `.${index}` : ''}`,
          nodeId: slab.id,
          outer: piece.outer,
          holes: piece.holes,
          y: slab.elevation,
          outdoor: slab.outdoor,
          shape: 'exact',
        })
    }
    floors.set(floor.id, regions)
  }
  return { floors, skipped }
}
