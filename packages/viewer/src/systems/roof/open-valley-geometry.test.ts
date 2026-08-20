import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { buildOpenValleyGeometry } from './open-valley-geometry'

describe('buildOpenValleyGeometry', () => {
  test('builds finite indexed pan geometry for a roof junction', () => {
    const first = RoofSegmentNode.parse({
      id: 'rseg_first',
      type: 'roof-segment',
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 3,
      pitch: 30,
    })
    const second = RoofSegmentNode.parse({
      id: 'rseg_second',
      type: 'roof-segment',
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 3,
      pitch: 30,
      position: [2.5, 0, 2.5],
      rotation: Math.PI / 2,
    })

    const geometry = buildOpenValleyGeometry([first, second], 0.35)
    const position = geometry.getAttribute('position')

    expect(position.count).toBeGreaterThan(0)
    expect(geometry.getIndex()?.count).toBeGreaterThan(0)
    for (const value of position.array) expect(value).toBeFinite()
    geometry.dispose()
  })

  test('returns a render-safe placeholder when no valley exists', () => {
    const first = RoofSegmentNode.parse({ id: 'rseg_first', type: 'roof-segment' })
    const second = RoofSegmentNode.parse({
      id: 'rseg_second',
      type: 'roof-segment',
      position: [20, 0, 0],
    })

    const geometry = buildOpenValleyGeometry([first, second], 0.35)

    expect(geometry.getAttribute('position').count).toBe(3)
    expect(geometry.getAttribute('normal').count).toBe(3)
    expect(geometry.getIndex()?.count).toBe(3)
    geometry.dispose()
  })
})
