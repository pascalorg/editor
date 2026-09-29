import { expect, test } from 'bun:test'
import { duplicateZone } from '../commands/structure/duplicate-zone'
import { setZoneIntent, type ZoneIntentPatch } from '../commands/structure/set-zone-intent'
import { applyToScratch, structureChangeBatch } from '../commands/structure/shared'
import type { AnyNode, SlabNode, ZoneNode } from '../schema'
import { floorStepFixture } from '../systems/slab/__fixtures__/floor-step'
import { cloneLevelSubtree, cloneSceneGraph } from '../utils/clone-scene-graph'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import { floorFootprintCreatorId } from './floor-footprint-key'
import { floorFootprintName } from './floor-footprint-name'
import { keyedFloorPlateId } from './floor-plate-id'
import { roomFloorChoices } from './room-floor-choices'

const reconcile = (nodes: Record<string, AnyNode>) =>
  reconcileStructureWithStableIds({ nodes }).nodes
const room = (nodes: Record<string, AnyNode>, id: string) => nodes[id] as ZoneNode
const base = (nodes: Record<string, AnyNode>, zoneId: string) =>
  Object.values(nodes).find(
    (node): node is SlabNode =>
      node.type === 'slab' && node.plateRole === 'base' && !!node.zoneIds?.includes(zoneId),
  )!
function intent(nodes: Record<string, AnyNode>, zoneId: string, patch: ZoneIntentPatch) {
  const plan = setZoneIntent(nodes, { zoneId, patch })
  expect(plan.conflicts ?? []).toEqual([])
  return reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
}

function fixture(join = true) {
  const f = floorStepFixture(true)
  const nodes = Object.fromEntries(Object.entries(f.nodes).filter(([, n]) => n.type !== 'slab'))
  const creatorId = f.zones[1]!.id
  const largerId = f.zones[0]!.id
  nodes[f.boundary.id] = { ...f.boundary, start: [6, 0], end: [6, 4] }
  for (const [id, name, x0, x1] of [
    [creatorId, 'Lanai', 6, 8],
    [largerId, 'Living room', 0, 6],
  ] as const)
    nodes[id] = {
      ...room(nodes, id),
      name,
      floor: undefined,
      polygon: [
        [x0, 0],
        [x1, 0],
        [x1, 4],
        [x0, 4],
      ],
    }
  let keyed = intent(reconcile(nodes), creatorId, { floor: { footprint: 'new' } })
  const key = room(keyed, creatorId).floor!.footprint!
  if (join) keyed = intent(keyed, largerId, { floor: { footprint: key } })
  return { nodes: keyed, creatorId, largerId, key, levelId: f.level.id }
}

test('a larger joining room keeps the creator name in plate and room floor choices', () => {
  const { nodes, creatorId, largerId, key } = fixture()
  expect(floorFootprintCreatorId(key)).toBe(creatorId)
  expect(base(nodes, largerId).zoneIds).toContain(creatorId)
  expect(floorFootprintName(nodes, base(nodes, largerId))).toBe('Lanai floor')
  for (const id of [creatorId, largerId])
    expect(roomFloorChoices(nodes, id)[0]).toMatchObject({
      key,
      name: 'Lanai floor',
      current: true,
    })
  const renamed = intent(nodes, creatorId, { name: 'Porch' })
  expect(floorFootprintName(renamed, base(renamed, largerId))).toBe('Porch floor')
  const plate = { ...base(nodes, largerId), name: 'Garden foundation' }
  expect(floorFootprintName({ ...nodes, [plate.id]: plate }, plate)).toBe('Garden foundation')
  expect(roomFloorChoices({ ...nodes, [plate.id]: plate }, largerId)[0]!.name).toBe(
    'Garden foundation',
  )
})

test('the creator leaving falls back; creating another floor never rejoins the old key', () => {
  const { nodes, creatorId, largerId, key } = fixture()
  const left = intent(nodes, creatorId, { floor: { footprint: null } })
  expect(floorFootprintName(left, base(left, largerId))).toBe('Living room floor')
  for (const before of [nodes, left]) {
    const fresh = intent(before, creatorId, { floor: { footprint: 'new' } })
    expect(room(fresh, creatorId).floor!.footprint).not.toBe(key)
    expect(floorFootprintCreatorId(room(fresh, creatorId).floor!.footprint!)).toBe(creatorId)
    expect(room(fresh, largerId).floor!.footprint).toBe(key)
    expect(floorFootprintName(fresh, base(fresh, largerId))).toBe('Living room floor')
    expect(floorFootprintName(fresh, base(fresh, creatorId))).toBe('Lanai floor')
  }
})

