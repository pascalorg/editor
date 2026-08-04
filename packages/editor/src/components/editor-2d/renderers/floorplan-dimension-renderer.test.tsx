import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  computeArchitecturalDimensionLayout,
  FloorplanDimensionRenderer,
  FloorplanDimensionStringRenderer,
  floorplanDimensionAnnotationPriority,
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
    expect(layout?.dimensionLineEnd).toEqual([4, 0.45])
    expect(layout?.labelPlacement).toBe('inside')
  })

  test('builds consistent 45-degree architectural slash terminators', () => {
    const layout = computeArchitecturalDimensionLayout(dimension, 0)

    expect(layout?.tickHalfVector[0]).toBeCloseTo(0.06364, 5)
    expect(layout?.tickHalfVector[1]).toBeCloseTo(-0.06364, 5)
  })

  test('honors dimension standard overrides for gaps, terminators, and text placement', () => {
    const customDimension = {
      ...dimension,
      extensionStartGap: 0.2,
      terminator: 'dot',
      textPosition: 'centered',
    } satisfies Extract<FloorplanGeometry, { kind: 'dimension' }>
    const layout = computeArchitecturalDimensionLayout(customDimension, 0)
    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionRenderer geometry={customDimension} />
      </svg>,
    )

    expect(layout?.extensionStart).toEqual([0, 0.2])
    expect(markup).toContain('<circle')
    expect(markup).toContain('y="0.0525"')
  })

  test('moves a short value beyond its end tick and extends the dimension line', () => {
    const shortDimension = {
      ...dimension,
      end: [0.23, 0] as [number, number],
      text: '0.23m',
    }
    const layout = computeArchitecturalDimensionLayout(shortDimension, 0)

    expect(layout?.labelPlacement).toBe('outside-end')
    expect(layout?.labelPoint[0]).toBeGreaterThan(0.23)
    expect(layout?.outsideStartLabelPoint?.[0]).toBeLessThan(0)
    expect(layout?.outsideStartDimensionLineStart?.[0]).toBeLessThan(
      layout?.outsideStartLabelPoint?.[0] ?? 0,
    )
    expect(layout?.dimensionLineEnd[0]).toBeGreaterThan(layout?.labelPoint[0] ?? 0)
    expect(layout?.dimensionEnd).toEqual([0.23, 0.45])

    const documentLayout = computeArchitecturalDimensionLayout(shortDimension, 0, 0.01)
    expect(documentLayout?.labelPlacement).toBe('outside-end')
    expect(documentLayout?.dimensionLineEnd[0]).toBeGreaterThan(documentLayout?.labelPoint[0] ?? 0)

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionRenderer geometry={shortDimension} sceneRotationDeg={37} />
      </svg>,
    )
    expect(markup).toContain('data-floorplan-dimension-outside-start-local-x=')
    expect(markup).not.toContain('data-floorplan-dimension-leader=""')

    const documentMarkup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionRenderer
          annotationUnitsPerPoint={0.01}
          geometry={shortDimension}
          sceneRotationDeg={37}
        />
      </svg>,
    )
    expect(documentMarkup).toContain('data-floorplan-dimension-leader=""')
    expect(documentMarkup).toContain('visibility="hidden"')
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
    expect(markup).toContain('paint-order="stroke"')
    expect(markup).toContain('stroke="#ffffff"')
    expect(markup).toContain('data-floorplan-annotation-priority="145"')
  })

  test('keeps farther-out architectural strings fixed before inner strings', () => {
    expect(floorplanDimensionAnnotationPriority(1.67)).toBeGreaterThan(
      floorplanDimensionAnnotationPriority(0.55),
    )
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

  test('uses PDF-safe label plates and hairline measurement strokes for export', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionRenderer geometry={dimension} renderMode="pdf" />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-dimension-label-plate=""')
    expect(markup).toContain('stroke-width="0.5"')
    expect(markup).not.toContain('paint-order="stroke"')
    expect(markup).not.toContain('stroke="#ffffff"')
  })

  test('renders a dimension string with shared witness extension lines and ticks', () => {
    const stringGeometry = {
      kind: 'dimension-string',
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
      offsetNormal: [0, 1],
      offsetDistance: 1,
      extensionOvershoot: 0.12,
      textPosition: 'above',
    } satisfies Extract<FloorplanGeometry, { kind: 'dimension-string' }>

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionStringRenderer geometry={stringGeometry} />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-dimension-string=""')
    expect(markup.match(/<line/g)).toHaveLength(8)
    expect(markup).toContain('2m')
    expect(markup).toContain('3m')
  })

  test('offsets automatic dimension-string lines when no explicit baseline is supplied', () => {
    const automaticString = {
      kind: 'dimension-string',
      segments: [{ start: [0, 0], end: [2, 0], text: '2m' }],
      offsetNormal: [0, 1],
      offsetDistance: 0.55,
      extensionOvershoot: 0.12,
      textPosition: 'above',
    } satisfies Extract<FloorplanGeometry, { kind: 'dimension-string' }>

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanDimensionStringRenderer geometry={automaticString} />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-dimension-default-y1="0.55"')
    expect(markup).toContain('data-floorplan-dimension-default-y2="0.55"')
  })
})
