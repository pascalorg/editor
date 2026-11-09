import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CeilingNode,
  initSpaceDetectionSync,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { migrateCeilingRoomLinks, migrateRoomZones } from '@pascal-app/core/scene-migrations'
import { getActiveSnappingMode, useAlignmentGuides, useInteractionScope } from '@pascal-app/editor'
import { wallDefinition } from './definition'
import { wallFloorplanMoveTarget } from './floorplan-move'

const square = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
] as [number, number][]

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
// The parallel-wall tests register the wall kind; put the registry back after.
let restoreRegistry: (() => void) | null = null
afterEach(() => {
  restoreRegistry?.()
  restoreRegistry = null
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

test('whole-wall floorplan move previews and commits automatic slab and ceiling polygons', () => {
  const level = LevelNode.parse({
    id: 'level_move-preview',
    level: 0,
    height: 3,
    children: [],
  })
  const walls = [
    WallNode.parse({
      id: 'wall_move-bottom',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    }),
    WallNode.parse({
      id: 'wall_move-right',
      parentId: level.id,
      start: [4, 0],
      end: [4, 4],
    }),
    WallNode.parse({
      id: 'wall_move-top',
      parentId: level.id,
      start: [4, 4],
      end: [0, 4],
    }),
    WallNode.parse({
      id: 'wall_move-left',
      parentId: level.id,
      start: [0, 4],
      end: [0, 0],
    }),
  ]
  const slab = SlabNode.parse({
    id: 'slab_move-preview',
    boundary: 'auto',
    parentId: level.id,
    polygon: square,
    autoFromWalls: true,
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_move-preview',
    parentId: level.id,
    polygon: square,
    autoFromWalls: true,
  })
  const nodes = Object.fromEntries(
    [level, ...walls, slab, ceiling].map((entry) => [entry.id, entry]),
  )
  nodes[level.id] = { ...level, children: [...walls, slab, ceiling].map((node) => node.id) }
  const migrated = migrateCeilingRoomLinks(migrateRoomZones(nodes).nodes).nodes
  useScene.setState({ nodes: migrated } as never)
  const zone = Object.values(migrated).find((node: any) => node.type === 'zone') as ZoneNode
  const stop = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces() {} }),
  })
  try {
    const session = wallFloorplanMoveTarget({
      node: walls[0]!,
      nodes: useScene.getState().nodes,
      sceneApi: {} as never,
    })
    const modifiers = {
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }
    session.apply({ planPoint: [2, 0], modifiers })
    session.apply({ planPoint: [2, 1], modifiers })

    const slabPreview = useLiveNodeOverrides.getState().get(slab.id)?.polygon
    const ceilingPreview = useLiveNodeOverrides.getState().get(ceiling.id)?.polygon
    expect(slabPreview).toBeArray()
    expect(ceilingPreview).toBeArray()
    const zonePreview = useLiveNodeOverrides.getState().get(zone.id)?.polygon
    expect(zonePreview).toBeArray()
    expect(useScene.getState().nodes[zone.id]).toMatchObject({ polygon: zone.polygon })
    expect(slabPreview).not.toEqual(square)

    session.commit?.()

    expect((useScene.getState().nodes[slab.id] as typeof slab).polygon).toEqual(slabPreview)
    expect((useScene.getState().nodes[ceiling.id] as typeof ceiling).polygon).toEqual(
      ceilingPreview,
    )
    expect(useLiveNodeOverrides.getState().get(slab.id)).toBeUndefined()
    expect(useLiveNodeOverrides.getState().get(ceiling.id)).toBeUndefined()
    expect(useLiveNodeOverrides.getState().get(zone.id)).toBeUndefined()
    expect(useScene.getState().nodes[zone.id]).toMatchObject({ polygon: zonePreview })
  } finally {
    stop()
  }
})

// Two outside walls in line but apart, as when partitions break the outside up.
function outsideStep() {
  const level = LevelNode.parse({ id: 'level_parallel', level: 0, height: 3, children: [] })
  const outside = { frontSide: 'exterior', backSide: 'interior', thickness: 0.15 } as const
  const top = WallNode.parse({
    id: 'wall_parallel-top',
    parentId: level.id,
    start: [0, 0.07],
    end: [4, 0.07],
    ...outside,
  })
  const step = WallNode.parse({
    id: 'wall_parallel-step',
    parentId: level.id,
    start: [5, 0.6],
    end: [8, 0.6],
    ...outside,
  })
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [top.id, step.id] },
      [top.id]: top,
      [step.id]: step,
    },
  } as never)
  // Snapping follows the move's own context, as in the editor.
  restoreRegistry = nodeRegistry._snapshot()
  if (!nodeRegistry.has(wallDefinition.kind)) registerNode(wallDefinition)
  useInteractionScope.getState().begin({
    kind: 'moving',
    node: step,
    nodeId: step.id,
    nodeType: step.type,
    view: '2d',
  })
  const session = wallFloorplanMoveTarget({
    node: step,
    nodes: useScene.getState().nodes,
    sceneApi: {} as never,
  })
  return { step, session }
}

const plain = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

test('a wall moved near a parallel outside wall lines up with it, off the grid', () => {
  const { step, session } = outsideStep()
  expect(getActiveSnappingMode()).not.toBe('off')
  session.apply({ planPoint: [6.5, 0.6], modifiers: plain })
  session.apply({ planPoint: [6.5, 0.12], modifiers: plain })

  const preview = useLiveNodeOverrides.getState().get(step.id) as Pick<WallNode, 'start' | 'end'>
  expect(preview.start[0]).toBe(5)
  expect(preview.start[1]).toBeCloseTo(0.07, 10)
  expect(preview.end[1]).toBeCloseTo(0.07, 10)
  expect(useAlignmentGuides.getState().draft?.lines).toHaveLength(1)

  session.commit?.()
  const moved = useScene.getState().nodes[step.id] as WallNode
  expect(moved.start[1]).toBeCloseTo(0.07, 10)
  expect(useAlignmentGuides.getState().draft).toBeNull()
})

test('Alt moves a wall exactly with the pointer', () => {
  const { step, session } = outsideStep()
  const free = { ...plain, altKey: true }
  session.apply({ planPoint: [6.5, 0.6], modifiers: free })
  session.apply({ planPoint: [6.5, 0.6 - 0.0254], modifiers: free })
  session.commit?.()
  const moved = useScene.getState().nodes[step.id] as WallNode
  expect(moved.start[1]).toBeCloseTo(0.6 - 0.0254, 10)
  expect(moved.end[1]).toBeCloseTo(0.6 - 0.0254, 10)
})
