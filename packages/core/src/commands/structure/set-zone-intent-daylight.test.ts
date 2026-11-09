import { expect, test } from 'bun:test'
import { setZoneIntentTool } from '../../agent-tools/room-structure'
import type { AnyNode, ZoneNode } from '../../schema'
import { floorStepFixture } from '../../systems/slab/__fixtures__/floor-step'
import { setZoneIntent, ZoneIntentPatch } from './set-zone-intent'
import { applyToScratch, structureChangeBatch } from './shared'

const lit = { artificialLight: true, mechanicalVentilation: true }

function fixture() {
  const f = floorStepFixture(true)
  const zoneId = f.zones[0]!.id
  const nodes: Record<string, AnyNode> = {
    ...f.nodes,
    [zoneId]: { ...f.nodes[zoneId]!, metadata: { source: 'plan', note: 'kept' } } as AnyNode,
  }
  return { nodes, zoneId }
}
const zoneOf = (nodes: Record<string, AnyNode>, id: string) => nodes[id] as ZoneNode
function apply(nodes: Record<string, AnyNode>, zoneId: string, patch: ZoneIntentPatch) {
  const plan = setZoneIntent(nodes, { zoneId, patch })
  expect(plan.conflicts ?? []).toEqual([])
  return applyToScratch(nodes, structureChangeBatch(plan.changes))
}

test('daylight declares a room lit and ventilated by artificial means, in its metadata, beside what is there', () => {
  const { nodes, zoneId } = fixture()
  const after = apply(nodes, zoneId, { daylight: lit })
  expect(zoneOf(after, zoneId).metadata).toEqual({ source: 'plan', note: 'kept', daylight: lit })
})

test('daylight null clears the declaration and nothing else', () => {
  const { nodes, zoneId } = fixture()
  const declared = apply(nodes, zoneId, { daylight: lit })
  const cleared = apply(declared, zoneId, { daylight: null })
  expect(zoneOf(cleared, zoneId).metadata).toEqual({ source: 'plan', note: 'kept' })
  // A room that never declared anything is left as it was.
  expect(zoneOf(apply(nodes, zoneId, { daylight: null }), zoneId).metadata).toEqual({
    source: 'plan',
    note: 'kept',
  })
})

test('a patch without daylight leaves the declaration where it is', () => {
  const { nodes, zoneId } = fixture()
  const declared = apply(nodes, zoneId, { daylight: lit })
  expect(zoneOf(apply(declared, zoneId, { name: 'Den' }), zoneId).metadata).toMatchObject({
    daylight: lit,
  })
})

test('the declaration is both facts or a refusal: booleans, nothing else', () => {
  for (const daylight of [
    { artificialLight: true },
    { mechanicalVentilation: true },
    { artificialLight: 'yes', mechanicalVentilation: true },
    { artificialLight: true, mechanicalVentilation: true, windows: 0 },
  ])
    expect(ZoneIntentPatch.safeParse({ daylight }).success).toBe(false)
  expect(
    ZoneIntentPatch.safeParse({
      daylight: { artificialLight: false, mechanicalVentilation: false },
    }).success,
  ).toBe(true)
})

test('the tool offers the same patch as the command', () => {
  expect(setZoneIntentTool.input.patch.safeParse({ daylight: lit }).success).toBe(true)
  expect(setZoneIntentTool.input.patch.safeParse({ daylight: null }).success).toBe(true)
  expect(
    setZoneIntentTool.input.patch.safeParse({ daylight: { artificialLight: true } }).success,
  ).toBe(false)
  expect(setZoneIntentTool.description).toContain(
    'daylight { artificialLight, mechanicalVentilation }',
  )
})
