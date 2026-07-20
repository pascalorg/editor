import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

describe('FloorplanGeometryRenderer static labels', () => {
  test('renders a measurement value together with its geometry', () => {
    const geometry = {
      kind: 'group',
      children: [
        { kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0, stroke: '#334155' },
        {
          kind: 'dimension-label',
          appearance: 'outlined',
          cx: 1,
          cy: 0,
          text: '2.00m',
          angle: 0,
          offsetPx: 14,
        },
      ],
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} />
      </svg>,
    )

    expect(markup).toContain('<line')
    expect(markup).toContain('2.00m')
    expect(markup).toContain('translate(0 -0.14)')
  })

  test('keeps screen-upright measurement labels readable in rotated exports', () => {
    const geometry = {
      kind: 'dimension-label',
      appearance: 'outlined',
      cx: 1,
      cy: 2,
      text: 'A 6.0m²',
      angle: Math.PI / 3,
      screenUpright: true,
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} sceneRotationDeg={90} />
      </svg>,
    )

    expect(markup).toContain('A 6.0m²')
    expect(markup).toContain('rotate(-90)')
  })

  test('uses paper-point sizing when document scale is provided', () => {
    const geometry = {
      kind: 'dimension-label',
      appearance: 'outlined',
      cx: 1,
      cy: 2,
      text: '2.00m',
      angle: 0,
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer annotationUnitsPerPoint={0.01} geometry={geometry} />
      </svg>,
    )

    expect(markup).toContain('font-size="0.08"')
  })

  test('registers fixed mark pills as annotation obstacles', () => {
    const geometry = {
      kind: 'group',
      children: [
        { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0.4 },
        { kind: 'rect', x: -0.2, y: 0.4, width: 0.4, height: 0.32 },
        { kind: 'text', x: 0, y: 0.56, text: '107', fontSize: 0.15, upright: true },
      ],
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-annotation-obstacle=""')
  })

  test('registers semantic plan primitives as annotation obstacles', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer
          geometry={{
            kind: 'polygon',
            points: [
              [0, 0],
              [4, 0],
              [4, 0.2],
            ],
            annotationObstacle: 'outline',
          }}
        />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-annotation-obstacle="outline"')
  })
})
