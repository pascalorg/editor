import { createMezzanine } from '../../commands/structure/create-mezzanine'
import {
  applyToScratch,
  type StructurePlan,
  structureChangeBatch,
} from '../../commands/structure/shared'
import { type AnyNode, LevelNode, WallNode, type ZoneNode } from '../../schema'
import { reconcileSceneStructure } from '../structure-reconcile'

export const mezzaninePolygon: [number, number][] = [
  [0.1, 0.1],
  [4, 0.1],
  [4, 3],
  [0.1, 3],
]

export function mezzanineFixture(height = 5) {
  let serial = 0
  const mintId = (kind: string) => `${kind}_mezz${++serial}`
  const ring: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ]
  const walls = ring.map((start, i) =>
    WallNode.parse({
      id: mintId('wall'),
      parentId: 'level_mezz',
      start,
      end: ring[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const level = LevelNode.parse({
    id: 'level_mezz',
    height,
    children: walls.map((wall) => wall.id),
  })
  const reconcile = (nodes: Readonly<Record<string, AnyNode>>) =>
    reconcileSceneStructure({ nodes, mintId })
  const before = reconcile(Object.fromEntries([level, ...walls].map((n) => [n.id, n]))).nodes
  const host = Object.values(before).find((node): node is ZoneNode => node.type === 'zone')!
  const apply = (nodes: Readonly<Record<string, AnyNode>>, plan: StructurePlan) =>
    reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes))).nodes
  const plan = createMezzanine(before, { hostZoneId: host.id, polygon: mezzaninePolygon, mintId })
  const nodes = apply(before, plan)
  const zone = nodes[plan.zoneId] as ZoneNode
  const plate = Object.values(nodes).find((n) => n.type === 'slab' && n.zoneIds?.includes(zone.id))!
  if (plate.type !== 'slab') throw Error('Missing mezzanine plate')
  return { before, nodes, host, zone, plate, level, walls, apply, reconcile, mintId }
}
