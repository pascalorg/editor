import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { floorplanGeometryMetadata } from '../../../lib/floorplan/floorplan-extension'
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

  test('uses live screen sizing without enabling document annotation styles', () => {
    const geometry = {
      kind: 'group',
      children: [
        {
          kind: 'text',
          x: 0,
          y: 0,
          text: 'LIVE TEXT',
          fontSize: 0.16,
          upright: true,
        },
        {
          kind: 'dimension-label',
          appearance: 'outlined',
          cx: 1,
          cy: 2,
          text: '2.00m',
          angle: 0,
          offsetPx: 14,
        },
      ],
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} screenUnitsPerPixel={0.02} />
      </svg>,
    )

    expect(markup).toContain('font-size="0.16"')
    expect(markup).toContain('font-size="0.24"')
    expect(markup).toContain('translate(0 -0.28)')
  })

  test('renders outlined measurement labels as PDF-safe dark text on a white plate', () => {
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
        <FloorplanGeometryRenderer
          geometry={geometry}
          renderMode="pdf"
          screenUnitsPerPixel={0.02}
        />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-dimension-label-plate=""')
    expect(markup).toContain('fill="#111827"')
    expect(markup).not.toContain('paint-order="stroke"')
    expect(markup).not.toContain('fill="#ffffff" font-family=')
  })

  test('caps PDF annotation linework without changing live stroke widths', () => {
    const geometry = {
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 2,
      y2: 0,
      stroke: '#334155',
      strokeWidth: 2,
      vectorEffect: 'non-scaling-stroke',
    } satisfies FloorplanGeometry

    const liveMarkup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} />
      </svg>,
    )
    const pdfMarkup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} renderMode="pdf" />
      </svg>,
    )

    expect(liveMarkup).toContain('stroke-width="2"')
    expect(pdfMarkup).toContain('stroke-width="0.5"')
  })

  test('removes unsupported paint-order outlines from generic PDF text', () => {
    const geometry = {
      kind: 'text',
      x: 1,
      y: 2,
      text: '101',
      fontSize: 0.15,
      fill: '#ffffff',
      stroke: '#334155',
      strokeWidth: 0.04,
      paintOrder: 'stroke',
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} renderMode="pdf" />
      </svg>,
    )

    expect(markup).toContain('fill="#334155"')
    expect(markup).not.toContain('paint-order')
    expect(markup).not.toContain('stroke=')
  })

  test('resolves generic annotation text from paper points only in document mode', () => {
    const geometry = {
      kind: 'text',
      x: 2,
      y: 3,
      text: 'VERIFY DIMENSIONS',
      fontSize: 0.16,
      upright: true,
    } satisfies FloorplanGeometry

    const liveMarkup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={geometry} />
      </svg>,
    )
    const documentMarkup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer annotationUnitsPerPoint={0.01} geometry={geometry} />
      </svg>,
    )

    expect(liveMarkup).toContain('font-size="0.16"')
    expect(documentMarkup).toContain('font-size="0.08"')
  })

  test('uses a room-label paper profile while preserving room label hierarchy', () => {
    const geometry = {
      kind: 'group',
      children: [
        {
          kind: 'text',
          x: 0,
          y: 0,
          text: 'KITCHEN',
          fontSize: 0.2,
          metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
          upright: true,
        },
        {
          kind: 'text',
          x: 0,
          y: 0.18,
          text: '101',
          fontSize: 0.16,
          metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
          upright: true,
        },
        {
          kind: 'text',
          x: 0,
          y: 0.36,
          text: 'CH: 2700',
          fontSize: 0.11,
          metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
          upright: true,
        },
      ],
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer annotationUnitsPerPoint={0.01} geometry={geometry} />
      </svg>,
    )

    expect(markup).toContain('font-size="0.08"')
    expect(markup).toContain('font-size="0.07"')
    expect(markup).toContain('font-size="0.055"')
    expect(markup).toMatch(/translate\(0 0\.08625/)
    expect(markup).toMatch(/translate\(0 0\.18625/)
    expect(markup).toMatch(/translate\(0 0\.27375/)
  })

  test('uses paper stroke profiles for leaders and opening marks in document mode', () => {
    const geometry = {
      kind: 'group',
      metadata: floorplanGeometryMetadata({ annotationRole: 'opening-mark' }),
      children: [
        {
          kind: 'polyline',
          points: [
            [0, 0],
            [1, 0],
            [1.4, 0],
          ],
          stroke: '#334155',
          strokeWidth: 0.9,
          vectorEffect: 'non-scaling-stroke',
        },
        {
          kind: 'rect',
          x: 2,
          y: 2,
          width: 0.42,
          height: 0.32,
          fill: '#ffffff',
          stroke: '#334155',
          strokeWidth: 0.02,
        },
      ],
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer annotationUnitsPerPoint={0.01} geometry={geometry} />
      </svg>,
    )

    expect(markup).toContain('stroke-width="0.9"')
    expect(markup).toContain('vector-effect="non-scaling-stroke"')
    expect(markup).toContain('height="0.14"')
    expect(markup).toContain('rx="0.07"')
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
            metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
          }}
        />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-annotation-obstacle="outline"')
  })

  test('registers fixed annotation categories as obstacles', () => {
    const roomLabel = {
      kind: 'text',
      x: 0,
      y: 0,
      text: 'KITCHEN',
      fontSize: 0.18,
      metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
    } satisfies FloorplanGeometry
    const stairArrow = {
      kind: 'polyline',
      points: [
        [0, 0],
        [0.5, 0.5],
      ],
      metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
    } satisfies FloorplanGeometry

    const markup = renderToStaticMarkup(
      <svg>
        <FloorplanGeometryRenderer geometry={roomLabel} />
        <FloorplanGeometryRenderer geometry={stairArrow} />
      </svg>,
    )

    expect(markup).toContain('data-floorplan-annotation-obstacle="bounds"')
    expect(markup).toContain('data-floorplan-annotation-obstacle="outline"')
  })
})
