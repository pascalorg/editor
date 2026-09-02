import { afterEach, expect, test } from 'bun:test'
import {
  CeilingNode,
  LevelNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { wallFloorplanMoveTarget } from './floorplan-move'

const square = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
] as [number, number][]

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
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
  useScene.setState({ nodes } as never)

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
  expect(ceilingPreview).toEqual(slabPreview)
  expect(slabPreview).not.toEqual(square)

  session.commit?.()

  expect((useScene.getState().nodes[slab.id] as typeof slab).polygon).toEqual(slabPreview)
  expect((useScene.getState().nodes[ceiling.id] as typeof ceiling).polygon).toEqual(ceilingPreview)
  expect(useLiveNodeOverrides.getState().get(slab.id)).toBeUndefined()
  expect(useLiveNodeOverrides.getState().get(ceiling.id)).toBeUndefined()
})
