import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  getWallCurveFrameAt,
  getWallFaceOffsets,
  runAsSingleSceneHistoryStep,
  useLiveNodeOverrides,
  useScene,
  type WallFaceRegion,
  WallNode,
} from '@pascal-app/core'
import { Matrix4, Ray, Vector3 } from 'three'
import { commitHandleDragPatch } from '../components/editor/handles/handle-drag-history'
import { updateWallRegion } from './paint-regions'
import {
  buildOutlineRibbon,
  faceSurfacePoint,
  getWallFaceSurface,
  intersectFaceSurface,
  REGION_MIN_SIZE,
  regionHandlePlacements,
  regionOutline,
  resolveRegionBoundDrag,
  wallLocalMatrix,
  withRegionBounds,
} from './wall-region-handles'
import { wallRegionSnapTargets } from './wall-region-snap'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const straight = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2 })
const curved = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2, curveOffset: 0.8 })
const curvedBack = WallNode.parse({
  start: [0, 0],
  end: [4, 0],
  thickness: 0.2,
  curveOffset: -0.8,
})
const flat = () => 0

/** A ray that starts `distance` out from the face point at (u, y) and aims back at it. */
function rayAt(surface: ReturnType<typeof getWallFaceSurface>, u: number, y: number, distance = 3) {
  const point = faceSurfacePoint(surface, u)
  const origin = {
    x: point.x + point.nx * distance + 0.4,
    y: y + 0.7,
    z: point.z + point.nz * distance,
  }
  return {
    origin,
    direction: { x: point.x - origin.x, y: y - origin.y, z: point.z - origin.z },
  }
}

describe('wall face surface', () => {
  test('a straight face sits at its offset with an outward normal', () => {
    const offsets = getWallFaceOffsets(straight)
    const a = faceSurfacePoint(getWallFaceSurface(straight, 'a'), 1.5)
    const b = faceSurfacePoint(getWallFaceSurface(straight, 'b'), 1.5)
    expect(a).toEqual({ x: 1.5, z: offsets.a, nx: 0, nz: 1, tx: 1, tz: 0 })
    expect(b.z).toBe(offsets.b)
    expect(b.nz).toBe(-1)
  })

  for (const [label, wall] of [
    ['bulging right', curved],
    ['bulging left', curvedBack],
  ] as const) {
    test(`a curved face (${label}) follows the arc offset by the face offset`, () => {
      const offsets = getWallFaceOffsets(wall)
      for (const face of ['a', 'b'] as const) {
        const surface = getWallFaceSurface(wall, face)
        for (const t of [0.2, 0.5, 0.8]) {
          const frame = getWallCurveFrameAt(wall, t)
          const expected = {
            x: frame.point.x + frame.normal.x * offsets[face],
            z: frame.point.y + frame.normal.y * offsets[face],
          }
          const point = faceSurfacePoint(surface, expected.x)
          expect(point.z).toBeCloseTo(expected.z, 6)
          const outward = face === 'a' ? 1 : -1
          expect(point.nx).toBeCloseTo(frame.normal.x * outward, 6)
          expect(point.nz).toBeCloseTo(frame.normal.y * outward, 6)
          expect(point.tx).toBeCloseTo(frame.tangent.x, 6)
          expect(point.tz).toBeCloseTo(frame.tangent.y, 6)
        }
      }
    })
  }
})

