import { describe, expect, test } from 'bun:test'
import { totalsBySystem } from '../geometry/totals'
import { ServicePointNode, UtilityLineNode, UtilityPoleNode } from '../schema'
import { planAutoMeter } from '../service-point/auto-meter'
import { resolveServicePointDrop, servicePointDropPatch } from '../service-point/floorplan-move'
import type { LooseNodes } from '../site-frame'
import { siteToLocal } from '../site-frame'
import {
  DEFAULT_OVERHEAD_HEIGHT,
  poleAttachmentPoint,
  resolveLineEndpoints,
  SERVICE_DROP_MIN_HEIGHT,
} from '../utility-line/endpoints'
import { burialDepthOf } from '../utility-line/floorplan'
import { crossarmPinOffset, POLE_CROSSARM_DROP } from '../utility-pole/geometry'

/**
 * A minimal scene: one building at the origin, one wall running east along
 * its south face, a pole out west, a meter half way along the wall, and an
 * overhead power drop between them.
 *
 * The wall lives in BUILDING-LOCAL metres (that is the frame `wall.start` /
 * `wall.end` are stored in) and everything else in SITE metres; with the
 * building at the origin the two coincide, which keeps the expectations
 * readable. The frame conversion itself is covered by `site-frame.test.ts`.
 */
const WALL = {
  id: 'wall_1',
  type: 'wall',
  start: [0, 0],
  end: [10, 0],
  thickness: 0.2,
  height: 3,
}
/** Standoff `resolveServicePoint` puts the body proud of the wall face. */
const STANDOFF = WALL.thickness / 2 + 0.06

const building = (position: [number, number, number] = [0, 0, 0]) => ({
  id: 'bld_1',
  type: 'building',
  position,
  rotation: [0, 0, 0],
})

const pole = (patch: Record<string, unknown> = {}) =>
  UtilityPoleNode.parse({ id: 'utilpl_1', parentId: 'bld_1', position: [-5, 0, 0], ...patch })

const meter = (patch: Record<string, unknown> = {}) =>
  ServicePointNode.parse({
    id: 'utilsp_1',
    parentId: 'bld_1',
    serviceKind: 'electric-meter',
    wallId: 'wall_1',
    wallT: 0.5,
    ...patch,
  })

const drop = (patch: Record<string, unknown> = {}) =>
  UtilityLineNode.parse({
    id: 'utilln_1',
    parentId: 'bld_1',
    system: 'power',
    routing: 'overhead',
    sagRatio: 0,
    fromRef: 'utilpl_1',
    toRef: 'utilsp_1',
    // Deliberately the BROKEN stored path: a burial depth at both ends, which
    // is what a run drawn underground and flipped to overhead carries. The
    // resolver must ignore both ends and derive them.
    path: [
      [-5, -0.75, 0],
      [5, -0.75, -STANDOFF],
    ],
    ...patch,
  })

const scene = (...nodes: Array<Record<string, unknown>>): LooseNodes =>
  Object.fromEntries(nodes.map((node) => [String(node.id), node])) as LooseNodes

