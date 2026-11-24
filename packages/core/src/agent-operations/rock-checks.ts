import { rockFacts } from '../lib/rock-facts'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, RockNode } from '../schema'
import { registerSceneCheck, type SceneIssue } from './verify-scene'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

type RockObservation = SceneIssue & { nodeIds: string[] }

function describe(rock: RockNode, nodes: Record<string, AnyNode>): RockObservation | null {
  const { throughSlabs, meetsWalls, footprintAreaM2, heightM } = rockFacts(rock, nodes)
  if (!throughSlabs.length && !meetsWalls.length) return null
  const holes = throughSlabs.reduce((sum, slab) => sum + slab.holeAreaM2, 0)
  const parts = [
    throughSlabs.length
      ? `rises through ${plural(throughSlabs.length, 'floor')} (${holes.toFixed(1)} m² of hole)`
      : '',
    meetsWalls.length ? `meets ${plural(meetsWalls.length, 'wall')}` : '',
  ].filter(Boolean)
  return {
    type: 'rock_through_building',
    severity: 'info',
    message: `Rock ${rock.name ?? rock.id} (${footprintAreaM2} m², ${heightM} m high) ${parts.join(' and ')}: a rock inside the building is intended, not a collision.`,
    nodeIds: [
      rock.id,
      ...throughSlabs.map((slab) => slab.slabId),
      ...meetsWalls.map((wall) => wall.wallId),
    ],
  }
}

// A rock that passes through floors or meets walls, stated as a fact beside the other observations.
registerSceneCheck({
  name: 'rocks',
  order: 50,
  run: (nodes) =>
    queryNodes<RockNode>(nodes, { type: 'rock' }).flatMap((node) => {
      const issue = describe(node, nodes as Record<string, AnyNode>)
      return issue ? [issue] : []
    }),
})
