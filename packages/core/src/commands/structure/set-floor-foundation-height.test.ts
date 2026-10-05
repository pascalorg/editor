import { expect, test } from 'bun:test'
import { automaticFloorHeight } from '../../lib/floor-foundation-datum'
import type { AnyNode, SlabNode } from '../../schema'
import { floorStepFixture } from '../../systems/slab/__fixtures__/floor-step'
import { reconcileStructureOnLoad } from '../../utils/reconcile-structure-on-load'
import { DEFAULT_FOUNDATION_MATERIAL, setFloorFoundation } from './set-floor-foundation'

function scene() {
  const f = floorStepFixture()
  const nodes = Object.fromEntries(
    Object.entries(f.nodes).filter(([, node]) => node.type !== 'slab'),
  ) as Record<string, AnyNode>
  const loaded = reconcileStructureOnLoad(nodes).nodes as Record<string, AnyNode>
  const plate = Object.values(loaded).find(
    (n): n is SlabNode => n.type === 'slab' && n.plateRole === 'base',
  )!
  return { nodes: loaded, plate }
}

function write(nodes: Record<string, AnyNode>, plan: ReturnType<typeof setFloorFoundation>) {
  const next = { ...nodes }
  for (const change of plan.changes)
    if (change.op === 'update') next[change.id] = { ...next[change.id], ...change.data } as AnyNode
  return reconcileStructureOnLoad(next).nodes as Record<string, AnyNode>
}

test('raising a footprint gives it a grey solid foundation; back to the ground removes it', () => {
  const { nodes, plate } = scene()
  const ground = automaticFloorHeight(nodes, plate)
  const raised = setFloorFoundation(nodes, {
    slabId: plate.id,
    patch: { floorHeight: ground + 0.5 },
  })
  expect(raised.conflicts).toEqual([])
  const up = write(nodes, raised)
  expect(up[plate.id]).toMatchObject({
    floorHeight: ground + 0.5,
    foundation: { type: 'solid', material: DEFAULT_FOUNDATION_MATERIAL },
  })

  const lowered = setFloorFoundation(up, { slabId: plate.id, patch: { floorHeight: null } })
  const down = write(up, lowered)
  expect((down[plate.id] as SlabNode).floorHeight).toBeUndefined()
  expect((down[plate.id] as SlabNode).foundation?.type).toBe('none')
})

test('a finish already chosen for the foundation is kept when raising again', () => {
  const { nodes, plate } = scene()
  const ground = automaticFloorHeight(nodes, plate)
  const stone = { ...plate, foundation: { type: 'none' as const, material: 'library:stone' } }
  const withStone = { ...nodes, [plate.id]: stone }
  const up = write(
    withStone,
    setFloorFoundation(withStone, { slabId: plate.id, patch: { floorHeight: ground + 0.3 } }),
  )
  expect((up[plate.id] as SlabNode).foundation).toEqual({
    type: 'solid',
    material: 'library:stone',
  })
})

test('an explicit foundation choice with the height wins over the default', () => {
  const { nodes, plate } = scene()
  const ground = automaticFloorHeight(nodes, plate)
  const plan = setFloorFoundation(nodes, {
    slabId: plate.id,
    patch: { floorHeight: ground + 0.3, foundation: { type: 'solid', material: 'library:brick' } },
  })
  expect(write(nodes, plan)[plate.id]).toMatchObject({
    foundation: { type: 'solid', material: 'library:brick' },
  })
})

test('on the ground uses terrain support rather than an imported floor reference', () => {
  const { nodes, plate } = scene()
  const ground = automaticFloorHeight(nodes, plate)
  const imported = {
    ...plate,
    elevation: ground + 0.2,
    referenceFloorElevation: ground + 0.2,
  }
  const raised = { ...nodes, [plate.id]: imported }
  const plan = setFloorFoundation(raised, { slabId: plate.id, patch: { floorHeight: null } })
  expect(plan.conflicts).toEqual([])
  const lowered = write(raised, plan)[plate.id] as SlabNode
  expect(lowered.elevation).toBeCloseTo(ground)
  expect(lowered.floorHeight).toBeCloseTo(ground)
  expect(lowered.referenceFloorElevation).toBeCloseTo(ground + 0.2)
  expect(lowered.foundation?.type).toBe('none')
})
