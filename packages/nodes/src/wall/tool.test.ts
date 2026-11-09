import { afterEach, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, useScene, WallNode } from '@pascal-app/core'
import { snapWallDraftPointDetailed } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { getWallDraftSnapWalls } from './tool'

const originalSelection = useViewer.getState().selection
const originalNodes = useScene.getState().nodes

afterEach(() => {
  useViewer.setState({ selection: originalSelection })
  useScene.setState({ nodes: originalNodes })
})

test('on an upper floor the walls below snap corners and edges but never capture an end', () => {
  const lowerLevel = LevelNode.parse({ level: 0, height: 3 })
  const upperLevel = LevelNode.parse({ level: 1, height: 3 })
  const building = BuildingNode.parse({ children: [lowerLevel.id, upperLevel.id] })
  const lower = WallNode.parse({
    parentId: lowerLevel.id,
    start: [0, 0.4],
    end: [4, 0.4],
    thickness: 0.2,
  })
  const upper = WallNode.parse({ parentId: upperLevel.id, start: [0, 3], end: [4, 3] })
  lowerLevel.children = [lower.id]
  upperLevel.children = [upper.id]
  useScene.setState({
    nodes: Object.fromEntries(
      [building, lowerLevel, upperLevel, lower, upper].map((node) => [node.id, node]),
    ) as never,
  })
  useViewer.setState({
    selection: { ...originalSelection, buildingId: building.id, levelId: upperLevel.id },
  } as never)

  const { walls, snapWalls, bodyWalls } = getWallDraftSnapWalls()
  expect(walls.map((wall) => wall.id)).toEqual([upper.id])
  expect(snapWalls.map((wall) => wall.id)).toEqual([upper.id, lower.id])
  expect(bodyWalls.map((wall) => wall.id)).toEqual([upper.id])

  // An end on the lower wall's face (z = 0.5) stays where the plan puts it.
  const end = snapWallDraftPointDetailed({
    point: [1, 0.5],
    walls: snapWalls,
    bodyWalls,
    start: [1, 2],
    magnetic: false,
    step: 0,
    captureWallBodies: true,
  })
  expect(end.point).toEqual([1, 0.5])
  expect(end.snap).toBeNull()
})
