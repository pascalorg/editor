import { describe, expect, test } from 'bun:test'
import { createZone } from '../commands/structure/create-zone'
import { duplicateZone } from '../commands/structure/duplicate-zone'
import { applyToScratch, structureChangeBatch } from '../commands/structure/shared'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  newZone,
  WallNode,
  ZONE_COLOR_PALETTE,
  ZoneNode,
  zoneColorForSeed,
} from '../index'
import {
  reconcileStructureOnLoad,
  reconcileStructureWithStableIds,
} from '../utils/scene-migrations'

const HUES = ZONE_COLOR_PALETTE.slice(0, 10) as readonly string[]
const reconcile = (nodes: Record<string, AnyNode>) => ({
  ...reconcileStructureWithStableIds({ nodes }).nodes,
})

function level() {
  const building = BuildingNode.parse({ id: 'building_colors', children: ['level_colors'] })
  const floor = LevelNode.parse({ id: 'level_colors', parentId: building.id })
  return { [building.id]: building, [floor.id]: floor } as Record<string, AnyNode>
}

function room(nodes: Record<string, AnyNode>, x: number, ids: string) {
  let counter = 0
  const plan = createZone(nodes, {
    levelId: 'level_colors',
    polygon: [
      [x, 0],
      [x + 4, 0],
      [x + 4, 4],
      [x, 4],
    ],
    enclose: true,
    mintId: (kind) => `${kind}_${ids}_${counter++}`,
  })
  expect(plan.conflicts ?? []).toEqual([])
  return { nodes: reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes))), plan }
}

describe('zone creation colours', () => {
  test('a new zone gets a palette hue picked by its id, the same for every creator', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `zone_colors${i}`)
    for (const id of ids) {
      expect(HUES).toContain(zoneColorForSeed(id))
      expect(zoneColorForSeed(id)).toBe(zoneColorForSeed(id))
    }
    expect(new Set(ids.map(zoneColorForSeed)).size).toBeGreaterThan(4)
    const zone = newZone({ id: 'zone_colors_new', name: 'Den', polygon: [] })
    expect(zone.color).toBe(zoneColorForSeed('zone_colors_new'))
  })

  test('a colour the creator chose is kept, blue included', () => {
    for (const color of ['#3b82f6', '#a855f7']) {
      expect(newZone({ name: 'Den', polygon: [], color }).color).toBe(color)
    }
  })

  test('automatic rooms persist the colour of their final id in the graph and create patch', () => {
    const colors = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const nodes = level()
      const polygon: [number, number][] = [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]
      for (const [edge, start] of polygon.entries()) {
        const wall = WallNode.parse({
          id: `wall_colors_${i}_${edge}`,
          parentId: 'level_colors',
          start,
          end: polygon[(edge + 1) % polygon.length],
        })
        nodes[wall.id] = wall
      }
      const result = reconcileStructureWithStableIds({ nodes })
      const created = result.patches.filter(
        (patch) => patch.op === 'create' && patch.node.type === 'zone',
      )
      expect(created).toHaveLength(1)
      const zone = Object.values(result.nodes).find(
        (node): node is ZoneNode => node.type === 'zone',
      )!
      expect(zone.color).toBe(zoneColorForSeed(zone.id))
      expect(created[0]).toEqual({ op: 'create', node: zone })
      expect(
        reconcileStructureWithStableIds({
          nodes: Object.fromEntries(Object.entries(nodes).reverse()),
        }),
      ).toEqual(result)
      expect(reconcileStructureWithStableIds({ nodes: result.nodes }).patches).toEqual([])
      colors.add(zone.color)
    }
    expect(colors.size).toBeGreaterThan(4)
  })

  test('drawing a room writes its creation colour; a duplicate keeps the source colour', () => {
    const drawn = room(level(), 0, 'draw')
    const created = drawn.nodes[drawn.plan.zoneId] as ZoneNode
    expect(created.color).toBe(zoneColorForSeed(created.id))

    const picked = { ...drawn.nodes, [created.id]: { ...created, color: '#a855f7' } }
    let counter = 0
    const copy = duplicateZone(picked, {
      zoneId: created.id,
      translate: [10, 0],
      mintId: (kind) => `${kind}_copy_${counter++}`,
    })
    const copied = reconcile(applyToScratch(picked, structureChangeBatch(copy.changes)))
    const copyId = (copy as { zoneId?: string }).zoneId!
    expect((copied[copyId] as ZoneNode).color).toBe('#a855f7')
  })

  test('an existing blue room stays blue: loading and reconciling write nothing', () => {
    const drawn = room(level(), 0, 'old')
    const id = drawn.plan.zoneId
    const old = { ...drawn.nodes, [id]: ZoneNode.parse({ ...drawn.nodes[id], color: '#3b82f6' }) }
    expect(reconcileStructureOnLoad(old)).toEqual({ nodes: old, changed: false })
    const result = reconcileStructureWithStableIds({ nodes: old })
    expect(result.patches).toEqual([])
    expect((result.nodes[id] as ZoneNode).color).toBe('#3b82f6')
  })
})