describe('linked endpoints are derived, never stored', () => {
  test('the start comes off the pole crossarm and the end off the meter', () => {
    const nodes = scene(building(), WALL, pole(), meter(), drop())
    const resolved = resolveLineEndpoints(nodes, drop())

    expect(resolved.from?.kind).toBe('pole')
    expect(resolved.to?.kind).toBe('service-point')
    expect(resolved.derivedIndices).toEqual([0, 1])

    const start = resolved.path[0]!
    // Out along the crossarm, on the side facing the house.
    expect(start[0]).toBeCloseTo(-5 + crossarmPinOffset(), 9)
    expect(start[2]).toBeCloseTo(0, 9)

    const end = resolved.path[1]!
    expect(end[0]).toBeCloseTo(5, 9)
    expect(end[2]).toBeCloseTo(-STANDOFF, 9)
  })

  test('moving the pole moves the start of the run', () => {
    const line = drop()
    const before = resolveLineEndpoints(scene(building(), WALL, pole(), meter(), line), line)
    const after = resolveLineEndpoints(
      scene(building(), WALL, pole({ position: [-9, 0, 2] }), meter(), line),
      line,
    )
    expect(after.path[0]![0]).toBeCloseTo(-9 + crossarmPinOffset(), 9)
    expect(after.path[0]![2]).toBeCloseTo(2, 9)
    expect(after.path[0]![0]).not.toBeCloseTo(before.path[0]![0], 6)
    // And nothing was written back into `path` — the node is untouched.
    expect(line.path[0]![0]).toBe(-5)
  })

  test('moving the meter along its wall moves the end of the run', () => {
    const line = drop()
    const after = resolveLineEndpoints(
      scene(building(), WALL, pole(), meter({ wallT: 0.9 }), line),
      line,
    )
    expect(after.path[1]![0]).toBeCloseTo(9, 9)
  })

  test('re-hosting the meter onto another wall moves the end there too', () => {
    const other = { ...WALL, id: 'wall_2', start: [0, 6], end: [10, 6] }
    const line = drop()
    const after = resolveLineEndpoints(
      scene(building(), WALL, other, pole(), meter({ wallId: 'wall_2', wallT: 0.25 }), line),
      line,
    )
    expect(after.path[1]![0]).toBeCloseTo(2.5, 9)
    expect(after.path[1]![2]).toBeCloseTo(6 - STANDOFF, 9)
  })

  test('the crossarm side follows the run, and turning the pole turns it', () => {
    const line = drop()
    const east = resolveLineEndpoints(scene(building(), WALL, pole(), meter(), line), line)
    // The house is east of the pole, so the span leaves the +arm pin.
    expect(east.path[0]![0]).toBeGreaterThan(-5)
    // A quarter turn puts the arm on the site z axis; the pin nearest the
    // house is now the one at −z (the run heads north-east of the butt).
    const turned = resolveLineEndpoints(
      scene(building(), WALL, pole({ yaw: Math.PI / 2 }), meter(), line),
      line,
    )
    expect(turned.path[0]![0]).toBeCloseTo(-5, 9)
    expect(Math.abs(turned.path[0]![2])).toBeCloseTo(crossarmPinOffset(), 9)
  })

  test('a dangling ref falls back to the stored vertex instead of dropping the run', () => {
    const line = drop()
    const resolved = resolveLineEndpoints(scene(building(), WALL, meter(), line), line)
    expect(resolved.from).toBeNull()
    expect(resolved.derivedIndices).toEqual([1])
    expect(resolved.path[0]![0]).toBe(-5)
  })

  test('an unlinked run is returned as stored, in plan', () => {
    const line = drop({ fromRef: null, toRef: null })
    const resolved = resolveLineEndpoints(scene(building(), WALL, line), line)
    expect(resolved.derivedIndices).toEqual([])
    expect(resolved.path.map((p) => [p[0], p[2]])).toEqual([
      [-5, 0],
      [5, -STANDOFF],
    ])
  })

  test('stored intermediate vertices survive; only the ends are derived', () => {
    const line = drop({
      path: [
        [-5, -0.75, 0],
        [0, 7, 3],
        [5, -0.75, -STANDOFF],
      ],
    })
    const resolved = resolveLineEndpoints(scene(building(), WALL, pole(), meter(), line), line)
    expect(resolved.path).toHaveLength(3)
    expect(resolved.derivedIndices).toEqual([0, 2])
    expect(resolved.path[1]![0]).toBe(0)
    expect(resolved.path[1]![2]).toBe(3)
  })
})

