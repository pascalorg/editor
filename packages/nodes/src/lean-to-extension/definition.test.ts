import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type HandleDescriptor,
  type LeanToExtensionNode,
  LeanToExtensionNode as LeanToExtensionNodeSchema,
  type LinearResizeHandle,
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
  axis: 'x' | 'z',
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

  test('places projection arrow at the same low roof edge height', () => {
    const leanTo = node()
    const layout = resolveLeanToLayout(leanTo)

    expect(linearHandle('z', 'min').placement.position(leanTo, undefined as never)).toEqual([
      0,
      layout.lowEdgeHeight + 0.25,
      leanTo.projection,
    ])
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

    const preview = new Map(
      spanHandle('min').previewOverrides?.(leanTo, 6, { nodes: () => nodes } as never) ?? [],
    )

    expect(preview.get('rseg_test' as never)).toMatchObject({
      roofType: 'shed',
      width: 6 + leanTo.leftOverhang + leanTo.rightOverhang,
    })
  })
})
