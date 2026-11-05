import { describe, expect, test } from 'bun:test'
import {
  DoorNode,
  type FloorplanGeometry,
  type GeometryContext,
  getDoorOpeningSize,
  getEffectiveNode,
  LevelNode,
  openingHostFacing,
  registerNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { getActiveSnappingMode, useEditor } from '@pascal-app/editor'
import { doorDefinition } from './definition'
import { buildDoorFloorplan } from './floorplan'
import { doorFloorplanMoveTarget } from './floorplan-move'
import { hingesSidePatch, placementSwing, swapDoorHingePatch, swapDoorSwingPatch } from './swing'

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

  test('an offset auto-depth door is exactly as deep as its wall', () => {
    const spans = polygonSpans(buildDoor({ doorType: 'sliding', position: [2, 1.05, -0.205] }))
    const frame = spans.find((span) => Math.abs(span.min + 0.305) < 1e-9)
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

  test('picking a hinge side in the panel moves the handle to the free edge', () => {
    // A door saved with its handle on the hinge side comes out right once a side is picked.
    const door = DoorNode.parse({ id: 'door_pick', hingesSide: 'left', handleSide: 'left' })
    expect({ ...door, ...hingesSidePatch('right') }).toMatchObject({
      hingesSide: 'right',
      handleSide: 'left',
    })
    expect({ ...door, ...hingesSidePatch('left') }).toMatchObject({
      hingesSide: 'left',
      handleSide: 'right',
    })
  })
})

test('fixed lights enlarge the cutout footprint without changing the swing radius', () => {
  const geometry = buildDoor({ sidelightLeft: 0.3, sidelightRight: 0.5, transomHeight: 0.4 })
  const footprint = geometry.find((part) => part.kind === 'polygon')!
  if (footprint.kind !== 'polygon') throw new Error('Missing opening footprint')
  const xs = footprint.points.map(([x]) => x)
  expect(Math.min(...xs)).toBeCloseTo(1.2)
  expect(Math.max(...xs)).toBeCloseTo(3)
  const arc = geometry.find(
    (part) => part.kind === 'path' && part.strokeDasharray && part.d.includes(' A '),
  )
  expect(arc?.kind === 'path' && arc.d).toContain('A 1 1')
})

for (const mode of ['off', 'grid', 'lines'] as const) {
  test(`Flip side during a plan move preserves an asymmetric cutout beside another opening (${mode})`, () => {
    const initial = useScene.getState()
    const editorState = useEditor.getState()
    const level = LevelNode.parse({ id: 'level_entry', children: ['wall_entry'] })
    const host = WallNode.parse({
      id: 'wall_entry',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      children: ['door_entry', 'door_neighbor'],
    })
    const entry = DoorNode.parse({
      id: 'door_entry',
      parentId: host.id,
      wallId: host.id,
      position: [0.65, 1.05, 0],
      sidelightLeft: 0.2,
      sidelightRight: 0.6,
      transomHeight: 0.8,
    })
    const neighbor = DoorNode.parse({
      id: 'door_neighbor',
      parentId: host.id,
      wallId: host.id,
      width: 0.8,
      position: [2.45, 1.05, 0],
    })
    try {
      registerNode(doorDefinition)
      useEditor.setState({
        mode: 'build',
        tool: 'door',
        snappingModeByContext: { ...editorState.snappingModeByContext, item: mode },
      })
      useScene.setState({
        nodes: { [level.id]: level, [host.id]: host, [entry.id]: entry, [neighbor.id]: neighbor },
        dirtyNodes: new Set(),
      })
      expect(getActiveSnappingMode()).toBe(mode)
      const session = doorFloorplanMoveTarget({ node: entry, nodes: useScene.getState().nodes })
      session.apply({
        planPoint: [0.65, 0],
        modifiers: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false },
      })
      expect(session.canCommit()).toBe(true)
      const transform = useLiveTransforms.getState().transforms.get(entry.id)
      const before = {
        ...getEffectiveNode(entry),
        position: transform?.position ?? entry.position,
        rotation: [0, transform?.rotation ?? entry.rotation[1], 0] as DoorNode['rotation'],
      }
      const centre =
        before.position[0] - getDoorOpeningSize(before).leafOffsetX * openingHostFacing(before)
      session.flipSide?.()
      expect(session.canCommit()).toBe(true)
      session.commit?.()
      const saved = useScene.getState().nodes[entry.id] as DoorNode
      const savedCentre =
        saved.position[0] - getDoorOpeningSize(saved).leafOffsetX * openingHostFacing(saved)
      expect(savedCentre).toBeCloseTo(centre)
      expect(savedCentre - getDoorOpeningSize(saved).width / 2).toBeGreaterThanOrEqual(-1e-6)
      expect(saved.height).toBe(2.1)
      expect(saved.transomHeight).toBeCloseTo(0.4)
    } finally {
      useLiveTransforms.getState().clear(entry.id)
      useLiveNodeOverrides.getState().clearAll()
      useScene.setState(initial)
      useEditor.setState(editorState)
    }
  })
}
