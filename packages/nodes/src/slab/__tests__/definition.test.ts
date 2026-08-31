import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, pointInPolygon2D, SlabNode } from '@pascal-app/core'
import { slabDefinition } from '../definition'

function getThicknessHandle(slab: SlabNode) {
  const handles =
    typeof slabDefinition.handles === 'function'
      ? slabDefinition.handles(slab)
      : (slabDefinition.handles ?? [])
  const thicknessHandle = handles.find(
    (handle) =>
      handle.kind === 'linear-resize' && handle.axis === 'y' && handle.shape !== 'tracker',
  )
  if (!(thicknessHandle && thicknessHandle.kind === 'linear-resize')) {
    throw new Error('Missing slab thickness handle')
  }
  return thicknessHandle
}

function getThicknessHandlePosition(slab: SlabNode) {
  return getThicknessHandle(slab).placement.position(slab, {} as never)
}

function getBaseElevationHandle(slab: SlabNode) {
  const handles =
    typeof slabDefinition.handles === 'function'
      ? slabDefinition.handles(slab)
      : (slabDefinition.handles ?? [])
  const baseHandle = handles.find(
    (handle) =>
      handle.kind === 'linear-resize' && handle.axis === 'y' && handle.shape === 'tracker',
  )
  if (!(baseHandle && baseHandle.kind === 'linear-resize')) {
    throw new Error('Missing slab base elevation handle')
  }
  return baseHandle
}

describe('slabDefinition handles', () => {
  test('keeps the thickness handle over solid slab area when the center is a hole', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      holes: [
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
      ],
    })

    const [x, , z] = getThicknessHandlePosition(slab)

    expect(pointInPolygon2D([x, z], slab.polygon, { includeBoundary: false })).toBe(true)
    expect(pointInPolygon2D([x, z], slab.holes[0]!, { includeBoundary: true })).toBe(false)
  })

  test('resizes thickness upward without moving the underside anchor', () => {
    const slab = SlabNode.parse({
      elevation: 0.7,
      thickness: 0.2,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const thicknessHandle = getThicknessHandle(slab)

    expect(thicknessHandle.currentValue(slab)).toBe(0.2)
    const update = thicknessHandle.apply(slab, 0.35, {} as never)
    expect(update).toEqual({
      elevation: expect.any(Number),
      thickness: 0.35,
      recessed: false,
    })
    expect(update.elevation).toBeCloseTo(0.85)
  })

  test('moves the underside anchor without changing slab thickness', () => {
    const slab = SlabNode.parse({
      elevation: 0.7,
      thickness: 0.2,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const baseHandle = getBaseElevationHandle(slab)

    expect(baseHandle.currentValue(slab)).toBeCloseTo(0.5)
    expect(baseHandle.placement.position(slab, {} as never)[1]).toBeCloseTo(0.5)
    expect(baseHandle.apply(slab, 0.9, {} as never)).toEqual({
      elevation: 1.1,
    })
    expect(slab.thickness).toBe(0.2)
  })

  test('previews attached stair rise while resizing a raised slab', () => {
    const slab = SlabNode.parse({
      id: 'slab_deck',
      parentId: 'level_a',
      elevation: 0.7,
      thickness: 0.2,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const level = {
      id: 'level_a',
      type: 'level',
      children: [slab.id, 'stair_a'],
      height: 2.5,
    } as unknown as AnyNode
    const stair = {
      id: 'stair_a',
      type: 'stair',
      parentId: 'level_a',
      children: ['segment_a'],
      position: [3, 0, 3],
      rotation: 0,
      stairType: 'straight',
      deckSlabId: slab.id,
      supportSlabId: 'ground',
    } as unknown as AnyNode
    const segment = {
      id: 'segment_a',
      type: 'stair-segment',
      parentId: 'stair_a',
      segmentType: 'stair',
      height: 0.7,
      width: 1,
      length: 3,
      stepCount: 10,
      fillToFloor: false,
      thickness: 0.2,
    } as unknown as AnyNode
    const nodes = {
      [level.id]: level,
      [slab.id]: slab,
      [stair.id]: stair,
      [segment.id]: segment,
    } as Record<AnyNodeId, AnyNode>
    const handle = getThicknessHandle(slab)
    const preview = new Map(
      handle.previewOverrides?.(slab, 0.4, { nodes: () => nodes } as never) ?? [],
    )

    expect(preview.has(stair.id as AnyNodeId)).toBe(true)
    expect(preview.get(segment.id as AnyNodeId)?.height).toBeCloseTo(0.9)
  })

  test('keeps recessed slabs on their depth control only', () => {
    const slab = SlabNode.parse({
      elevation: -0.2,
      recessed: true,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const handles =
      typeof slabDefinition.handles === 'function'
        ? slabDefinition.handles(slab)
        : (slabDefinition.handles ?? [])
    const depthHandle = handles[0]

    expect(handles).toHaveLength(1)
    expect(handles.some((handle) => 'shape' in handle && handle.shape === 'tracker')).toBe(false)
    expect(depthHandle?.kind).toBe('linear-resize')
    if (depthHandle?.kind !== 'linear-resize') throw new Error('Missing slab depth handle')
    expect(depthHandle.currentValue(slab)).toBe(-0.2)
    expect(depthHandle.apply(slab, -0.35, {} as never)).toEqual({
      elevation: -0.35,
      recessed: true,
    })
  })
})
