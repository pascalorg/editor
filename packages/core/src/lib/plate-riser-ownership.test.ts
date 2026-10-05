import { expect, test } from 'bun:test'
import { type AnyNode, SeparatorNode, type SlabNode } from '../schema'
import { floorStepFixture } from '../systems/slab/__fixtures__/floor-step'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import { computePlateSurfacePartition, plateLevelContext } from './plate-surface'

// Step paint scope (UX round §7, Wassim §13 Q4): the room you step down from
// owns the step, whatever stands between the two rooms. A riser left without
// an owner would fall back to the plate-wide `riser` finish, so one room's
// step paint would repaint every such step of the footprint.

type Between = 'door' | 'wall' | 'separator'

function upperAndSunkRoom(between: Between) {
  const f = floorStepFixture()
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    Object.entries(f.nodes).filter(([, n]) => n.type !== 'slab' && n.type !== 'door'),
  )
  const level = f.level
  let children = level.children.filter((id) => nodes[id])
  if (between === 'door') {
    nodes[f.door.id] = f.door
    nodes[f.divider.id] = { ...f.divider, children: [f.door.id] }
  } else if (between === 'wall') {
    nodes[f.divider.id] = { ...f.divider, children: [] }
  } else {
    delete nodes[f.divider.id]
    const separator = SeparatorNode.parse({
      start: f.divider.start,
      end: f.divider.end,
      parentId: level.id,
    })
    nodes[separator.id] = separator
    children = [...children.filter((id) => id !== f.divider.id), separator.id]
  }
  nodes[level.id] = { ...level, height: 3, children }
  for (const [i, zone] of f.zones.entries())
    nodes[zone.id] = { ...zone, floor: { elevation: i ? -0.4 : 0.05 } }
  const reconciled = reconcileStructureWithStableIds({ nodes }).nodes
  const base = Object.values(reconciled).find(
    (n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base',
  )!
  const sides = computePlateSurfacePartition(
    base,
    plateLevelContext(reconciled[level.id]!, (id) => reconciled[id]),
  )!.sides
  return { upper: f.zones[0]!.id, sides }
}

test.each([
  'door',
  'wall',
  'separator',
] as const)('every step down into a sunken room across a %s is the upper room’s', (between) => {
  const { upper, sides } = upperAndSunkRoom(between)
  const risers = sides.filter((side) => side.role === 'riser')
  // A plain wall covers its drop down to the sunken floor: nothing to paint.
  expect(risers.length > 0).toBe(between !== 'wall')
  expect(risers.every((side) => side.zoneId === upper)).toBe(true)
  // Only the footprint's exterior band stays the plate's own.
  expect(sides.filter((side) => side.role === 'edge').every((side) => !side.zoneId)).toBe(true)
})
