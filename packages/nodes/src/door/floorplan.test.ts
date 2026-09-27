import { describe, expect, test } from 'bun:test'
import { DoorNode, type FloorplanGeometry, type GeometryContext, WallNode } from '@pascal-app/core'
import { buildDoorFloorplan } from './floorplan'

const wall = WallNode.parse({
  id: 'wall_door-plan',
  start: [0, 0],
  end: [4, 0],
  thickness: 0.2,
})

function buildDoor(values: Partial<DoorNode> = {}): FloorplanGeometry[] {
  const door = DoorNode.parse({
    id: 'door_plan',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.05, 0],
    width: 1,
    ...values,
  })
  const geometry = buildDoorFloorplan(door, {
    children: [],
    parent: wall,
    resolve: () => undefined,
    siblings: [],
  } as GeometryContext)
  expect(geometry?.kind).toBe('group')
  return geometry?.kind === 'group' ? geometry.children : []
}

describe('buildDoorFloorplan documentation symbols', () => {
  test('shows hinge, strike, panic hardware, and an arched overhead line', () => {
    const geometry = buildDoor({
      doorType: 'hinged',
      openingShape: 'arch',
      archHeight: 0.45,
      panicBar: true,
    })

    expect(geometry.filter((item) => item.kind === 'rect')).toHaveLength(2)
    expect(
      geometry.some(
        (item) =>
          item.kind === 'line' && item.strokeLinecap === 'square' && item.strokeWidth === 2.2,
      ),
    ).toBe(true)
    expect(geometry.some((item) => item.kind === 'path' && item.strokeDasharray === '4 3')).toBe(
      true,
    )
  })

  test('documents a rounded frameless opening without swing hardware', () => {
    const geometry = buildDoor({
      openingKind: 'opening',
      openingShape: 'rounded',
      cornerRadius: 0.2,
      panicBar: true,
    })

    expect(geometry.filter((item) => item.kind === 'rect')).toHaveLength(0)
    expect(geometry.some((item) => item.kind === 'line' && item.strokeLinecap === 'square')).toBe(
      false,
    )
    expect(geometry.some((item) => item.kind === 'path' && item.strokeDasharray === '4 3')).toBe(
      true,
    )
  })
})

function polygonSpans(geometry: FloorplanGeometry[]) {
  return geometry
    .filter((item) => item.kind === 'polygon')
    .map((item) => {
      const zs = item.points.map((point) => point[1])
      return { min: Math.min(...zs), max: Math.max(...zs), fill: item.fill }
    })
}

describe('buildDoorFloorplan wall-local plane offset', () => {
  test('a centred door keeps its footprint in the wall cutout', () => {
    const [footprint] = polygonSpans(buildDoor({ doorType: 'sliding' }))
    expect(footprint?.min).toBeCloseTo(-0.1, 9)
    expect(footprint?.max).toBeCloseTo(0.1, 9)
  })

  test('a frame standing proud of the wall draws outside that face, at its own depth', () => {
    const spans = polygonSpans(
      buildDoor({ doorType: 'sliding', position: [2, 1.05, -0.205], frameDepth: 0.2068 }),
    )
    // The opening still reads as a hole through the wall…
    expect(
      spans.some((span) => Math.abs(span.min + 0.1) < 1e-9 && Math.abs(span.max - 0.1) < 1e-9),
    ).toBe(true)
    // …and the frame sits wholly outside the -z face, 0.2068 m deep.
    const frame = spans.find((span) => Math.abs(span.min + 0.3084) < 1e-9)
    expect(frame).toBeDefined()
    expect(frame?.max).toBeCloseTo(-0.1016, 9)
    // No sliding panel is drawn back inside the wall thickness.
    const panels = spans.filter((span) => span !== frame && span.max - span.min < 0.1)
    expect(panels.length).toBeGreaterThan(0)
    for (const panel of panels) expect(panel.max).toBeLessThanOrEqual(-0.1 + 1e-9)
  })
})
