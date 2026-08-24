import { describe, expect, test } from 'bun:test'
import {
  getActiveRoofHeight,
  type HandleDescriptor,
  type LinearResizeHandle,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { roofSegmentDefinition } from './definition'

function segment(overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return {
    object: 'node',
    id: 'rseg_test',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [10, 0, 20],
    rotation: 0,
    roofType: 'shed',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pitch: 30,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    gambrelLowerWidthRatio: 0.5,
    gambrelLowerHeightRatio: 0.6,
    mansardSteepWidthRatio: 0.15,
    mansardSteepHeightRatio: 0.7,
    dutchHipWidthRatio: 0.25,
    dutchHipHeightRatio: 0.5,
    dutchWaistLengthRatio: 1,
    children: [],
    ...overrides,
  } as RoofSegmentNode
}

function handles(node: RoofSegmentNode = segment()): HandleDescriptor<RoofSegmentNode>[] {
  const descriptors = roofSegmentDefinition.handles
  return (
    typeof descriptors === 'function' ? descriptors(node, undefined as never) : descriptors
  ) as HandleDescriptor<RoofSegmentNode>[]
}

function linear(axis: 'x' | 'z', anchor: 'min' | 'max'): LinearResizeHandle<RoofSegmentNode> {
  const handle = handles().find(
    (h): h is LinearResizeHandle<RoofSegmentNode> =>
      h.kind === 'linear-resize' && h.axis === axis && h.anchor === anchor,
  )
  if (!handle) throw new Error(`Missing ${axis}/${anchor} handle`)
  return handle
}

function pitchHandle(): LinearResizeHandle<RoofSegmentNode> {
  const handle = handles().find(
    (h): h is LinearResizeHandle<RoofSegmentNode> =>
      h.kind === 'linear-resize' && h.axis === 'y' && typeof h.min === 'function',
  )
  if (!handle) throw new Error('Missing pitch handle')
  return handle
}

describe('roof-segment resize handles', () => {
  test('keeps conical diameter circular and omits rotation', () => {
    const node = segment({ roofType: 'conical', width: 6, depth: 6 })
    const conicalHandles = handles(node)
    const widthHandle = conicalHandles.find(
      (handle): handle is LinearResizeHandle<RoofSegmentNode> =>
        handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === 'min',
    )
    const depthHandle = conicalHandles.find(
      (handle): handle is LinearResizeHandle<RoofSegmentNode> =>
        handle.kind === 'linear-resize' && handle.axis === 'z' && handle.anchor === 'min',
    )

    expect(widthHandle?.apply(node, 8, undefined as never)).toMatchObject({ width: 8, depth: 8 })
    expect(depthHandle?.apply(node, 9, undefined as never)).toMatchObject({ width: 9, depth: 9 })
    expect(conicalHandles.some((handle) => handle.kind === 'arc-resize')).toBe(false)
  })

  test('place shed side handles at roof level', () => {
    const node = segment()
    const roofHeight = getActiveRoofHeight(node)

    expect(linear('x', 'min').placement.position(node, undefined as never)[1]).toBeCloseTo(
      node.wallHeight + roofHeight / 2 + 0.15,
    )
    expect(linear('z', 'min').placement.position(node, undefined as never)[1]).toBeCloseTo(
      node.wallHeight + 0.15,
    )
    expect(linear('z', 'max').placement.position(node, undefined as never)[1]).toBeCloseTo(
      node.wallHeight + roofHeight + 0.15,
    )
  })

  test('right and left width handles resize only the dragged side', () => {
    const node = segment()
    const rightPatch = linear('x', 'min').apply(node, 10, undefined as never)
    const leftPatch = linear('x', 'max').apply(node, 10, undefined as never)

    expect(rightPatch).toMatchObject({ width: 10, position: [11, 0, 20] })
    expect(leftPatch).toMatchObject({ width: 10, position: [9, 0, 20] })
  })

  test('front and back depth handles resize only the dragged side', () => {
    const node = segment()
    const frontPatch = linear('z', 'min').apply(node, 8, undefined as never)
    const backPatch = linear('z', 'max').apply(node, 8, undefined as never)

    expect(frontPatch).toMatchObject({ depth: 8, position: [10, 0, 21] })
    expect(backPatch).toMatchObject({ depth: 8, position: [10, 0, 19] })
  })

  test('hides the pitch handle for managed lean-to roof segments', () => {
    const handle = pitchHandle()
    const managed = segment({
      metadata: {
        managedByLeanTo: 'lean_to_test',
        leanToRole: 'roof-segment',
      },
    })

    expect(handle.visible?.(segment(), undefined as never)).not.toBe(false)
    expect(handle.visible?.(managed, undefined as never)).toBe(false)
  })

  test('hides all direct handles for managed lean-to roof segments', () => {
    expect(
      handles(
        segment({
          metadata: {
            managedByLeanTo: 'lean_to_test',
            leanToRole: 'roof-segment',
          },
        }),
      ),
    ).toEqual([])
  })
})