describe('overhead service-drop heights', () => {
  test('a drop runs from the crossarm down to the drip-loop height, never at grade', () => {
    const line = drop()
    const resolved = resolveLineEndpoints(scene(building(), WALL, pole(), meter(), line), line)

    const start = resolved.path[0]![1]
    const end = resolved.path[1]![1]
    // Start: pole top minus the crossarm drop.
    expect(start).toBeCloseTo(pole().height - POLE_CROSSARM_DROP, 9)
    // End: the meter sits at 1.5 m, but the point of attachment is lifted to
    // the NEC 230.24(B)(1) 10 ft (3.0 m) drip-loop clearance.
    expect(SERVICE_DROP_MIN_HEIGHT).toBe(3)
    expect(end).toBeCloseTo(SERVICE_DROP_MIN_HEIGHT, 9)
    expect(end).toBeGreaterThanOrEqual(3)
    // It is a real 3D drop, not a flat line — and above all not the stored
    // −0.75 that put it in the floor.
    expect(start - end).toBeGreaterThan(5)
    expect(Math.min(start, end)).toBeGreaterThan(0)
  })

  test('a meter mounted above 3 m keeps its own height', () => {
    const line = drop()
    const resolved = resolveLineEndpoints(
      scene(building(), WALL, pole(), meter({ height: 4.2 }), line),
      line,
    )
    expect(resolved.path[1]![1]).toBeCloseTo(4.2, 9)
  })

  test('an unlinked overhead run with no elevation data gets the drawing default', () => {
    const line = drop({ fromRef: null, toRef: null })
    const resolved = resolveLineEndpoints(scene(building(), WALL, line), line)
    for (const vertex of resolved.path) {
      expect(vertex[1]).toBeCloseTo(DEFAULT_OVERHEAD_HEIGHT, 9)
    }
  })

  test('intermediate vertices with no elevation data are interpolated between the ends', () => {
    const line = drop({
      path: [
        [-5, -0.75, 0],
        [0, -0.75, 0],
        [5, -0.75, -STANDOFF],
      ],
    })
    const resolved = resolveLineEndpoints(scene(building(), WALL, pole(), meter(), line), line)
    const a = resolved.path[0]!
    const b = resolved.path[1]!
    const c = resolved.path[2]!
    expect(b[1]).toBeGreaterThan(c[1])
    expect(b[1]).toBeLessThan(a[1])
    // No vertex is left at or under grade — that was the reported defect.
    for (const vertex of resolved.path) expect(vertex[1]).toBeGreaterThan(0)
  })

  test('real stored heights are respected rather than overwritten', () => {
    const line = drop({
      path: [
        [-5, 9, 0],
        [0, 7, 0],
        [5, 4, -STANDOFF],
      ],
    })
    const resolved = resolveLineEndpoints(scene(building(), WALL, pole(), meter(), line), line)
    expect(resolved.path[1]![1]).toBeCloseTo(7, 9)
  })

  test('poleAttachmentPoint is the pole top minus the crossarm drop, off the butt', () => {
    const raised = pole({ position: [0, 1.4, 0] })
    const point = poleAttachmentPoint(raised, [10, 0])
    expect(point[1]).toBeCloseTo(1.4 + raised.height - POLE_CROSSARM_DROP, 9)
  })
})

describe('underground runs sit below GRADE, not below the building origin', () => {
  /**
   * The building is lifted 0.5 m. Before this change the stored −0.75 went
   * straight into the building-local frame, so the trench and the buried tube
   * rode up with the building and the reported cover was wrong by the origin
   * offset. Now the stored y is a cover BELOW GRADE and the absolute
   * elevation is grade + y, whatever the building does.
   */
  const raised = building([3, 0.5, -2])
  const buried = (patch: Record<string, unknown> = {}) =>
    UtilityLineNode.parse({
      id: 'utilln_2',
      parentId: 'bld_1',
      system: 'water',
      routing: 'underground',
      path: [
        [0, -0.75, 0],
        [12, -0.75, 0],
      ],
      ...patch,
    })

  test('the resolved elevation is grade + cover, independent of the building', () => {
    const line = buried()
    const flat = resolveLineEndpoints(scene(building(), line), line)
    const lifted = resolveLineEndpoints(scene(raised, line), line)
    for (const vertex of [...flat.path, ...lifted.path]) {
      expect(vertex[1]).toBeCloseTo(-0.75, 9)
    }
  })

  test('the reported cover is 0.75 m either way', () => {
    const line = buried()
    expect(burialDepthOf(resolveLineEndpoints(scene(building(), line), line).path)).toBeCloseTo(
      0.75,
      9,
    )
    expect(burialDepthOf(resolveLineEndpoints(scene(raised, line), line).path)).toBeCloseTo(0.75, 9)
  })

  test('the building-local y compensates for the origin, so the pipe renders at −0.75 in world', () => {
    const line = buried()
    const site = resolveLineEndpoints(scene(raised, line), line).path[0]!
    const local = siteToLocal({ id: 'bld_1', origin: [3, 0.5, -2], yaw: 0 }, site)
    expect(local[1]).toBeCloseTo(-1.25, 9)
    // world = origin.y + local.y = 0.5 + (−1.25) = −0.75. Below grade.
    expect(0.5 + local[1]).toBeCloseTo(-0.75, 9)
  })

  test('a buried run that ends on a meter stays buried at the meter', () => {
    const line = buried({
      toRef: 'utilsp_1',
      path: [
        [0, -0.9, 0],
        [5, -0.9, 0],
      ],
    })
    const resolved = resolveLineEndpoints(scene(building(), WALL, meter(), line), line)
    expect(resolved.path[1]![1]).toBeCloseTo(-0.9, 9)
    expect(resolved.path[1]![0]).toBeCloseTo(5, 9)
  })
})

