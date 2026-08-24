import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import { buildRoofSegmentFloorplan, getRoofSegmentPlanLinework } from './floorplan'

function dutchSegment(overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return {
    object: 'node',
    id: 'rseg_test',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'dutch',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pitch: 40,
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

describe('getRoofSegmentPlanLinework', () => {
  test('renders conical selection and hit chrome as a circle', () => {
    const roof = RoofNode.parse({ id: 'roof_test', children: ['rseg_test'] })
    const node = dutchSegment({
      parentId: roof.id,
      roofType: 'conical',
      width: 6,
      depth: 6,
    })
    const geometry = buildRoofSegmentFloorplan(node, {
      parent: roof,
      viewState: { selected: true },
    } as GeometryContext) as Extract<FloorplanGeometry, { kind: 'group' }>

    expect(geometry.kind).toBe('group')
    expect(geometry.children.filter((child) => child.kind === 'circle')).toHaveLength(2)
    expect(geometry.children.some((child) => child.kind === 'polygon')).toBe(false)
    expect(geometry.children.some((child) => child.kind === 'rotate-arrow')).toBe(false)
    const resizeArrows = geometry.children.filter((child) => child.kind === 'move-arrow')
    expect(resizeArrows).toHaveLength(1)
    expect(resizeArrows[0]).toMatchObject({ payload: { mode: 'radial' } })
    expect(getRoofSegmentPlanLinework(node)).toEqual({
      ridges: [],
      hips: [],
      breaks: [],
      slope: null,
    })
  })

  test('draws a dutch width-axis upper ridge plus waist linework', () => {
    const linework = getRoofSegmentPlanLinework(dutchSegment())

    expect(linework.ridges).toEqual([
      [
        [-2.5, 0],
        [2.5, 0],
      ],
    ])
    expect(linework.breaks).toEqual([
      [
        [-2.5, 1.5],
        [2.5, 1.5],
      ],
      [
        [2.5, 1.5],
        [2.5, -1.5],
      ],
      [
        [2.5, -1.5],
        [-2.5, -1.5],
      ],
      [
        [-2.5, -1.5],
        [-2.5, 1.5],
      ],
    ])
    expect(linework.hips).toContainEqual([
      [-4, 3],
      [-2.5, 1.5],
    ])
    expect(linework.hips).toContainEqual([
      [4, 3],
      [2.5, 1.5],
    ])
  })

  test('draws a dutch depth-axis upper ridge when the depth exceeds the width', () => {
    const linework = getRoofSegmentPlanLinework(dutchSegment({ width: 6, depth: 8 }))

    expect(linework.ridges).toEqual([
      [
        [0, 2.5],
        [0, -2.5],
      ],
    ])
    expect(linework.breaks).toEqual([
      [
        [-1.5, 2.5],
        [1.5, 2.5],
      ],
      [
        [1.5, 2.5],
        [1.5, -2.5],
      ],
      [
        [1.5, -2.5],
        [-1.5, -2.5],
      ],
      [
        [-1.5, -2.5],
        [-1.5, 2.5],
      ],
    ])
    expect(linework.hips).toContainEqual([
      [-3, 4],
      [-1.5, 2.5],
    ])
    expect(linework.hips).toContainEqual([
      [3, -4],
      [1.5, -2.5],
    ])
  })

  test('shortens dutch waist length along the ridge axis', () => {
    const linework = getRoofSegmentPlanLinework(dutchSegment({ dutchWaistLengthRatio: 0.5 }))

    expect(linework.ridges).toEqual([
      [
        [-1.25, 0],
        [1.25, 0],
      ],
    ])
    expect(linework.breaks).toEqual([
      [
        [-1.25, 1.5],
        [1.25, 1.5],
      ],
      [
        [1.25, 1.5],
        [1.25, -1.5],
      ],
      [
        [1.25, -1.5],
        [-1.25, -1.5],
      ],
      [
        [-1.25, -1.5],
        [-1.25, 1.5],
      ],
    ])
  })
})
