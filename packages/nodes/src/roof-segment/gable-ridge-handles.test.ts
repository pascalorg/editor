import { describe, expect, test } from 'bun:test'
import { getGableRidge, type LinearResizeHandle, RoofSegmentNode } from '@pascal-app/core'
import { roofSegmentDefinition } from './definition'

const gable = (extra: Partial<RoofSegmentNode> = {}) =>
  RoofSegmentNode.parse({
    type: 'roof-segment',
    roofType: 'gable',
    width: 10,
    depth: 10,
    wallHeight: 0.8,
    pitch: 25,
    backPitch: 15,
    ridgeOffset: 4,
    ...extra,
  })

type Handle = LinearResizeHandle<RoofSegmentNode>
const sceneApi = {} as never

function ridgeHandles(node: RoofSegmentNode) {
  const handles = (roofSegmentDefinition.handles as (n: RoofSegmentNode) => Handle[])(node)
  const ridge = getGableRidge(node)!
  const height = handles.find(
    (h) => h.kind === 'linear-resize' && h.axis === 'y' && h.currentValue(node) === ridge.height,
  )
  const position = handles.find(
    (h) => h.kind === 'linear-resize' && h.axis === 'z' && h.currentValue(node) === ridge.ridgeZ,
  )
  return { height, position }
}

describe('gable ridge handles', () => {
  test('lifting the ridge raises the whole roof; the angles hold', () => {
    const node = gable()
    const { height } = ridgeHandles(node)
    const before = getGableRidge(node)!
    const after = getGableRidge({ ...node, ...height!.apply(node, before.height + 0.5, sceneApi) })!
    expect(after.height).toBeCloseTo(before.height + 0.5, 9)
    expect(after.frontPitch).toBe(25)
    expect(after.backPitch).toBe(15)
  })

  test('sliding the ridge moves it across the depth at the same height', () => {
    const node = gable()
    const { position } = ridgeHandles(node)
    const before = getGableRidge(node)!
    const after = getGableRidge({ ...node, ...position!.apply(node, 0, sceneApi) })!
    expect(after.ridgeZ).toBeCloseTo(0, 9)
    expect(after.height).toBeCloseTo(before.height, 9)
  })

  test('a locked ridge hides both handles', () => {
    const node = gable({ metadata: { gableLocks: { ridge: true } } })
    const { height, position } = ridgeHandles(node)
    expect(height!.visible!(node, sceneApi)).toBe(false)
    expect(position!.visible!(node, sceneApi)).toBe(false)
  })
})
