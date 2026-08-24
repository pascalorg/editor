import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type HandleDescriptor,
  type LeanToExtensionNode,
  LeanToExtensionNode as LeanToExtensionNodeSchema,
  type LinearResizeHandle,
  WallNode,
} from '@pascal-app/core'
import { leanToExtensionDefinition } from './definition'
import { resolveLeanToLayout } from './layout'

function node(overrides: Partial<LeanToExtensionNode> = {}): LeanToExtensionNode {
  return LeanToExtensionNodeSchema.parse({
    id: 'leanto_test',
    parentId: 'wall_test',
    position: [6, 0, 0.05],
    span: 4,
    projection: 3,
    autoSpan: true,
    ...overrides,
  })
}

function handles(): HandleDescriptor<LeanToExtensionNode>[] {
  const descriptors = leanToExtensionDefinition.handles
  if (!Array.isArray(descriptors)) throw new Error('Expected static lean-to handles')
  return descriptors as HandleDescriptor<LeanToExtensionNode>[]
}

function linearHandle(
  axis: 'x' | 'y' | 'z',
  anchor: 'min' | 'max',
): LinearResizeHandle<LeanToExtensionNode> {
  const handle = handles().find(
    (h): h is LinearResizeHandle<LeanToExtensionNode> =>
      h.kind === 'linear-resize' && h.axis === axis && h.anchor === anchor,
  )
  if (!handle) throw new Error(`Missing ${axis}/${anchor} handle`)
  return handle
}

function spanHandle(anchor: 'min' | 'max'): LinearResizeHandle<LeanToExtensionNode> {
  return linearHandle('x', anchor)
}

function heightHandle(): LinearResizeHandle<LeanToExtensionNode> {
  return linearHandle('y', 'min')
}

function pitchHandle(): LinearResizeHandle<LeanToExtensionNode> {
  const handle = handles().find(
    (candidate): candidate is LinearResizeHandle<LeanToExtensionNode> =>
      candidate.kind === 'linear-resize' &&
      candidate.axis === 'y' &&
      typeof candidate.min === 'function',
  )
  if (!handle) throw new Error('Missing pitch handle')
  return handle
}

