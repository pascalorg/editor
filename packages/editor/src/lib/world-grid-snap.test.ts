import { afterEach, describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, snapWorldXZToBuildingLocal, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  getActiveBuildingId,
  getActiveGridPose,
  resolveAlignmentForActiveBuilding,
  resolveAlignmentForFloorplanView,
  snapBuildingLocalToWorldGrid,
  snapWorldXZForActiveBuilding,
} from './world-grid-snap'

const originalNodes = useScene.getState().nodes
const originalSelection = useViewer.getState().selection
const originalPhase = useEditor.getState().phase

afterEach(() => {
  useScene.setState({ nodes: originalNodes } as never)
  useViewer.setState({ selection: originalSelection } as never)
  useEditor.setState({ phase: originalPhase })
  useInteractionScope.getState().end()
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

// A building the site planner set on its lot: turned and offset. The plan only
// carries the level, as it often does (`selection.buildingId` null).
const YAW = (17 * Math.PI) / 180
const POSITION: [number, number, number] = [12.37, 0, -8.91]

function selectTurnedBuilding() {
  const level = LevelNode.parse({})
  const building = BuildingNode.parse({
    position: POSITION,
    rotation: [0, YAW, 0],
    children: [level.id],
  })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: { ...level, parentId: building.id } },
  } as never)
  useViewer.setState({
    selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
  } as never)
  return building
}

describe("grid snap on the building's own lattice", () => {
  test('a turned, offset building snaps square to itself, not to the world grid', () => {
    selectTurnedBuilding()
    expect(snapBuildingLocalToWorldGrid([1.26, 3.74], 0.5)).toEqual([1.5, 3.5])
    expect(snapBuildingLocalToWorldGrid([1.26, 3.74], 0)).toEqual([1.26, 3.74])
  })

  test('an unturned building at the origin keeps the world grid, which is its lattice', () => {
    const building = BuildingNode.parse({})
    useScene.setState({ nodes: { [building.id]: building } } as never)
    useViewer.setState({
      selection: { buildingId: building.id, levelId: null, zoneId: null, selectedIds: [] },
    } as never)
    expect(snapBuildingLocalToWorldGrid([1.26, 3.74], 0.5)).toEqual([1.5, 3.5])
    expect(snapWorldXZForActiveBuilding(1.26, 3.74, 0.5)).toEqual({
      world: [1.5, 3.5],
      local: [1.5, 3.5],
    })
  })

  test('a world cursor lands on the building lattice, in both frames', () => {
    selectTurnedBuilding()
    const { world, local } = snapWorldXZForActiveBuilding(15.2, -4.4, 0.5)
    const raw = snapWorldXZToBuildingLocal(15.2, -4.4, POSITION, YAW, 0).local
    expect(local).toEqual(snapBuildingLocalToWorldGrid(raw, 0.5))
    const back = snapWorldXZToBuildingLocal(world[0], world[1], POSITION, YAW, 0).local
    expect(back[0]).toBeCloseTo(local[0], 9)
    expect(back[1]).toBeCloseTo(local[1], 9)
  })
})

describe('resolveAlignmentForFloorplanView', () => {
  test("aligns on a turned building's own axes and returns building-local guides", () => {
    selectTurnedBuilding()
    const result = resolveAlignmentForFloorplanView({
      moving: [{ nodeId: 'moving', kind: 'corner', x: 2.05, z: 1 }],
      candidates: [{ nodeId: 'wall', kind: 'corner', x: 2, z: 5 }],
      threshold: 0.08,
    })
    expect(result.snap?.dx).toBeCloseTo(-0.05, 9)
    expect(result.snap?.dz).toBeCloseTo(0, 9)
    expect(result.guides).toHaveLength(1)
    expect(result.guides[0]?.axis).toBe('x')
    expect(result.guides[0]?.anchor).toEqual({ x: 2, z: 5 })
  })
})

describe('resolveAlignmentForActiveBuilding', () => {
  test("aligns on a turned building's own axes; guide ends come back in world coords", () => {
    selectTurnedBuilding()
    const result = resolveAlignmentForActiveBuilding({
      moving: [{ nodeId: 'moving', kind: 'corner', x: 2.05, z: 1 }],
      candidates: [{ nodeId: 'wall', kind: 'corner', x: 2, z: 5 }],
      threshold: 0.08,
    })
    expect(result.snap?.dx).toBeCloseTo(-0.05, 9)
    expect(result.snap?.dz).toBeCloseTo(0, 9)
    const anchor = result.guides[0]?.anchor
    const ends = [result.guides[0]?.from, result.guides[0]?.to]
    // The candidate end sits at the anchor's world position.
    const world = ends.find(
      (end) =>
        end &&
        Math.abs(end.x - (POSITION[0] + 2 * Math.cos(YAW) + 5 * Math.sin(YAW))) < 1e-9 &&
        Math.abs(end.z - (POSITION[2] - 2 * Math.sin(YAW) + 5 * Math.cos(YAW))) < 1e-9,
    )
    expect(anchor).toEqual({ x: 2, z: 5 })
    expect(world).toBeDefined()
  })
})

describe('getActiveGridPose (the frame the 3D grid is drawn in)', () => {
  test("is the active building's pose while working in it", () => {
    useEditor.setState({ phase: 'building' })
    selectTurnedBuilding()
    expect(getActiveGridPose()).toEqual({ position: POSITION, rotationY: YAW })
  })

  test('is the world grid for site work and while the building itself moves', () => {
    const building = selectTurnedBuilding()
    useEditor.setState({ phase: 'site' })
    expect(getActiveGridPose()).toBeNull()

    useEditor.setState({ phase: 'building' })
    useInteractionScope.getState().begin({
      kind: 'moving',
      node: building,
      nodeId: building.id,
      nodeType: 'building',
      view: '3d',
    })
    expect(getActiveGridPose()).toBeNull()
  })

  test('is the world grid with no building', () => {
    useEditor.setState({ phase: 'building' })
    useScene.setState({ nodes: {} } as never)
    useViewer.setState({
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
    } as never)
    expect(getActiveGridPose()).toBeNull()
  })
})
