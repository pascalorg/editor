import { afterEach, describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { getActiveBuildingId } from './world-grid-snap'

const originalNodes = useScene.getState().nodes
const originalSelection = useViewer.getState().selection

afterEach(() => {
  useScene.setState({ nodes: originalNodes } as never)
  useViewer.setState({ selection: originalSelection } as never)
})

describe('getActiveBuildingId', () => {
  test('prefers the active level owner over a stale selected building', () => {
    const staleBuilding = BuildingNode.parse({})
    const activeBuilding = BuildingNode.parse({})
    const level = LevelNode.parse({ parentId: activeBuilding.id })
    useScene.setState({
      nodes: {
        [staleBuilding.id]: staleBuilding,
        [activeBuilding.id]: activeBuilding,
        [level.id]: level,
      },
    } as never)
    useViewer.setState({
      selection: {
        buildingId: staleBuilding.id,
        levelId: level.id,
        zoneId: null,
        selectedIds: [],
      },
    } as never)

    expect(getActiveBuildingId()).toBe(activeBuilding.id)
  })

  test('resolves legacy level ownership from the building children list', () => {
    const level = LevelNode.parse({})
    const building = BuildingNode.parse({ children: [level.id] })
    useScene.setState({ nodes: { [building.id]: building, [level.id]: level } } as never)
    useViewer.setState({
      selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
    } as never)

    expect(getActiveBuildingId()).toBe(building.id)
  })
})
