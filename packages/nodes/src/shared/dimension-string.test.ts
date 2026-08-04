import { describe, expect, test } from 'bun:test'
import { buildDimensionStringGeometry } from './dimension-string'

describe('buildDimensionStringGeometry', () => {
  test('expands a logical dimension string into renderable dimension segments', () => {
    const geometry = buildDimensionStringGeometry({
      offsetNormal: [0, 1],
      offsetDistance: 0,
      extensionStartGap: 0.04,
      extensionOvershoot: 0.12,
      terminator: 'dot',
      textPosition: 'centered',
      stroke: '#334155',
      segments: [
        {
          witnessStart: [0, 0],
          witnessEnd: [2, 0],
          dimensionStart: [0, 1],
          dimensionEnd: [2, 1],
          text: '2m',
        },
        {
          witnessStart: [2, 0],
          witnessEnd: [5, 0],
          dimensionStart: [2, 1],
          dimensionEnd: [5, 1],
          text: '3m',
        },
      ],
    })

    expect(geometry).toEqual(
      expect.objectContaining({
        kind: 'dimension-string',
        offsetNormal: [0, 1],
        offsetDistance: 0,
        extensionStartGap: 0.04,
        extensionOvershoot: 0.12,
        terminator: 'dot',
        textPosition: 'centered',
        stroke: '#334155',
        segments: [
          {
            start: [0, 0],
            end: [2, 0],
            dimensionStart: [0, 1],
            dimensionEnd: [2, 1],
            text: '2m',
          },
          {
            start: [2, 0],
            end: [5, 0],
            dimensionStart: [2, 1],
            dimensionEnd: [5, 1],
            text: '3m',
          },
        ],
      }),
    )
  })
})