describe('totals are measured on the resolved run', () => {
  test('a linked run is billed to where its ends actually are', () => {
    const line = drop({ sagRatio: 0 })
    const nodes = scene(building(), WALL, pole(), meter(), line)
    const stale = totalsBySystem([line])[0]!
    const resolved = totalsBySystem([line], nodes)[0]!
    // The stored path is a flat 10 m at burial depth; the real run climbs
    // from the crossarm at 10.068 m down to 3 m, so it is longer.
    expect(stale.metres).toBeCloseTo(10, 2)
    expect(resolved.metres).toBeGreaterThan(stale.metres)
  })

  test('moving the pole changes the take-off', () => {
    const line = drop({ sagRatio: 0 })
    const near = totalsBySystem([line], scene(building(), WALL, pole(), meter(), line))[0]!
    const far = totalsBySystem(
      [line],
      scene(building(), WALL, pole({ position: [-25, 0, 0] }), meter(), line),
    )[0]!
    expect(far.metres).toBeGreaterThan(near.metres + 15)
  })
})

describe('auto-meter on the last click of an overhead power run', () => {
  test('a click near a wall with no meter plans a new one at the projected wallT', () => {
    const plan = planAutoMeter(scene(building(), WALL), [7.5, -0.9])
    expect(plan).toEqual({ kind: 'create', wallId: 'wall_1', wallT: 0.75 })
  })

  test('a click near an existing meter on that wall binds to it instead', () => {
    const plan = planAutoMeter(scene(building(), WALL, meter()), [5.4, -0.9])
    expect(plan).toEqual({ kind: 'bind', nodeId: 'utilsp_1' })
  })

  test('a meter far along the same wall is not dragged over', () => {
    const plan = planAutoMeter(scene(building(), WALL, meter({ wallT: 0.05 })), [9, -0.9])
    expect(plan.kind).toBe('create')
  })

  test('a click out in the yard plans nothing', () => {
    expect(planAutoMeter(scene(building(), WALL), [5, -6]).kind).toBe('none')
  })
})

describe('a dragged service point re-anchors on drop', () => {
  const nodes = scene(building(), WALL, meter())

  test('a drop near its own wall slides along it', () => {
    const result = resolveServicePointDrop(nodes, [8, -0.4], [8, -0.4], 1.5)
    expect(result).toEqual({ kind: 'wall', wallId: 'wall_1', wallT: 0.8 })
    expect(servicePointDropPatch(result)).toEqual({
      wallId: 'wall_1',
      wallT: 0.8,
      position: [0, 0, 0],
    })
  })

  test('a drop near a different wall re-hosts onto it', () => {
    const two = scene(building(), WALL, { ...WALL, id: 'wall_2', start: [0, 6], end: [10, 6] })
    const result = resolveServicePointDrop(two, [3, 6.4], [3, 6.4], 1.5)
    expect(result).toEqual({ kind: 'wall', wallId: 'wall_2', wallT: 0.3 })
  })

  test('a drop away from every wall goes free-standing, and clears the anchor', () => {
    const result = resolveServicePointDrop(nodes, [5, -9], [5, -9], 1.5)
    expect(result).toEqual({ kind: 'free', position: [5, 1.5, -9] })
    expect(servicePointDropPatch(result)).toEqual({
      wallId: null,
      wallT: null,
      position: [5, 1.5, -9],
    })
  })
})