describe('lean-to extension span handles', () => {
  test('exposes right and left span arrows on the whole extension', () => {
    expect(spanHandle('min').placement.rotationY?.(node(), undefined as never)).toBe(0)
    expect(spanHandle('max').placement.rotationY?.(node(), undefined as never)).toBe(Math.PI)
  })

  test('places span arrows at the low roof edge height', () => {
    const leanTo = node()
    const layout = resolveLeanToLayout(leanTo)

    expect(spanHandle('min').placement.position(leanTo, undefined as never)).toEqual([
      leanTo.span / 2 + 0.3,
      layout.lowEdgeHeight + 0.25,
      leanTo.projection,
    ])
    expect(spanHandle('max').placement.position(leanTo, undefined as never)).toEqual([
      -(leanTo.span / 2 + 0.3),
      layout.lowEdgeHeight + 0.25,
      leanTo.projection,
    ])
  })

  test('hides host-controlled span and height arrows on a closed conical loop', () => {
    const circular = node({ hostKind: 'conical-roof' })

    expect(spanHandle('min').visible?.(circular, undefined as never)).toBe(false)
    expect(spanHandle('max').visible?.(circular, undefined as never)).toBe(false)
    expect(heightHandle().visible?.(circular, undefined as never)).toBe(false)
  })

  test('places projection arrow at the same low roof edge height', () => {
    const leanTo = node()
    const layout = resolveLeanToLayout(leanTo)

    expect(linearHandle('z', 'min').placement.position(leanTo, undefined as never)).toEqual([
      0,
      layout.lowEdgeHeight + 0.25,
      leanTo.projection,
    ])
  })

  test('places an upward pitch arrow beyond the front eave', () => {
    const leanTo = node({ lowOverhang: 0.25 })
    const layout = resolveLeanToLayout(leanTo)
    const handle = pitchHandle()

    expect(handle.axis).toBe('y')
    expect(handle.placement.position(leanTo, undefined as never)).toEqual([
      0,
      layout.lowEdgeHeight + 0.25,
      leanTo.projection + leanTo.lowOverhang + 0.3,
    ])
  })

  test('changes pitch from the front edge while keeping the wall edge fixed', () => {
    const leanTo = node({ highEdgeHeight: 3.2, pitch: 12 })
    const handle = pitchHandle()
    const currentLowEdge = handle.currentValue(leanTo)
    const flatter = handle.apply(leanTo, currentLowEdge + 0.25, undefined as never)
    const steeper = handle.apply(leanTo, currentLowEdge - 0.25, undefined as never)

    expect(flatter.highEdgeHeight).toBeUndefined()
    expect(steeper.highEdgeHeight).toBeUndefined()
    expect(flatter.pitch).toBeLessThan(leanTo.pitch)
    expect(steeper.pitch).toBeGreaterThan(leanTo.pitch)
    expect(flatter.lowEdgeHeight).toBeCloseTo(currentLowEdge + 0.25)
    expect(steeper.lowEdgeHeight).toBeCloseTo(currentLowEdge - 0.25)
  })

  test('resizes span only from the dragged side', () => {
    const leanTo = node()

    expect(spanHandle('min').apply(leanTo, 6, undefined as never)).toMatchObject({
      span: 6,
      autoSpan: false,
      position: [7, 0, 0.05],
    })
    expect(spanHandle('max').apply(leanTo, 6, undefined as never)).toMatchObject({
      span: 6,
      autoSpan: false,
      position: [5, 0, 0.05],
    })
  })

  test('resizes span from the visual side when placed on the opposite wall face', () => {
    const leanTo = node({ rotation: [0, Math.PI, 0], position: [6, 0, -0.05] })

    expect(spanHandle('min').apply(leanTo, 6, undefined as never)).toMatchObject({
      span: 6,
      autoSpan: false,
      position: [5, 0, -0.05],
    })
    expect(spanHandle('max').apply(leanTo, 6, undefined as never)).toMatchObject({
      span: 6,
      autoSpan: false,
      position: [7, 0, -0.05],
    })
  })

  test('snaps a resized side to the wall end and aligns with the neighboring roof plane', () => {
    const wall = WallNode.parse({
      id: 'wall_resize_left',
      parentId: 'level_test',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_resize_right',
      parentId: 'level_test',
      start: [5, 0],
      end: [10, 0],
    })
    const moving = node({
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      highEdgeHeight: 2.8,
      pitch: 8,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNodeSchema.parse({
      id: 'leanto_resize_neighbor',
      parentId: adjacentWall.id,
      position: [1, 0, 0.05],
      span: 2,
      highEdgeHeight: 3.4,
      pitch: 12,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<string, AnyNode>
    const sceneApi = {
      get: (id: string) => nodes[id],
      nodes: () => nodes,
    } as never
    const handle = spanHandle('min')

    const snappedSpan = handle.connectionSnap?.(moving, 3.85, sceneApi)
    expect(snappedSpan).toBe(4)
    expect(handle.apply(moving, snappedSpan ?? 3.85, sceneApi)).toMatchObject({
      span: 4,
      position: [3, 0, 0.05],
      highEdgeHeight: 3.4,
      pitch: 12,
      autoSpan: false,
    })
    expect(typeof handle.max === 'function' ? handle.max(moving, sceneApi) : handle.max).toBe(4)
  })

  test('previews managed roof-segment span while dragging', () => {
    const leanTo = node({ children: ['roof_test' as never] })
    const nodes = {
      [leanTo.id]: leanTo,
      roof_test: {
        id: 'roof_test',
        type: 'roof',
        parentId: leanTo.id,
        metadata: { managedByLeanTo: leanTo.id, leanToRole: 'roof' },
        children: ['rseg_test'],
      },
      rseg_test: {
        id: 'rseg_test',
        type: 'roof-segment',
        parentId: 'roof_test',
        metadata: { managedByLeanTo: leanTo.id, leanToRole: 'roof-segment' },
        children: [],
      },
    } as unknown as Record<string, AnyNode>
    const sceneApi = { get: (id: string) => nodes[id], nodes: () => nodes } as never

    const preview = new Map(spanHandle('min').previewOverrides?.(leanTo, 6, sceneApi) ?? [])

    expect(preview.get('rseg_test' as never)).toMatchObject({
      roofType: 'shed',
      width: 6 + leanTo.leftOverhang + leanTo.rightOverhang,
    })
  })

  test('previews the managed roof at the in-flight wall-side height', () => {
    const leanTo = node({ children: ['roof_test' as never], highEdgeHeight: 2.8 })
    const nodes = {
      [leanTo.id]: leanTo,
      roof_test: {
        id: 'roof_test',
        type: 'roof',
        parentId: leanTo.id,
        metadata: { managedByLeanTo: leanTo.id, leanToRole: 'roof' },
        children: ['rseg_test'],
      },
      rseg_test: {
        id: 'rseg_test',
        type: 'roof-segment',
        parentId: 'roof_test',
        metadata: { managedByLeanTo: leanTo.id, leanToRole: 'roof-segment' },
        children: [],
      },
    } as unknown as Record<string, AnyNode>
    const sceneApi = { get: (id: string) => nodes[id], nodes: () => nodes } as never

    const initialPreview = new Map(heightHandle().previewOverrides?.(leanTo, 2.8, sceneApi) ?? [])
    const raisedPreview = new Map(heightHandle().previewOverrides?.(leanTo, 3.4, sceneApi) ?? [])
    const initialPosition = initialPreview.get('rseg_test' as never)?.position
    const raisedPosition = raisedPreview.get('rseg_test' as never)?.position

    expect(initialPosition).toBeDefined()
    expect(raisedPosition?.[1] - initialPosition?.[1]).toBeCloseTo(0.6)
  })

  test('connects the high edge with an adjacent lean-to', () => {
    const wall = WallNode.parse({
      id: 'wall_left',
      parentId: 'level_test',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_right',
      parentId: 'level_test',
      start: [5, 0],
      end: [10, 0],
    })
    const moving = node({
      parentId: wall.id,
      position: [4, 0, 0.05],
      span: 2,
      highEdgeHeight: 2.8,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNodeSchema.parse({
      id: 'leanto_adjacent',
      parentId: adjacentWall.id,
      position: [1, 0, 0.05],
      span: 2,
      highEdgeHeight: 3.4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<string, AnyNode>
    const sceneApi = {
      get: (id: string) => nodes[id],
      nodes: () => nodes,
    } as never

    const snap = heightHandle().connectionSnap
    expect(snap?.(moving, 3.34, sceneApi)).toBe(3.4)
    expect(snap?.(moving, 3.6, sceneApi)).toBe(3.6)
    expect(snap?.({ ...moving, position: [2, 0, 0.05] }, 3.34, sceneApi)).toBe(3.34)
  })
})
