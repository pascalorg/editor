import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

// Third-party exporters (scanning apps, IFC hand-offs) can legitimately write a
// slab or ceiling without `holes` / `holeMetadata` / `autoFromWalls`: the schema
// declares defaults for them. The opening sync and the public viewer read those
// fields on the raw node, so a missing `holes` threw
// "Cannot read properties of undefined (reading 'map')" and the scene never
// rendered. Doors and windows are already zod-parsed on load; this covers
// slabs and ceilings the same way.
describe('scene load applies surface hole defaults', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  const base = {
    site_test: {
      object: 'node',
      id: 'site_test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['building_test'],
    },
    building_test: {
      object: 'node',
      id: 'building_test',
      type: 'building',
      parentId: 'site_test',
      visible: true,
      metadata: {},
      children: ['level_test'],
    },
    level_test: {
      object: 'node',
      id: 'level_test',
      type: 'level',
      parentId: 'building_test',
      visible: true,
      metadata: {},
      level: 0,
      children: ['slab_bare', 'ceiling_bare'],
    },
  }

  test('a slab and a ceiling written without holes load with empty hole arrays', () => {
    useScene.getState().setScene(
      {
        ...base,
        slab_bare: {
          object: 'node',
          id: 'slab_bare',
          type: 'slab',
          parentId: 'level_test',
          visible: true,
          metadata: {},
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
          elevation: 0.05,
        },
        ceiling_bare: {
          object: 'node',
          id: 'ceiling_bare',
          type: 'ceiling',
          parentId: 'level_test',
          visible: true,
          metadata: {},
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
        },
      } as unknown as Record<AnyNode['id'], AnyNode>,
      ['site_test' as AnyNode['id']],
    )

    const slab = useScene.getState().nodes['slab_bare' as AnyNode['id']]
    expect(slab?.type).toBe('slab')
    if (slab?.type !== 'slab') return
    expect(slab.holes).toEqual([])
    expect(slab.holeMetadata).toEqual([])
    expect(slab.autoFromWalls).toBe(false)
    expect(slab.polygon).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])

    const ceiling = useScene.getState().nodes['ceiling_bare' as AnyNode['id']]
    expect(ceiling?.type).toBe('ceiling')
    if (ceiling?.type !== 'ceiling') return
    expect(ceiling.holes).toEqual([])
    expect(ceiling.holeMetadata).toEqual([])
  })

  test('existing holes and metadata are kept as written', () => {
    useScene.getState().setScene(
      {
        ...base,
        level_test: { ...base.level_test, children: ['slab_holed'] },
        slab_holed: {
          object: 'node',
          id: 'slab_holed',
          type: 'slab',
          parentId: 'level_test',
          visible: true,
          metadata: {},
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
          holes: [
            [
              [1, 1],
              [2, 1],
              [2, 2],
              [1, 2],
            ],
          ],
          holeMetadata: [{ source: 'manual' }],
        },
      } as unknown as Record<AnyNode['id'], AnyNode>,
      ['site_test' as AnyNode['id']],
    )
    const slab = useScene.getState().nodes['slab_holed' as AnyNode['id']]
    if (slab?.type !== 'slab') throw new Error('slab expected')
    expect(slab.holes).toHaveLength(1)
    expect(slab.holeMetadata).toEqual([{ source: 'manual' }])
  })
})