describe('pointer on the face', () => {
  for (const [label, wall] of [
    ['straight', straight],
    ['curved', curved],
    ['curved the other way', curvedBack],
  ] as const) {
    test(`recovers u and y on a ${label} wall, both faces`, () => {
      for (const face of ['a', 'b'] as const) {
        const surface = getWallFaceSurface(wall, face)
        for (const [u, y] of [
          [0.4, 0.3],
          [2, 1.2],
          [3.5, 2.1],
        ] as const) {
          const { origin, direction } = rayAt(surface, u, y)
          const hit = intersectFaceSurface(surface, origin, direction)
          expect(hit?.u).toBeCloseTo(u, 6)
          expect(hit?.y).toBeCloseTo(y, 6)
        }
      }
    })
  }

  test('misses a ray running parallel to a straight face or pointing away', () => {
    const surface = getWallFaceSurface(straight, 'a')
    expect(intersectFaceSurface(surface, { x: 0, y: 1, z: 2 }, { x: 1, y: 0, z: 0 })).toBeNull()
    expect(intersectFaceSurface(surface, { x: 0, y: 1, z: 2 }, { x: 0, y: 0, z: 1 })).toBeNull()
  })

  test('a world ray maps through the wall-local frame of a rotated wall', () => {
    const wall = WallNode.parse({ start: [1, 2], end: [1, 6], thickness: 0.2 })
    const level = new Matrix4().makeTranslation(10, 3, -4)
    const local = wallLocalMatrix(wall, 0.25)
    const toWorld = level.clone().multiply(local)
    const surface = getWallFaceSurface(wall, 'b')
    const { origin, direction } = rayAt(surface, 2.5, 1.1)
    const worldOrigin = new Vector3(origin.x, origin.y, origin.z).applyMatrix4(toWorld)
    const worldTarget = new Vector3(
      origin.x + direction.x,
      origin.y + direction.y,
      origin.z + direction.z,
    ).applyMatrix4(toWorld)
    const ray = new Ray(worldOrigin, worldTarget.clone().sub(worldOrigin).normalize())
    ray.applyMatrix4(toWorld.clone().invert())
    const hit = intersectFaceSurface(surface, ray.origin, ray.direction)
    expect(hit?.u).toBeCloseTo(2.5, 6)
    expect(hit?.y).toBeCloseTo(1.1, 6)
  })
})

describe('bound drag', () => {
  const region: WallFaceRegion = { id: 'r1', face: 'a', u0: 1, u1: 2, v1: 0.9, finish: 'x' }
  const drag = (edge: 'u0' | 'u1' | 'v0' | 'v1', raw: number, extra = {}) =>
    resolveRegionBoundDrag({ region, edge, raw, length: 4, faceHeight: 2.5, ...extra })

  test('moves only the dragged bound', () => {
    expect(drag('v1', 1.234)).toEqual({ u0: 1, u1: 2, v1: 1.234 })
    expect(drag('u0', 0.5)).toEqual({ u0: 0.5, u1: 2, v1: 0.9 })
  })

  test('snaps to the grid step', () => {
    expect(drag('v1', 1.234, { gridStep: 0.1 }).v1).toBeCloseTo(1.2, 9)
    expect(drag('u1', 2.63, { gridStep: 0.25 }).u1).toBeCloseTo(2.75, 9)
  })

  test('keeps the minimum size against the opposite bound', () => {
    expect(drag('u0', 1.995).u0).toBeCloseTo(2 - REGION_MIN_SIZE, 9)
    expect(drag('u1', 0.2).u1).toBeCloseTo(1 + REGION_MIN_SIZE, 9)
    expect(drag('v1', -1).v1).toBeCloseTo(REGION_MIN_SIZE, 9)
  })

  test('a bound dragged onto or past the face edge becomes absent', () => {
    expect(drag('v1', 3)).toEqual({ u0: 1, u1: 2 })
    expect(drag('u0', -0.5)).toEqual({ u1: 2, v1: 0.9 })
    expect(drag('u1', 4)).toEqual({ u0: 1, v1: 0.9 })
  })

  test('an absent bound starts from the face edge when dragged in', () => {
    expect(drag('v0', 0.3)).toEqual({ u0: 1, u1: 2, v0: 0.3, v1: 0.9 })
    expect(drag('v0', 0.95).v0).toBeCloseTo(0.9 - REGION_MIN_SIZE, 9)
  })

  test('edge snapping pulls to other regions and the face edges, over the grid', () => {
    const others: WallFaceRegion[] = [
      region,
      { id: 'r2', face: 'a', u0: 2.47, finish: 'y' },
      { id: 'r3', face: 'b', u0: 2.6, finish: 'z' },
    ]
    const wall = { start: [0, 0], end: [4, 0], children: [], faceRegions: others } as never
    const snapTargets = wallRegionSnapTargets(wall, 'a', {}, null, { excludeRegionId: 'r1' }).u
    expect(snapTargets).toEqual([0, 2.47, 4])
    expect(drag('u1', 2.52, { gridStep: 0.1, edgeSnap: true, snapTargets }).u1).toBe(2.47)
    expect(drag('u1', 2.52, { gridStep: 0.1, snapTargets }).u1).toBeCloseTo(2.5, 9)
    expect(drag('v0', 0.05, { edgeSnap: true })).toEqual({ u0: 1, u1: 2, v1: 0.9 })
  })

  test('withRegionBounds replaces one region and keeps the rest', () => {
    const regions: WallFaceRegion[] = [region, { id: 'r2', face: 'b', v0: 1, finish: 'y' }]
    expect(withRegionBounds(regions, 'r1', { u0: 0.5 })).toEqual([
      { id: 'r1', face: 'a', u0: 0.5, finish: 'x' },
      regions[1]!,
    ])
  })
})

