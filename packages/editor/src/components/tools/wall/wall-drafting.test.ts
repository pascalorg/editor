import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  useScene,
  type WallNode,
  WallNode as WallSchema,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { createWallOnCurrentLevel, snapWallDraftPointDetailed } from './wall-drafting'
import type { WallPlanPoint } from './wall-snap-geometry'

const LEVEL_ID = 'level_test' as AnyNodeId

function makeWall(start: WallPlanPoint, end: WallPlanPoint, id: string): WallNode {
  return {
    ...WallSchema.parse({ start, end, name: id }),
    id: id as WallNode['id'],
    parentId: LEVEL_ID,
  }
}

function seedLevel(walls: WallNode[]) {
  useScene.setState({
    nodes: Object.fromEntries([
      [
        LEVEL_ID,
        {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: walls.map((wall) => wall.id),
          level: 0,
        } as AnyNode,
      ],
      ...walls.map((wall) => [wall.id, wall] as const),
    ]),
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

function levelWalls(): WallNode[] {
  return Object.values(useScene.getState().nodes).filter(
    (node): node is WallNode => node?.type === 'wall',
  )
}

describe('createWallOnCurrentLevel', () => {
  beforeEach(() => {
    useViewer.setState({
      selection: {
        buildingId: 'building_test',
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    // The commit-time corner-join / wall-split is a magnetic ('lines') snap, so
    // these cases only apply in a magnetic context. A reshaping-endpoint scope
    // resolves to the 'wall' context without needing the node registry (which
    // isn't loaded in this package's tests).
    useEditor.getState().setSnappingMode('wall', 'lines')
    useInteractionScope
      .getState()
      .begin({ kind: 'reshaping', nodeId: 'wall_a', reshape: 'endpoint' })
    seedLevel([makeWall([0, 0], [4, 0], 'wall_a')])
  })

  test('endpoint near an existing corner attaches to the corner instead of splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [3.99, 0])

    expect(created?.end).toEqual([4, 0])
    const hostWall = useScene.getState().nodes['wall_a' as AnyNodeId] as WallNode | undefined
    expect(hostWall?.start).toEqual([0, 0])
    expect(hostWall?.end).toEqual([4, 0])
    expect(levelWalls()).toHaveLength(2)
  })

  test('endpoint near the host start corner snaps there without splitting', () => {
    const created = createWallOnCurrentLevel([2, 2], [0.015, 0])

    expect(created?.end).toEqual([0, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeDefined()
    expect(levelWalls()).toHaveLength(2)
  })

  test('genuine mid-wall endpoint still splits the host (T junction)', () => {
    const created = createWallOnCurrentLevel([2, 2], [2, 0])

    expect(created?.end).toEqual([2, 0])
    expect(useScene.getState().nodes['wall_a' as AnyNodeId]).toBeUndefined()
    const walls = levelWalls()
    expect(walls).toHaveLength(3)
    expect(
      walls.some((wall) => wall.start[0] === 0 && wall.end[0] === 2 && wall.end[1] === 0),
    ).toBe(true)
    expect(
      walls.some((wall) => wall.start[0] === 2 && wall.start[1] === 0 && wall.end[0] === 4),
    ).toBe(true)
  })

  test('exact duplicate segment is rejected', () => {
    expect(createWallOnCurrentLevel([0, 0], [4, 0])).toBeNull()
    expect(levelWalls()).toHaveLength(1)
  })
})

describe('snapWallDraftPointDetailed', () => {
  test('bypassSnap returns the raw point without endpoint or angle snap', () => {
    const wall = makeWall([0, 0], [4, 0], 'wall_a')
    const result = snapWallDraftPointDetailed({
      point: [3.99, 0.03],
      walls: [wall],
      start: [2, 2],
      angleSnap: true,
      bypassSnap: true,
    })

    expect(result.point).toEqual([3.99, 0.03])
    expect(result.snap).toBeNull()
  })
})
