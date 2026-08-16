import { describe, expect, test } from 'bun:test'
import { readSiteBuildable } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { BuildableAreaGeometry } from './floorplan-buildable-layer'

/**
 * A render test rather than a geometry one: the offset itself is pinned in
 * `core`, and what the suite could not otherwise see is whether the layer is
 * mounted at all, whether it draws the strip the setbacks describe, and whether
 * a focused edge index highlights the segment the panel row means.
 */

const parcel = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
]

function ringsFor(distances: number[]) {
  const setbacks = Object.fromEntries(
    distances.map((distance, index) => [String(index), { role: 'side' as const, distance }]),
  )
  const reading = readSiteBuildable(
    parcel.map((point) => [point.x, point.y] as [number, number]),
    { setbacks, defaultSetback: 0 },
  )
  return reading.rings.map((ring) => ring.map(([x, y]) => ({ x, y })))
}

function render(rings: ReturnType<typeof ringsFor> | null, focusedEdge: number | null = null) {
  return renderToStaticMarkup(
    <svg>
      <BuildableAreaGeometry
        buildableRings={rings}
        dimmed={false}
        focusedEdge={focusedEdge}
        onHoverEdge={() => {}}
        onSelectEdge={() => {}}
        sitePolygon={parcel}
        unitsPerPixel={0.02}
      />
    </svg>,
  )
}

describe('FloorplanBuildableLayer', () => {
  test('draws nothing at all when there is no setback to draw', () => {
    expect(render(null)).toBe('<svg></svg>')
  })

  test('draws the strip as parcel-minus-buildable, and the boundary dashed', () => {
    const markup = render(ringsFor([3, 3, 3, 3]))

    // Even-odd over one path is what makes "the ground the setbacks put off
    // limits" a single shape, however many pieces the buildable area is in.
    expect(markup).toContain('fill-rule="evenodd"')
    expect(markup).toContain('url(#site-setback-hatch)')
    expect(markup).toContain('stroke-dasharray="6 4"')
    // The 3 m inset corners of a 20 m square, in the boundary path.
    expect(markup).toContain('M -7 -7')
    expect(markup).toContain('L 7 -7')
  })

  test('a setback that swallows the parcel leaves the strip and drops the boundary', () => {
    const markup = render(ringsFor([12, 12, 12, 12]))

    expect(markup).toContain('url(#site-setback-hatch)')
    // No buildable ring means no boundary line — the panel says why in words.
    expect(markup).not.toContain('stroke-dasharray="6 4"')
  })

  test('one picker per parcel edge, so either view can name the same edge', () => {
    const markup = render(ringsFor([3, 3, 3, 3]))
    expect(markup.match(/stroke="transparent"/g)).toHaveLength(parcel.length)
  })

  test('the focused edge index highlights that edge and only that edge', () => {
    const rings = ringsFor([3, 3, 3, 3])
    expect(render(rings, null)).not.toContain('stroke-width="3.4"')

    // Edge 2 of the parcel runs (10, 10) → (-10, 10).
    const focused = render(rings, 2)
    expect(focused).toContain('x1="10" x2="-10" y1="10" y2="10"')
    expect(focused.match(/stroke-width="3.4"/g)).toHaveLength(1)

    // Edge 0 runs (-10, -10) → (10, -10). Off-by-one here would put the panel's
    // highlight one edge along from the row the user is pointing at.
    expect(render(rings, 0)).toContain('x1="-10" x2="10" y1="-10" y2="-10"')
  })
})
