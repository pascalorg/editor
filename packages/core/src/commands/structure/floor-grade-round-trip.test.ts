import { expect, test } from 'bun:test'
import { groundFloorConstruction } from '../../lib/floor-foundation-datum'
import { expandFloorIntentChanges } from '../../lib/floor-intent-changes'
import type { AnyNode, SlabNode } from '../../schema'
import { filterDerivedNodeWrites } from '../../store/derived-node-guard'
import { floorStepFixture } from '../../systems/slab/__fixtures__/floor-step'
import { reconcileStructureWithStableIds } from '../../utils/structure-id'
import { setRoomFloorConstruction } from './set-room-floor-construction'
import { applyToScratch, structureChangeBatch } from './shared'

const reconcile = (nodes: Record<string, AnyNode>) => ({
  ...reconcileStructureWithStableIds({ nodes }).nodes,
})

for (const footprint of [undefined, 'own']) {
  test(`${footprint ?? 'shared'} ground floor foundation 0 → 0.05 → 0 round-trips its finish`, () => {
    const fixture = floorStepFixture(true)
    const zoneId = fixture.zones[1]!.id
    let nodes = reconcile(
      Object.fromEntries(Object.entries(fixture.nodes).filter(([, node]) => node.type !== 'slab')),
    )
    const room = nodes[zoneId]!
    nodes = reconcile({ ...nodes, [zoneId]: { ...room, floor: { footprint } } as AnyNode })
    const plate = Object.values(nodes).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && !!node.zoneIds?.includes(zoneId),
    )!
    const { grade } = groundFloorConstruction(nodes, plate)
    const write = (foundationHeight: number) => {
      const plan = setRoomFloorConstruction(nodes, { zoneId, patch: { foundationHeight } })
      expect(plan.conflicts ?? []).toEqual([])
      nodes = reconcile(
        applyToScratch(nodes, filterDerivedNodeWrites(nodes, structureChangeBatch(plan.changes))),
      )
      expect((nodes[plate.id] as SlabNode).elevation).toBeCloseTo(
        grade + foundationHeight + plate.thickness,
      )
    }
    write(0)
    nodes = reconcile({
      ...nodes,
      [plate.id]: {
        ...nodes[plate.id],
        foundation: { type: 'none', material: 'library:stone' },
      } as SlabNode,
    })
    const before = nodes
    for (let trip = 0; trip < 2; trip++) {
      write(0.05)
      expect((nodes[plate.id] as SlabNode).foundation).toEqual({
        type: 'solid',
        material: 'library:stone',
      })
      expect((nodes[plate.id] as SlabNode).thickness).toBe(plate.thickness)
      expect(reconcile(nodes)).toEqual(nodes)
      write(0)
      expect(nodes).toEqual(before)
    }
    const stale = {
      ...nodes,
      [plate.id]: {
        ...nodes[plate.id],
        foundation: { type: 'solid', material: 'library:stone' },
      } as SlabNode,
    }
    const plan = setRoomFloorConstruction(stale, { zoneId, patch: { foundationHeight: 0.05 } })
    expect(plan.conflicts ?? []).toEqual([])
    const raised = reconcile(applyToScratch(stale, structureChangeBatch(plan.changes)))[
      plate.id
    ] as SlabNode
    expect(raised.elevation).toBeCloseTo(grade + 0.05 + plate.thickness)
    expect(raised.foundation).toEqual({ type: 'solid', material: 'library:stone' })
    const top = grade + 0.05 + plate.thickness
    const direct = expandFloorIntentChanges(nodes, [{ id: plate.id, data: { floorHeight: top } }])
    expect(direct.find((update) => update.id === plate.id)?.data).toMatchObject({
      foundation: { type: 'solid' },
    })
  })
}
