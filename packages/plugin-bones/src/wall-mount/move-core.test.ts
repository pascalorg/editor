import { describe, expect, test } from 'bun:test'
import { isMovedDeviceNode } from '../device/overrides'
import { RECEPTACLE_HEIGHT_BAND, SWITCH_HEIGHT_BAND } from '../engines/electrical'
import { DEVICE_TOL, endpointsOf, unreachableDevices } from '../engines/electrical.test-helpers'
import { extractServiceOverrides } from '../core/wall-model'
import type { Fixture } from '../core/types'
import { baselineConfig, baselineScene } from '../framing/baseline-scene'
import { computeLevel } from '../framing/compute'
import { isMovedPosition, projectWallT, wallGeom } from '../service/placement'
import {
  currentWallAnchor,
  DEVICE_BODY_DIMS,
  floorCommitPatch,
  floorLiveOverride,
  floorMoveTarget,
  heightBandFor,
  isWallMountedMoveNode,
  moveBodyDims,
  nearestWallMoveTarget,
  resolveWallMoveTarget,
  shouldIgnoreWallEventForMove,
  wallCommitPatch,
  wallLiveOverride,
} from './move-core'

/**
 * GATES for the window-parity wall-mount move (move-tool.tsx):
 *  - the #694 own-wall gate truth table (interposed hidden walls can't
 *    steal the drag; the own hidden wall keeps driving it in X-ray);
 *  - target resolution rules (clamping, snapping, on-axis plan point,
 *    night-5 height bands pre-applied for devices);
 *  - the commit + live-override shapes ROUTE THROUGH the engines:
 *    a committed anchor is an isMovedDeviceNode override, and computeLevel
 *    (→ applyDeviceOverrides) moves the box AND re-routes the wiring onto
 *    it — the same night-5 contract compute.devices.test.ts pins.
 */

// ─── #694 own-wall gate ──────────────────────────────────────────────

describe('shouldIgnoreWallEventForMove (#694 rule)', () => {
  test('a VISIBLE wall always drives the drag (cross-wall re-anchor stays possible)', () => {
    expect(
      shouldIgnoreWallEventForMove({
        eventWallId: 'w_other',
        eventWallHidden: false,
        ownWallIds: ['w_own', null],
      }),
    ).toBe(false)
  })

  test('the node\'s OWN wall drives the drag even while HIDDEN (X-ray)', () => {
    expect(
      shouldIgnoreWallEventForMove({
        eventWallId: 'w_own',
        eventWallHidden: true,
        ownWallIds: ['w_own', undefined],
      }),
    ).toBe(false)
    // ...including a mid-drag host that differs from the grab wall
    expect(
      shouldIgnoreWallEventForMove({
        eventWallId: 'w_host',
        eventWallHidden: true,
        ownWallIds: ['w_own', 'w_host'],
      }),
    ).toBe(false)
  })

  test('an INTERPOSED hidden wall is ignored (falls through to the own wall)', () => {
    expect(
      shouldIgnoreWallEventForMove({
        eventWallId: 'w_interposed',
        eventWallHidden: true,
        ownWallIds: ['w_own', null],
      }),
    ).toBe(true)
  })
})

// ─── Target resolution ───────────────────────────────────────────────

const straightWall = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'w_t',
  type: 'wall',
  parentId: 'level_1',
  start: [0, 0],
  end: [10, 0],
  thickness: 0.15,
  height: 2.5,
  ...over,
})

