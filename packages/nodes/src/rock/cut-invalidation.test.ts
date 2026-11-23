import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  RockNode,
  SiteNode,
  SlabNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { initializeRockCutInvalidation } from './cut-invalidation'

/** A rock beside a house, on a Site: moving things around it must schedule the right rebuilds. */
function scene() {
  const site = SiteNode.parse({
    polygon: {
      type: 'polygon',
      points: [
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ],
    },
  })
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [-4, -4],
      [4, -4],
      [4, 4],
      [-4, 4],
    ],
    elevation: 0.1,
  })
  const rock = RockNode.parse({
    parentId: site.id,
    polygon: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    height: 3,
  })
  const nodes: Record<string, AnyNode> = {
    [site.id]: { ...site, children: [building.id, rock.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: { ...level, children: [slab.id] },
    [slab.id]: slab,
    [rock.id]: rock,
  }
  return { nodes, site, building, slab, rock }
}

describe('what rebuilds when a rock, the ground or the building changes', () => {
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  let original: ReturnType<typeof useScene.getState>
  let stop: () => void
  let fixture: ReturnType<typeof scene>

  const dirty = (id: string) => useScene.getState().dirtyNodes.has(id as AnyNodeId)
  const settle = () => useScene.getState().dirtyNodes.clear()

  beforeEach(() => {
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    original = useScene.getState()
    fixture = scene()
    useScene.setState({ nodes: fixture.nodes, rootNodeIds: [fixture.site.id] } as never)
    clearSceneHistory()
    stop = initializeRockCutInvalidation()
    settle()
  })
  afterEach(() => {
    stop()
    useLiveNodeOverrides.getState().clear(fixture.rock.id)
    useLiveTransforms.getState().clearAll()
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
    useScene.setState(original)
    clearSceneHistory()
  })

  test('raising the ground under a rock rebuilds the rock and the floors it cuts', () => {
    const field = createTerrainField({ origin: [-4, -4], cols: 9, rows: 9, spacing: 1 })
    field.heights.fill(Math.round(1 / field.step))

    useScene.getState().updateNode(fixture.site.id, { terrain: encodeTerrainField(field) })

    expect(dirty(fixture.rock.id)).toBe(true)
    expect(dirty(fixture.slab.id)).toBe(true)
  })

  test('moving a building clear of its rock rebuilds the floors that lose their hole', () => {
    useScene.getState().updateNode(fixture.building.id, { position: [30, 0, 0] })

    expect(dirty(fixture.slab.id)).toBe(true)
  })

  test('construction footprint and room edits invalidate cuts even without an authored level-height change', () => {
    const level = fixture.nodes[fixture.slab.parentId!] as LevelNode
    const zone = ZoneNode.parse({
      name: 'Construction room',
      parentId: level.id,
      spaceRole: 'room',
      polygon: fixture.slab.polygon,
    })
    const base = SlabNode.parse({
      parentId: level.id,
      plateRole: 'base',
      boundary: 'auto',
      zoneIds: [zone.id],
      polygon: fixture.slab.polygon,
      referenceFloorElevation: 0.05,
      floorHeight: 0.05,
      elevation: 0.05,
    })
    useScene.setState({
      nodes: {
        ...fixture.nodes,
        [level.id]: { ...level, children: [...level.children, zone.id, base.id] },
        [zone.id]: zone,
        [base.id]: base,
      },
    })
    stop()
    stop = initializeRockCutInvalidation()
    settle()
    useScene.getState().updateNode(base.id, { floorHeight: 1.05, elevation: 1.05 })
    expect(dirty(fixture.rock.id)).toBe(true)
    expect(dirty(fixture.slab.id)).toBe(true)
    settle()
    useScene.getState().updateNode(zone.id, {
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
    })
    expect(dirty(fixture.rock.id)).toBe(true)
    expect(dirty(fixture.slab.id)).toBe(true)
  })

  test('raising a level lifts the floors above it, and they are rebuilt', () => {
    const { building, nodes } = fixture
    const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
    const floor = SlabNode.parse({
      parentId: upper.id,
      polygon: [
        [-4, -4],
        [4, -4],
        [4, 4],
        [-4, 4],
      ],
      elevation: 0.1,
    })
    const [ground] = (nodes[building.id] as { children: string[] }).children
    useScene.setState({
      nodes: {
        ...nodes,
        [building.id]: { ...building, children: [ground, upper.id] },
        [upper.id]: { ...upper, children: [floor.id] },
        [floor.id]: floor,
      },
    } as never)
    stop()
    stop = initializeRockCutInvalidation()
    settle()

    useScene.getState().updateNode(ground as AnyNodeId, { height: 4 })

    expect(dirty(floor.id)).toBe(true)
  })

  test('a rock reshaped mid-drag rebuilds the floors before anything is committed', () => {
    useLiveNodeOverrides.getState().set(fixture.rock.id, {
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    })

    expect(dirty(fixture.slab.id)).toBe(true)
  })

  test('a rock moved whole mid-drag, and a building moved mid-drag, do the same', () => {
    useLiveTransforms.getState().set(fixture.rock.id, { position: [3, 0, 0], rotation: 0 })
    expect(dirty(fixture.slab.id)).toBe(true)
    settle()

    useLiveTransforms.getState().set(fixture.building.id, { position: [30, 0, 0], rotation: 0 })

    expect(dirty(fixture.slab.id)).toBe(true)
  })

  test('a scene with no rock schedules nothing', () => {
    const { nodes, rock } = fixture
    const bare = { ...nodes }
    delete bare[rock.id]
    useScene.setState({ nodes: bare } as never)
    stop()
    stop = initializeRockCutInvalidation()
    settle()

    useScene.getState().updateNode(fixture.building.id, { position: [30, 0, 0] })

    expect(dirty(fixture.slab.id)).toBe(false)
  })
})
