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
})