describe('resolveWallMoveTarget', () => {
  const device = { type: 'bones:device', deviceKind: 'receptacle' }

  test('projects the wall-local cursor into (t, heightAff) with the on-axis plan point', () => {
    const target = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: 2.5,
      localY: 0.38,
      body: DEVICE_BODY_DIMS,
      band: heightBandFor(device),
    })
    expect(target).not.toBeNull()
    expect(target!.t).toBeCloseTo(0.25, 9)
    expect(target!.heightAff).toBeCloseTo(0.38, 9)
    expect([...target!.plan]).toEqual([2.5, 0])
    // idempotent round-trip: the plan point projects back to the same t
    const geom = wallGeom(straightWall())!
    expect(projectWallT(geom, target!.plan)).toBeCloseTo(target!.t, 9)
  })

  test('clamps along-wall to the half body width and t to 0..1', () => {
    const target = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: -3,
      localY: 0.4,
      body: DEVICE_BODY_DIMS,
      band: null,
    })
    expect(target!.t).toBeCloseTo(DEVICE_BODY_DIMS[0] / 2 / 10, 9)
    const far = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: 99,
      localY: 0.4,
      body: DEVICE_BODY_DIMS,
      band: null,
    })
    expect(far!.t).toBeCloseTo(1 - DEVICE_BODY_DIMS[0] / 2 / 10, 9)
  })

  test('night-5 height rule: device heights pre-clamp into the NEC band', () => {
    const lowRecep = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: 5,
      localY: -1,
      body: DEVICE_BODY_DIMS,
      band: heightBandFor({ type: 'bones:device', deviceKind: 'receptacle' }),
    })
    expect(lowRecep!.heightAff).toBeCloseTo(RECEPTACLE_HEIGHT_BAND[0], 9)
    const highSwitch = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: 5,
      localY: 9,
      body: DEVICE_BODY_DIMS,
      band: heightBandFor({ type: 'bones:device', deviceKind: 'switch' }),
    })
    expect(highSwitch!.heightAff).toBeCloseTo(SWITCH_HEIGHT_BAND[1], 9)
  })

  test('service heights clamp to the wall body bounds (engines own the rest)', () => {
    const target = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: 5,
      localY: 99,
      body: [0.4, 0.6, 0.1],
      band: null,
    })
    expect(target!.heightAff).toBeCloseTo(2.5 - 0.3, 9)
  })

  test('the mode-aware snap applies to both axes BEFORE clamping', () => {
    const snap = (v: number) => Math.round(v / 0.5) * 0.5
    const target = resolveWallMoveTarget({
      wall: straightWall(),
      wallId: 'w_t',
      localX: 2.62,
      localY: 1.13,
      body: DEVICE_BODY_DIMS,
      band: null,
      snap,
    })
    expect(target!.t).toBeCloseTo(0.25, 9)
    expect(target!.heightAff).toBeCloseTo(1, 9)
  })

  test('curved / degenerate walls resolve to null (floor fallback covers them)', () => {
    expect(
      resolveWallMoveTarget({
        wall: straightWall({ curveOffset: 0.8 }),
        wallId: 'w_t',
        localX: 5,
        localY: 1,
        body: DEVICE_BODY_DIMS,
        band: null,
      }),
    ).toBeNull()
  })
})

describe('nearestWallMoveTarget (floor-cursor fallback)', () => {
  test('rides the nearest usable wall and carries the mount height', () => {
    const nodes = {
      w_a: straightWall({ id: 'w_a' }),
      w_b: straightWall({ id: 'w_b', start: [0, 5], end: [10, 5] }),
    }
    const target = nearestWallMoveTarget({
      nodes,
      node: { type: 'bones:device', parentId: 'level_1' },
      plan: [4, 4.2],
      heightAff: 0.38,
      body: DEVICE_BODY_DIMS,
      band: null,
    })
    expect(target!.wallId).toBe('w_b')
    expect(target!.t).toBeCloseTo(0.4, 9)
    expect(target!.heightAff).toBeCloseTo(0.38, 9)
  })
})

// ─── Preview + commit shapes ─────────────────────────────────────────

describe('live override / commit shapes', () => {
  const target = resolveWallMoveTarget({
    wall: straightWall(),
    wallId: 'w_t',
    localX: 2.5,
    localY: 0.38,
    body: DEVICE_BODY_DIMS,
    band: null,
  })!

  test('the live override position NEVER reads as the [0,0,0] sentinel — even at the level origin', () => {
    const originWall = straightWall({ start: [-5, 0], end: [5, 0] })
    const originTarget = resolveWallMoveTarget({
      wall: originWall,
      wallId: 'w_t',
      localX: 5, // the wall midpoint IS the level origin
      localY: 0.38,
      body: DEVICE_BODY_DIMS,
      band: null,
    })!
    const override = wallLiveOverride(originTarget)
    expect(isMovedPosition(override.position as readonly unknown[])).toBe(true)
  })

  test('commit writes the ANCHOR form with the position sentinel reset', () => {
    expect(wallCommitPatch(target)).toEqual({
      wallId: 'w_t',
      wallT: target.t,
      heightAff: target.heightAff,
      position: [0, 0, 0],
    })
  })

  test('a committed anchor IS an engine override (isMovedDeviceNode)', () => {
    const node = {
      type: 'bones:device',
      deviceId: 'recep-w_t-0-front',
      deviceKind: 'receptacle',
      seedWallId: 'w_t',
      seedWallT: 0.1,
      seedHeightAff: 0.38,
      wallId: 'w_t',
      wallT: 0.1,
      heightAff: 0.38,
      position: [0, 0, 0],
      ...wallCommitPatch(target),
    }
    expect(isMovedDeviceNode(node)).toBe(true)
  })

  test('floor commit keeps the plan point; the exact origin is epsilon-guarded', () => {
    expect(floorCommitPatch(floorMoveTarget([3.5, -2]))).toEqual({ position: [3.5, 0, -2] })
    const origin = floorCommitPatch(floorMoveTarget([0, 0]))
    expect(isMovedPosition(origin.position as readonly unknown[])).toBe(true)
    const snapped = floorMoveTarget([3.24, -1.98], (v) => Math.round(v / 0.5) * 0.5)
    expect([...snapped.plan]).toEqual([3, -2])
    expect(isMovedPosition(floorLiveOverride(snapped).position as readonly unknown[])).toBe(true)
  })
})

