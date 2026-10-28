import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BeamNode,
  BuildingNode,
  clearSceneHistory,
  createBeam,
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildBeamFloorplan } from './floorplan'
import { beamEndpointAffordance } from './floorplan-affordances'
import { beamFloorplanMoveTarget, movedBeamEnds } from './floorplan-move'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const FT = 0.3048
// Alt: the drags place freely, so the expected points are the pointer's.
const modifiers = { shiftKey: false, altKey: true, ctrlKey: false, metaKey: false }
const BEAM = createBeam({ start: [0, 0], end: [12 * FT, 0], preset: '(2)2x10', levelId: 'level_g' })

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
})

/** A storey holding the beam, as the scene store loads one. */
function load(beam: BeamNode) {
  const building = BuildingNode.parse({ id: 'building_a', children: ['level_g'] })
  const level = LevelNode.parse({
    id: 'level_g',
    parentId: building.id,
    level: 0,
    height: 2.7,
    children: [beam.id],
  })
  const nodes = Object.fromEntries([building, level, beam].map((node) => [node.id, node]))
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
}

function flat(geometry: FloorplanGeometry | null): FloorplanGeometry[] {
  if (!geometry) return []
  return geometry.kind === 'group' ? geometry.children.flatMap(flat) : [geometry]
}

const view = (selected: boolean, unit: 'metric' | 'imperial' = 'imperial') =>
  ({
    viewState: { selected, highlighted: false, hovered: false, moving: false, unit },
  }) as unknown as GeometryContext

test('a beam is drawn as a dashed double outline of its width, its size beside it', () => {
  const parts = flat(buildBeamFloorplan(BEAM, view(false)))
  const outline = parts.find((part) => part.kind === 'polygon')
  expect(outline?.kind === 'polygon' && outline.strokeDasharray).toBeTruthy()
  expect(outline?.kind === 'polygon' && outline.points.length).toBe(4)
  // the outline spans the beam's 3 in across
  const zs = outline?.kind === 'polygon' ? outline.points.map((point) => point[1]) : []
  expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3 * 0.0254)
  expect(readFloorplanGeometryMetadata(outline as never)?.annotationObstacle).toBe('outline')
  const labels = parts.filter((part) => part.kind === 'dimension-label')
  expect(labels.map((label) => label.kind === 'dimension-label' && label.text)).toEqual([
    '(2) 2x10',
  ])
  // a click near the line picks it, at any zoom
  expect(parts.some((part) => part.kind === 'hit-line')).toBe(true)
  // unselected: no handles
  expect(parts.some((part) => part.kind === 'endpoint-handle')).toBe(false)
})

test('selected, it shows its end handles, a move arrow either side and its length', () => {
  const parts = flat(buildBeamFloorplan(BEAM, view(true)))
  const ends = parts.filter((part) => part.kind === 'endpoint-handle')
  expect(ends.map((end) => end.kind === 'endpoint-handle' && end.payload)).toEqual([
    { endpoint: 'start' },
    { endpoint: 'end' },
  ])
  expect(parts.filter((part) => part.kind === 'move-arrow')).toHaveLength(2)
  const labels = parts.flatMap((part) => (part.kind === 'dimension-label' ? [part.text] : []))
  expect(labels).toEqual(['(2) 2x10', `12'0"`])
  expect(
    flat(buildBeamFloorplan(BEAM, view(true, 'metric'))).flatMap((part) =>
      part.kind === 'dimension-label' ? [part.text] : [],
    ),
  ).toContain('3.66m')
})

test('a beam of no length draws nothing', () => {
  expect(buildBeamFloorplan(BeamNode.parse({ start: [1, 1], end: [1, 1] }), view(false))).toBeNull()
})

test('an end dragged in the plan previews live and writes once; a too-short beam is refused', () => {
  load(BEAM)
  const session = beamEndpointAffordance.start({
    node: BEAM,
    payload: { endpoint: 'end' },
    nodes: useScene.getState().nodes,
    initialPlanPoint: [12 * FT, 0],
    gridSnapStep: 0.5,
  })
  session.apply({ planPoint: [5, 1], modifiers })
  expect(useLiveNodeOverrides.getState().overrides.get(BEAM.id)).toEqual({ end: [5, 1] })
  expect(session.canCommit()).toBe(true)
  session.commit?.()
  expect((useScene.getState().nodes[BEAM.id] as BeamNode).end).toEqual([5, 1])
  expect(useLiveNodeOverrides.getState().overrides.get(BEAM.id)).toBeUndefined()
  session.apply({ planPoint: [0.002, 0], modifiers })
  expect(session.canCommit()).toBe(false)
})

test('a plan move carries both ends together', () => {
  expect(movedBeamEnds(BEAM, [1, 2])).toEqual({ start: [1, 2], end: [12 * FT + 1, 2] })
  load(BEAM)
  const session = beamFloorplanMoveTarget({ node: BEAM, nodes: useScene.getState().nodes })
  session.apply({ planPoint: [2, 2], modifiers })
  session.apply({ planPoint: [3, 2.5], modifiers })
  expect(session.canCommit()).toBe(true)
  session.commit?.()
  const moved = useScene.getState().nodes[BEAM.id] as BeamNode
  expect(moved.start).toEqual([1, 0.5])
  expect(moved.end[0]).toBeCloseTo(12 * FT + 1)
})
