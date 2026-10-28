import { describe, expect, test } from 'bun:test'
import { DoorNode, type FloorplanGeometry, type GeometryContext, WallNode } from '@pascal-app/core'
import { buildDoorFloorplan } from './floorplan'
import { placementSwing, swapDoorHingePatch, swapDoorSwingPatch } from './swing'

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

  test('an auto frame offset off the wall draws at the wall thickness plus the lip', () => {
    // No `frameDepth`: the frame is 0.2 m (the wall) + 0.02 m; offset -0.215 puts it past the -z face.
    const spans = polygonSpans(buildDoor({ doorType: 'sliding', position: [2, 1.05, -0.215] }))
    const frame = spans.find((span) => Math.abs(span.min + 0.325) < 1e-9)
    expect(frame).toBeDefined()
    expect(frame?.max).toBeCloseTo(-0.105, 9)
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

/** The plan z the open leaf reaches: + is the wall's front (+Z) side, - its back. */
function leafSide(geometry: FloorplanGeometry[]) {
  const leaf = geometry
    .filter((item) => item.kind === 'line')
    .reduce<{ y1: number; y2: number } | null>((best, item) => {
      if (item.kind !== 'line') return best
      return !best || Math.abs(item.y2 - item.y1) > Math.abs(best.y2 - best.y1) ? item : best
    }, null)
  return Math.sign(leaf!.y2 - leaf!.y1)
}

describe('swing chosen while placing', () => {
  const placed = (rotationY: number, cursor: 'front' | 'back', values: Partial<DoorNode> = {}) =>
    buildDoor({
      ...values,
      rotation: [0, rotationY, 0],
      swingDirection: placementSwing(DoorNode.parse({ ...values }), rotationY, cursor),
    })

  test('the leaf swings into the side of the wall the cursor is on', () => {
    expect(leafSide(placed(0, 'front'))).toBe(1)
    expect(leafSide(placed(Math.PI, 'back'))).toBe(-1)
  })

  test('a door held facing out (an outside wall) still swings toward the cursor', () => {
    expect(leafSide(placed(0, 'back'))).toBe(-1)
    expect(leafSide(placed(Math.PI, 'front'))).toBe(1)
    expect(leafSide(placed(0, 'front', { doorType: 'double' }))).toBe(1)
  })

  test('swapping the swing sends the leaf to the other side; swapping hinges keeps it there', () => {
    const door = DoorNode.parse({ id: 'door_swap', hingesSide: 'left', handleSide: 'right' })
    expect(leafSide(buildDoor({ ...door, ...swapDoorSwingPatch(door) }))).toBe(
      -leafSide(buildDoor(door)),
    )
    const swapped = swapDoorHingePatch(door)
    expect(swapped).toEqual({ hingesSide: 'right', handleSide: 'left' })
    expect(leafSide(buildDoor({ ...door, ...swapped }))).toBe(leafSide(buildDoor(door)))
  })
})