// ─── Kind routing ────────────────────────────────────────────────────

describe('kind routing', () => {
  test('devices and wall service types slide on walls; floor service types stay planar', () => {
    expect(isWallMountedMoveNode({ type: 'bones:device', deviceKind: 'switch' })).toBe(true)
    expect(isWallMountedMoveNode({ type: 'bones:service', serviceType: 'panel' })).toBe(true)
    expect(isWallMountedMoveNode({ type: 'bones:service', serviceType: 'electric-meter' })).toBe(
      true,
    )
    expect(isWallMountedMoveNode({ type: 'bones:service', serviceType: 'heat-pump' })).toBe(false)
    expect(isWallMountedMoveNode({ type: 'bones:service', serviceType: 'sewer-exit' })).toBe(false)
  })

  test('ghost bodies: engine box for devices, SERVICE_BODY dims for services', () => {
    expect(moveBodyDims({ type: 'bones:device' })).toEqual(DEVICE_BODY_DIMS)
    expect(moveBodyDims({ type: 'bones:service', serviceType: 'panel' })).toEqual([0.4, 0.6, 0.1])
  })

  test('grab-time anchor mirrors the renderer precedence', () => {
    const nodes = { w_t: straightWall() }
    // stored anchor
    expect(
      currentWallAnchor(nodes, {
        type: 'bones:device',
        deviceKind: 'receptacle',
        parentId: 'level_1',
        wallId: 'w_t',
        wallT: 0.5,
        heightAff: 0.38,
        position: [0, 0, 0],
      }),
    ).toEqual({ wallId: 'w_t', heightAff: 0.38 })
    // moved position → nearest wall
    expect(
      currentWallAnchor(nodes, {
        type: 'bones:device',
        deviceKind: 'receptacle',
        parentId: 'level_1',
        wallId: 'w_gone',
        wallT: 0.5,
        heightAff: 0.38,
        position: [4, 0.0001, 0.5],
      }).wallId,
    ).toBe('w_t')
  })
})

// ─── The engine routing contract (night-5 gates as the contract) ─────