describe('handles and outline', () => {
  test('one handle per bounded edge, at mid-height / mid-width on the face', () => {
    const surface = getWallFaceSurface(straight, 'a')
    const placements = regionHandlePlacements(
      surface,
      { id: 'r', face: 'a', u0: 1, u1: 3, v1: 0.9, finish: 'x' },
      2.5,
      flat,
      null,
      0,
    )
    expect(placements.map((p) => p.edge)).toEqual(['u0', 'u1', 'v1'])
    expect(placements[0]!.position).toEqual([1, 0.45, 0.1])
    expect(placements[2]!.position).toEqual([2, 0.9, 0.1])
    expect(placements[2]!.tipAngle).toBeCloseTo(Math.PI / 2, 9)
  })

  test('a dragged edge keeps its handle after it goes absent', () => {
    const surface = getWallFaceSurface(straight, 'b')
    const region: WallFaceRegion = { id: 'r', face: 'b', u0: 1, finish: 'x' }
    expect(regionHandlePlacements(surface, region, 2.5, flat).map((p) => p.edge)).toEqual(['u0'])
    expect(regionHandlePlacements(surface, region, 2.5, flat, 'v1').map((p) => p.edge)).toEqual([
      'u0',
      'v1',
    ])
  })

  test('v follows the face base', () => {
    const surface = getWallFaceSurface(straight, 'a')
    const [handle] = regionHandlePlacements(
      surface,
      { id: 'r', face: 'a', v1: 1, finish: 'x' },
      2.5,
      () => -0.3,
    )
    expect(handle!.position[1]).toBeCloseTo(0.7, 9)
  })

  test('the outline of a curved region hugs the face', () => {
    const surface = getWallFaceSurface(curved, 'a')
    const outline = regionOutline(surface, { id: 'r', face: 'a', v1: 1, finish: 'x' }, 2.5, flat, 0)
    expect(outline.length).toBeGreaterThan(4)
    for (const point of outline) {
      expect(point.position[2]).toBeCloseTo(faceSurfacePoint(surface, point.position[0]).z, 6)
    }
    const ribbon = buildOutlineRibbon(outline, 0.01)
    expect(ribbon.length).toBe(outline.length * 6 * 3)
  })
})

describe('commit', () => {
  const WALL_ID = 'wall_region-handles-commit' as AnyNodeId
  const wall = () => useScene.getState().nodes[WALL_ID] as WallNode

  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    useScene.getState().createNode(
      WallNode.parse({
        id: WALL_ID,
        start: [0, 0],
        end: [4, 0],
        faceRegions: [
          { id: 'r1', face: 'a', v1: 0.9, finish: 'library:paint-white' },
          { id: 'r2', face: 'b', u0: 1, u1: 2, finish: 'library:paint-white' },
        ],
      }),
    )
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('a drag previews live and commits as one undo step', () => {
    const regions = wall().faceRegions!
    useScene.temporal.getState().pause()
    const bounds = resolveRegionBoundDrag({
      region: regions[0]!,
      edge: 'v1',
      raw: 1.2,
      length: 4,
      faceHeight: 2.5,
    })
    useLiveNodeOverrides
      .getState()
      .set(WALL_ID, { faceRegions: withRegionBounds(regions, 'r1', bounds) })
    expect(wall().faceRegions![0]!.v1).toBe(0.9)

    commitHandleDragPatch({
      patch: bounds,
      resumeHistory: () => useScene.temporal.getState().resume(),
      runAsSingleHistoryStep: (run) => runAsSingleSceneHistoryStep(useScene, run),
      commit: (next) => updateWallRegion(WALL_ID, 'r1', next),
    })
    useLiveNodeOverrides.getState().clear(WALL_ID)

    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(wall().faceRegions).toEqual([
      { id: 'r1', face: 'a', v1: 1.2, finish: 'library:paint-white' },
      regions[1]!,
    ])
    useScene.temporal.getState().undo()
    expect(wall().faceRegions![0]!.v1).toBe(0.9)
  })
})
