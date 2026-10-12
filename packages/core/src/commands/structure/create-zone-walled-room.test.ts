import { describe, expect, test } from 'bun:test'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import {
  type AnyNode,
  BuildingNode,
  generateId,
  LevelNode,
  WallNode,
  type ZoneNode,
} from '../../schema'
import { createZone } from './create-zone'

// Walls first, then a room drawn over them (run 6): the editor's own draw (a terrace over a walled
// courtyard) and an agent's create_room both go through createZone. What it does stays what a person
// meets by hand; the agent's refusal over a room a person named lives in create_room, not here.

const SQUARE: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function walled(zoneName?: string) {
  const walls = SQUARE.map((start, i) =>
    WallNode.parse({
      id: `wall_wr${i}`,
      parentId: 'level_wr',
      start,
      end: SQUARE[(i + 1) % 4]!,
      height: 2.5,
    }),
  )
  const level = LevelNode.parse({
    id: 'level_wr',
    parentId: 'building_wr',
    children: walls.map((w) => w.id),
  })
  const building = BuildingNode.parse({ id: 'building_wr', children: [level.id] })
  const base = Object.fromEntries([building, level, ...walls].map((node) => [node.id, node]))
  let count = 0
  const nodes = reconcileSceneStructure({
    nodes: base as Record<string, AnyNode>,
    mintId: (kind) => (kind === 'zone' ? 'zone_wr' : `${kind}_wr${++count}`),
  }).nodes as Record<string, AnyNode>
  if (zoneName) nodes.zone_wr = { ...nodes.zone_wr!, name: zoneName } as AnyNode
  return nodes
}

const zonesAfter = (nodes: Record<string, AnyNode>, plan: ReturnType<typeof createZone>) => {
  const created = plan.changes.filter(
    (change) => change.op === 'create' && change.node.type === 'zone',
  )
  return { created, renamed: plan.renamed, zoneId: plan.zoneId, nodes }
}

describe('a room drawn over walls that already enclose it', () => {
  test('names the room the reconciler numbered, without a second zone', () => {
    const nodes = walled()
    expect((nodes.zone_wr as ZoneNode).name).toMatch(/^Room \d+$/)
    const plan = createZone(nodes, {
      levelId: 'level_wr',
      polygon: SQUARE,
      name: 'Bedroom',
      mintId: generateId,
    })
    const { created, zoneId } = zonesAfter(nodes, plan)
    expect(zoneId).toBe('zone_wr')
    expect(created).toHaveLength(0)
  })

  test('a courtyard drawn as outdoor over its four walls is named outdoor, not refused', () => {
    const nodes = walled()
    const plan = createZone(nodes, {
      levelId: 'level_wr',
      polygon: SQUARE,
      name: 'Courtyard',
      enclose: false,
      intent: { hasCeiling: false },
      mintId: generateId,
    })
    expect(plan.conflicts).toBeUndefined()
    expect(plan.zoneId).toBe('zone_wr')
  })

  test('by hand, a room a person named is left as it is: createZone does not name it, and does not refuse', () => {
    const nodes = walled('Library')
    const plan = createZone(nodes, {
      levelId: 'level_wr',
      polygon: SQUARE,
      name: 'Bedroom',
      mintId: generateId,
    })
    expect(plan.renamed).toBeUndefined()
    expect(plan.zoneId).not.toBe('zone_wr')
    expect(
      plan.changes.some((change) => change.op === 'create' && change.node.type === 'zone'),
    ).toBe(true)
  })

  test("an agent's explicit rename (adoptNamed) names the person's room in place", () => {
    const nodes = walled('Library')
    const plan = createZone(nodes, {
      levelId: 'level_wr',
      polygon: SQUARE,
      name: 'Bedroom',
      adoptNamed: true,
      mintId: generateId,
    })
    expect(plan.zoneId).toBe('zone_wr')
    expect(plan.renamed).toBe('Library')
    expect(
      plan.changes.some((change) => change.op === 'create' && change.node.type === 'zone'),
    ).toBe(false)
  })
})