test.each([
  'deleted',
  'other level',
  'no floor',
  'unnamed',
])('an unavailable creator (%s) uses the largest named room', (state) => {
  const { nodes, creatorId, largerId } = fixture()
  const creator = room(nodes, creatorId)
  if (state === 'deleted') delete nodes[creatorId]
  else
    nodes[creatorId] = {
      ...creator,
      ...(state === 'other level' ? { parentId: 'level_elsewhere' } : {}),
      ...(state === 'no floor' ? { hasFloor: false as const } : {}),
      ...(state === 'unnamed' ? { name: '' } : {}),
    }
  expect(floorFootprintName(nodes, base(nodes, largerId))).toBe('Living room floor')
})

test('literal own has no creator and retains the largest-room fallback', () => {
  const { nodes, creatorId, largerId } = fixture()
  for (const id of [creatorId, largerId])
    nodes[id] = { ...room(nodes, id), floor: { footprint: 'own' } }
  const loaded = reconcile(nodes)
  expect(floorFootprintCreatorId('own')).toBeUndefined()
  expect(floorFootprintName(loaded, base(loaded, largerId))).toBe('Living room floor')
  expect(roomFloorChoices(loaded, creatorId)[0]!.name).toBe('Living room floor')
})

test('a disconnected room duplicate keeps the original creator rather than its own name', () => {
  const { nodes, creatorId, key } = fixture(false)
  let count = 0
  const plan = duplicateZone(nodes, {
    zoneId: creatorId,
    translate: [12, 0],
    mintId: (kind) => `${kind}_creator_copy_${count++}`,
  })
  expect(plan.conflicts ?? []).toEqual([])
  let copied = reconcile(applyToScratch(nodes, structureChangeBatch(plan.changes)))
  copied = intent(copied, plan.zoneId, { name: 'Guest room' })
  expect(room(copied, plan.zoneId).floor!.footprint).toBe(key)
  expect(base(copied, plan.zoneId).zoneIds).not.toContain(creatorId)
  expect(floorFootprintName(copied, base(copied, plan.zoneId))).toBe('Lanai floor')
  expect(roomFloorChoices(copied, plan.zoneId)[0]!.name).toBe('Lanai floor')
})

test.each([
  'level',
  'scene',
])('%s clone remints keys with the cloned creator and stable plate IDs', (kind) => {
  const { nodes, creatorId, largerId, key, levelId } = fixture()
  const clonedNodes =
    kind === 'level'
      ? cloneLevelSubtree(nodes, levelId).clonedNodes
      : Object.values(cloneSceneGraph({ nodes, rootNodeIds: [levelId] }).nodes)
  let cloned = Object.fromEntries(clonedNodes.map((node) => [node.id, node]))
  const creator = clonedNodes.find(
    (node) => node.type === 'zone' && node.name === 'Lanai',
  ) as ZoneNode
  const larger = clonedNodes.find(
    (node) => node.type === 'zone' && node.name === 'Living room',
  ) as ZoneNode
  expect(creator.id).not.toBe(creatorId)
  expect(larger.id).not.toBe(largerId)
  expect(creator.floor!.footprint).not.toBe(key)
  expect(larger.floor!.footprint).toBe(creator.floor!.footprint)
  expect(floorFootprintCreatorId(creator.floor!.footprint!)).toBe(creator.id)
  const plateId = keyedFloorPlateId(creator.parentId!, creator.floor!.footprint!)
  expect(cloned[plateId]?.type).toBe('slab')
  cloned = reconcile(cloned)
  expect(base(cloned, creator.id).id).toBe(plateId)
  expect(floorFootprintName(cloned, base(cloned, larger.id))).toBe('Lanai floor')
  cloned = intent(cloned, creator.id, { name: 'Cloned porch' })
  expect(floorFootprintName(cloned, base(cloned, larger.id))).toBe('Cloned porch floor')
  expect(floorFootprintName(nodes, base(nodes, largerId))).toBe('Lanai floor')
})

test.each([
  'own',
  'departed',
  'deleted',
])('cloning %s creator history preserves fallback naming', (state) => {
  const { nodes, creatorId, largerId, levelId } = fixture()
  if (state === 'own') {
    for (const id of [creatorId, largerId])
      nodes[id] = { ...room(nodes, id), floor: { footprint: 'own' } }
  } else if (state === 'departed')
    nodes[creatorId] = { ...room(nodes, creatorId), floor: undefined }
  else delete nodes[creatorId]
  const clonedNodes = Object.values(cloneSceneGraph({ nodes, rootNodeIds: [levelId] }).nodes)
  const cloned = Object.fromEntries(clonedNodes.map((node) => [node.id, node]))
  const larger = clonedNodes.find(
    (node) => node.type === 'zone' && node.name === 'Living room',
  ) as ZoneNode
  expect(floorFootprintName(cloned, base(cloned, larger.id))).toBe('Living room floor')
  if (state !== 'departed')
    expect(floorFootprintCreatorId(larger.floor!.footprint!)).toBeUndefined()
})