const seededNodesFor = (
  scene: Record<string, Record<string, unknown>>,
  config: ReturnType<typeof baselineConfig>,
): Record<string, Record<string, unknown>> => {
  const base = computeLevel(scene, config)
  const out = { ...scene }
  base.devices.forEach((d, i) => {
    const id = `bonesdevice_${String(i).padStart(3, '0')}`
    out[id] = {
      id,
      type: 'bones:device',
      parentId: 'level_1',
      visible: true,
      deviceId: d.deviceId,
      deviceKind: d.deviceKind,
      wallId: d.wallId,
      wallT: d.wallT,
      heightAff: d.heightAff,
      seedWallId: d.wallId,
      seedWallT: d.wallT,
      seedHeightAff: d.heightAff,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
  })
  return out
}

describe('move flow ROUTES THROUGH applyDeviceOverrides (computeLevel end-to-end)', () => {
  const config = () => baselineConfig('INTL')

  const pickTarget = (scene: Record<string, Record<string, unknown>>) => {
    const base = computeLevel(scene, config())
    const derived = base.devices.find((d) => d.deviceKind !== 'switch' && d.wallId === 'w_n')
    expect(derived).toBeDefined()
    return { base, derived: derived! }
  }

  test('COMMIT: the anchor write moves the box and the wiring lands ON it (E2 holds)', () => {
    const scene = baselineScene()
    const { base, derived } = pickTarget(scene)
    const baseFx = base.fixtures.find((f) => f.meta?.deviceId === derived.deviceId) as Fixture

    const moved = seededNodesFor(scene, config())
    const nodeId = Object.keys(moved).find((k) => moved[k]?.deviceId === derived.deviceId)!
    const wall = moved[derived.wallId] as Record<string, unknown>
    const geom = wallGeom(wall)!
    const length = Math.hypot(geom.end[0] - geom.start[0], geom.end[1] - geom.start[1])

    // The move tool's exact pipeline: wall-local cursor → target → commit.
    const target = resolveWallMoveTarget({
      wall,
      wallId: derived.wallId,
      localX: Math.min(1, derived.wallT + 0.08) * length,
      localY: 0.9,
      body: DEVICE_BODY_DIMS,
      band: heightBandFor({ type: 'bones:device', deviceKind: derived.deviceKind }),
    })!
    moved[nodeId] = { ...moved[nodeId], ...wallCommitPatch(target) }

    const result = computeLevel(moved, config())
    const movedFx = result.fixtures.find((f) => f.meta?.deviceId === derived.deviceId) as Fixture
    expect(movedFx).toBeDefined()
    // the box moved and honors the committed height (band-legal, no clamp warn)
    expect(movedFx.position).not.toEqual(baseFx.position)
    expect(movedFx.position[1]).toBeCloseTo(0.9, 6)
    expect(result.warnings.some((w) => w.includes('height clamped'))).toBe(false)
    // a wire endpoint lands ON the moved box (routeWiring consumed the
    // post-override position — applyDeviceOverrides ran)
    const wires = result.members.filter((m) => m.role === 'wire-run')
    const onBox = wires.some((w) =>
      endpointsOf(w).some(
        (e) =>
          Math.hypot(
            e.x - movedFx.position[0],
            e.y - movedFx.position[1],
            e.z - movedFx.position[2],
          ) < DEVICE_TOL,
      ),
    )
    expect(onBox).toBe(true)
    // panel-reachability is not broken by the move (checklist E2)
    expect(unreachableDevices(result.members, result.fixtures)).toEqual([])
  })

  test('LIVE PREVIEW: the drag override (position riding the wall axis) moves the box mid-gesture', () => {
    const scene = baselineScene()
    const { base, derived } = pickTarget(scene)
    const baseFx = base.fixtures.find((f) => f.meta?.deviceId === derived.deviceId) as Fixture

    const live = seededNodesFor(scene, config())
    const nodeId = Object.keys(live).find((k) => live[k]?.deviceId === derived.deviceId)!
    const wall = live[derived.wallId] as Record<string, unknown>
    const geom = wallGeom(wall)!
    const length = Math.hypot(geom.end[0] - geom.start[0], geom.end[1] - geom.start[1])
    const target = resolveWallMoveTarget({
      wall,
      wallId: derived.wallId,
      localX: Math.min(1, derived.wallT + 0.1) * length,
      localY: 1.1,
      body: DEVICE_BODY_DIMS,
      band: heightBandFor({ type: 'bones:device', deviceKind: derived.deviceKind }),
    })!
    // What effectiveNodesFor (framing/live.ts) produces during the drag.
    live[nodeId] = { ...live[nodeId], ...wallLiveOverride(target) }

    const result = computeLevel(live, config())
    const liveFx = result.fixtures.find((f) => f.meta?.deviceId === derived.deviceId) as Fixture
    expect(liveFx).toBeDefined()
    expect(liveFx.position).not.toEqual(baseFx.position)
    expect(liveFx.position[1]).toBeCloseTo(1.1, 6)
  })

  test('SERVICE commit: the anchor lands in extractServiceOverrides', () => {
    const nodes = {
      w_t: straightWall(),
      svc: {
        id: 'svc',
        type: 'bones:service',
        parentId: 'level_1',
        visible: true,
        serviceType: 'panel',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        ...wallCommitPatch(
          resolveWallMoveTarget({
            wall: straightWall(),
            wallId: 'w_t',
            localX: 7,
            localY: 1.5,
            body: [0.4, 0.6, 0.1],
            band: null,
          })!,
        ),
      },
    }
    const { overrides } = extractServiceOverrides(nodes as never, 'level_1')
    expect(overrides.panel).toBeDefined()
    expect(overrides.panel!.wallId).toBe('w_t')
    expect(overrides.panel!.wallT).toBeCloseTo(0.7, 9)
    expect(overrides.panel!.heightAff).toBeCloseTo(1.5, 9)
  })
})
