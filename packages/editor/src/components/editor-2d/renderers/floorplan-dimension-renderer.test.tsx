import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  computeArchitecturalDimensionLayout,
  FloorplanDimensionRenderer,
} from './floorplan-dimension-renderer'

const dimension = {
  kind: 'dimension',
  start: [0, 0],
  end: [4, 0],
  offsetNormal: [0, 1],
  offsetDistance: 0.45,
  extensionOvershoot: 0.12,
  text: `13'-1 1/2"`,
} satisfies Extract<FloorplanGeometry, { kind: 'dimension' }>

describe('architectural floor-plan dimensions', () => {
  test('leaves a paper-space gap before solid extension lines', () => {
    const layout = computeArchitecturalDimensionLayout(dimension, 0)

    expect(layout).not.toBeNull()
    expect(layout?.extensionStart).toEqual([0, 0.075])
    expect(layout?.extensionEnd).toEqual([4, 0.075])
    expect(layout?.extensionStartTip[0]).toBe(0)
    expect(layout?.extensionStartTip[1]).toBeCloseTo(0.57)
    expect(layout?.extensionEndTip[0]).toBe(4)
    expect(layout?.extensionEndTip[1]).toBeCloseTo(0.57)
    expect(layout?.dimensionStart).toEqual([0, 0.45])
    expect(layout?.dimensionEnd).toEqual([4, 0.45])
  })

  test('builds consistent 45-degree architectural slash terminators', () => {
    const layout = computeArchitecturalDimensionLayout(dimension, 0)

    expect(layout?.tickHalfVector[0]).toBeCloseTo(0.06364, 5)
    expect(layout?.tickHalfVector[1]).toBeCloseTo(-0.06364, 5)
  })

  test('aligns stepped feature origins to an explicit exterior baseline', () => {
    const layout = computeArchitecturalDimensionLayout(
      {
        ...dimension,
        start: [0, 0],
        end: [4, 1],
        dimensionStart: [0, 2],
        dimensionEnd: [4, 2],
        offsetDistance: 2,
      },
      0,
    )

    expect(layout?.dimensionStart).toEqual([0, 2])
    expect(layout?.dimensionEnd).toEqual([4, 2])
    expect(layout?.extensionStart).toEqual([0, 0.075])
    expect(layout?.extensionEnd).toEqual([4, 1.075])
    expect(layout?.extensionStartTip).toEqual([0, 2.12])
    expect(layout?.extensionEndTip).toEqual([4, 2.12])
  })

  test('renders one uninterrupted line with the label above it', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionRenderer geometry={dimension} />
      </svg>,
    )

    expect(markup.match(/<line/g)).toHaveLength(5)
    expect(markup).not.toContain('stroke-dasharray')
    expect(markup).toContain('y="-0.12"')
    expect(markup).toContain('13&#x27;-1 1/2&quot;')
  })

  test('keeps labels readable after the scene rotates', () => {
    expect(computeArchitecturalDimensionLayout(dimension, 180)?.labelAngleDeg).toBe(-180)
  })

  test('resolves document annotation sizes from paper points', () => {
    const layout = computeArchitecturalDimensionLayout(dimension, 0, 0.01)
    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionRenderer annotationUnitsPerPoint={0.01} geometry={dimension} />
      </svg>,
    )

    expect(layout?.extensionStart[1]).toBeCloseTo(0.03)
    expect(layout?.extensionStartTip[1]).toBeCloseTo(0.49)
    expect(markup).toContain('font-size="0.08"')
    expect(markup).toContain('y="-0.05"')
  })
})
