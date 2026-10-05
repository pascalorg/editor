import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  referencedSceneMaterialIds,
  remapSceneMaterialRefs,
  sceneMaterialUsageCounts,
} from './scene-material-refs'

const ref = (id: string) => `scene:${id}`

// One node per place a finish can live.
const nodes = {
  zone_room: {
    id: 'zone_room',
    type: 'zone',
    floor: {
      finish: ref('floor'),
      regions: [{ id: 'r1', polygon: [], finish: ref('rug') }],
    },
    wallMaterial: ref('walls'),
    wallOverrides: [{ wallId: 'wall_1', face: 'a', finish: ref('accent') }],
    floorStepFinish: ref('step'),
    floorStepOverrides: [{ key: 'door_1', finish: ref('doorstep') }],
    floorEdgeFinish: ref('edge'),
  },
  wall_1: {
    id: 'wall_1',
    type: 'wall',
    slots: { a: ref('walls') },
    faceRegions: [{ id: 'w1', face: 'a', finish: ref('wainscot') }],
  },
  slab_base: {
    id: 'slab_base',
    type: 'slab',
    plateRole: 'base',
    slots: { edge: ref('band') },
    foundation: { type: 'solid', material: ref('foundation') },
  },
  item_1: { id: 'item_1', type: 'item', slots: { seat: 'library:oak' } },
} as unknown as Record<string, AnyNode>

describe('scene material refs', () => {
  test('counts every finish location, one per use', () => {
    const counts = sceneMaterialUsageCounts(nodes)
    expect(Object.fromEntries(counts)).toEqual({
      floor: 1,
      rug: 1,
      walls: 2,
      accent: 1,
      step: 1,
      doorstep: 1,
      edge: 1,
      wainscot: 1,
      band: 1,
      foundation: 1,
    })
  })

  test('collects the materials a set of nodes carries, ignoring library refs', () => {
    expect(
      [...referencedSceneMaterialIds([nodes.zone_room, nodes.item_1])].map(String).sort(),
    ).toEqual(['accent', 'doorstep', 'edge', 'floor', 'rug', 'step', 'walls'])
  })

  test('remaps refs wherever they are and keeps untouched nodes as they were', () => {
    const map = new Map([
      ['floor', 'floor2'],
      ['foundation', 'stone'],
      ['doorstep', 'tile'],
    ])
    const zone = remapSceneMaterialRefs(nodes.zone_room, map) as Record<string, any>
    expect(zone.floor.finish).toBe(ref('floor2'))
    expect(zone.floor.regions).toBe((nodes.zone_room as Record<string, any>).floor.regions)
    expect(zone.floorStepOverrides).toEqual([{ key: 'door_1', finish: ref('tile') }])
    const slab = remapSceneMaterialRefs(nodes.slab_base, map) as Record<string, any>
    expect(slab.foundation).toEqual({ type: 'solid', material: ref('stone') })
    expect(remapSceneMaterialRefs(nodes.item_1, map)).toBe(nodes.item_1)
  })
})
