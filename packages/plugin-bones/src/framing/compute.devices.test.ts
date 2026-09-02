import { describe, expect, test } from 'bun:test'
import baseline from './master-baseline.json'
import type { Fixture } from '../core/types'
import { DEVICE_TOL, endpointsOf, unreachableDevices } from '../engines/electrical.test-helpers'
import { DEFAULT_SPEC } from '../core/spec'
import { applyDeviceOverrides, layoutElectrical } from '../engines/electrical'
import { frameWall } from '../engines/wall-framing'
import { layoutWallLayers } from '../engines/wall-layers'
import { baselineConfig, baselineScene } from './baseline-scene'
import { computeLevel, splitBattsAroundBlocking } from './compute'
import { FramingNode } from './schema'

/**
 * Movable outlets — computeLevel integration + the CRITICAL S6-style
 * byte-equality regression:
 *  - a scene with ZERO device nodes/overrides computes members STRICTLY
 *    byte-equal to MASTER (pinned in master-baseline.json, captured at
 *    724d9ad before this feature) and fixtures identical except the added
 *    `meta.deviceId` key;
 *  - a scene of SEEDED-BUT-UNMOVED device nodes stays byte-equal too (the
 *    reconciler's creations change nothing);
 *  - a MOVED node re-routes the wiring to the moved box (wire endpoint ON
 *    the box, E2 continuity preserved), warns on RO-forced spots, and
 *    duplicate nodes warn like duplicate service points;
 *  - result.devices manifests every device fixture 1:1.
 */

type BaselineEntry = {
  members: unknown[]
  fixtures: { kind: string; meta?: Record<string, unknown> }[]
  warnings: string[]
}

/** JSON-normalized (−0 → 0, exact float round-trip) deep clone. */
const norm = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Strip exactly the ONE added meta key. */
const stripDeviceIds = (fixtures: Fixture[]): unknown[] =>
  norm(fixtures).map((f: Fixture) => {
    if (!f.meta || !('deviceId' in f.meta)) return f
    const { deviceId: _dropped, ...rest } = f.meta
    return { ...f, meta: rest }
  })

describe('BYTE-EQUALITY vs master (zero device nodes/overrides)', () => {
  for (const jurisdiction of ['INTL', 'TX'] as const) {
    test(`${jurisdiction}: members strictly byte-equal; fixtures equal minus meta.deviceId`, () => {
      const pinned = (baseline as Record<string, BaselineEntry>)[jurisdiction] as BaselineEntry
      const result = computeLevel(baselineScene(), baselineConfig(jurisdiction))
      expect(norm(result.members)).toEqual(pinned.members as never)
      expect(stripDeviceIds(result.fixtures)).toEqual(pinned.fixtures as never)
      expect(norm(result.warnings)).toEqual(pinned.warnings as never)
      // and the ONLY meta delta really is deviceId, on device kinds only
      for (const f of result.fixtures) {
        const isDevice =
          f.kind === 'receptacle' ||
          f.kind === 'receptacle-gfci' ||
          f.kind === 'receptacle-wr-gfci' ||
          f.kind === 'switch'
        expect(typeof f.meta?.deviceId === 'string').toBe(isDevice)
      }
    })
  }
})

// ---- integration scenes -----------------------------------------------------

const seededNodesFor = (
  scene: Record<string, Record<string, unknown>>,
  config: FramingNode,
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

describe('computeLevel — device nodes end to end', () => {
  const config = () => baselineConfig('INTL')

  test('result.devices manifests every device fixture 1:1, unique ids', () => {
    const result = computeLevel(baselineScene(), config())
    const deviceFixtures = result.fixtures.filter(
      (f) =>
        f.kind === 'receptacle' ||
        f.kind === 'receptacle-gfci' ||
        f.kind === 'receptacle-wr-gfci' ||
        f.kind === 'switch',
    )
    expect(result.devices.length).toBe(deviceFixtures.length)
    const ids = result.devices.map((d) => d.deviceId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of result.devices) {
      expect(d.wallT).toBeGreaterThanOrEqual(0)
      expect(d.wallT).toBeLessThanOrEqual(1)
    }
  })

  test('SEEDED-BUT-UNMOVED nodes: members + fixtures byte-equal to the node-less scene', () => {
    const scene = baselineScene()
    const base = computeLevel(scene, config())
    const seeded = computeLevel(seededNodesFor(scene, config()), config())
    expect(seeded.members).toEqual(base.members)
    expect(seeded.fixtures).toEqual(base.fixtures)
    expect(seeded.warnings).toEqual(base.warnings)
  })

  test('MOVED node: the box moves, the wiring lands ON the moved box, E2 continuity holds', () => {
    const scene = baselineScene()
    const base = computeLevel(scene, config())
    const target = base.devices.find(
      (d) => d.deviceKind !== 'switch' && d.wallId === 'w_n',
    ) as NonNullable<(typeof base.devices)[number]>
    expect(target).toBeDefined()
    const baseFx = base.fixtures.find((f) => f.meta?.deviceId === target.deviceId) as Fixture

    const movedScene = seededNodesFor(scene, config())
    const nodeId = Object.keys(movedScene).find(
      (k) => movedScene[k]?.deviceId === target.deviceId,
    ) as string
    movedScene[nodeId] = {
      ...(movedScene[nodeId] as Record<string, unknown>),
      wallT: Math.min(1, target.wallT + 0.08),
      heightAff: 0.9,
    }
    const moved = computeLevel(movedScene, config())
    const movedFx = moved.fixtures.find((f) => f.meta?.deviceId === target.deviceId) as Fixture
    expect(movedFx).toBeDefined()
    // the box moved (position wins, engine-snapped)
    expect(movedFx.position).not.toEqual(baseFx.position)
    expect(movedFx.position[1]).toBeCloseTo(0.9, 6)
    // a wire endpoint lands ON the moved box (routeWiring consumed the
    // post-override position)
    const wires = moved.members.filter((m) => m.role === 'wire-run')
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
    expect(unreachableDevices(moved.members, moved.fixtures)).toEqual([])
  })

  test('RO-forced override warns (service parity); duplicates warn', () => {
    const scene = baselineScene()
    const base = computeLevel(scene, config())
    const target = base.devices.find(
      (d) => d.wallId === 'w_s' && d.deviceKind !== 'switch',
    ) as NonNullable<(typeof base.devices)[number]>
    const movedScene = seededNodesFor(scene, config())
    const nodeId = Object.keys(movedScene).find(
      (k) => movedScene[k]?.deviceId === target.deviceId,
    ) as string
    // door_front sits at u=3 on the 12 m south wall → wallT 0.25
    movedScene[nodeId] = {
      ...(movedScene[nodeId] as Record<string, unknown>),
      wallT: 0.25,
    }
    // plus a duplicate node for the same deviceId
    movedScene.bonesdevice_dup = {
      id: 'bonesdevice_dup',
      type: 'bones:device',
      parentId: 'level_1',
      visible: true,
      deviceId: target.deviceId,
      deviceKind: target.deviceKind,
      wallId: target.wallId,
      wallT: 0.9,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
    const result = computeLevel(movedScene, config())
    expect(result.warnings.some((w) => w.includes('rough opening'))).toBe(true)
    expect(
      result.warnings.some((w) =>
        w.includes(`duplicate device node (${target.deviceId}) — extra node ignored`),
      ),
    ).toBe(true)
    // the box itself is OUT of the RO band (snapped clear, never a squatter)
    const fx = result.fixtures.find((f) => f.meta?.deviceId === target.deviceId) as Fixture
    const u = fx.position[0] // w_s runs +X from x=0
    expect(u < 3 - 0.475 || u > 3 + 0.475).toBe(true)
  })

  test('electrical OFF: no manifest, no device meta anywhere', () => {
    const scene = baselineScene()
    const config = FramingNode.parse({
      id: 'bonesframing_off',
      parentId: 'level_1',
      jurisdiction: 'INTL',
      detail: '400',
      studSpacingIn: 16,
      showElectrical: false,
    })
    const result = computeLevel(scene, config)
    expect(result.devices).toEqual([])
    expect(result.fixtures.every((f) => f.meta?.deviceId === undefined)).toBe(true)
  })
})

describe('night-4 batch fixes (F2 twin overrides, F3 batt notching)', () => {
  test('F2: an override committed against a DROPPED colinear twin lands on the kept run', () => {
    const scene = baselineScene()
    // draw an overlapping shorter twin of the 12m south wall carrying no
    // devices of its own — dedupe drops it, drags may still commit its id
    scene.wall_twin = {
      id: 'wall_twin',
      type: 'wall',
      parentId: 'level_1',
      start: [2, 0],
      end: [10, 0],
      thickness: 0.15,
      height: 2.5,
      children: [],
    }
    const base = computeLevel(scene, baselineConfig('INTL'))
    expect(base.duplicateOf.wall_twin).toBe('w_s')
    const target = base.devices.find(
      (d) => d.wallId === 'w_s' && d.deviceKind !== 'switch',
    ) as NonNullable<(typeof base.devices)[number]>
    // override committed against the twin: wallT 0.75 on the 8m twin
    // = world x = 2 + 6 = 8 → wallT 8/12 on the kept 12m wall
    scene.bonesdevice_twin = {
      id: 'bonesdevice_twin',
      type: 'bones:device',
      parentId: 'level_1',
      visible: true,
      deviceId: target.deviceId,
      deviceKind: target.deviceKind,
      wallId: 'wall_twin',
      wallT: 0.75,
      heightAff: 0.38,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
    const result = computeLevel({ ...scene }, baselineConfig('INTL'))
    const fx = result.fixtures.find((f) => f.meta?.deviceId === target.deviceId) as Fixture
    // lands near world x=8 on the kept south wall (stud-snap may nudge)
    expect(Math.abs(fx.position[0] - 8)).toBeLessThan(0.5)
    expect(Math.abs(fx.position[2])).toBeLessThan(0.2)
    // no silent-fallback spacing false alarm on an untouched-wall basis
    expect(result.warnings.some((w) => w.includes('not framed'))).toBe(false)
  })

  test('F3: device blocking notches the batt — DIRECT drive (integration cannot book blocking)', () => {
    // Narrow re-check: on code-framed walls the off-stud path never fires
    // through computeLevel (a stud is always within half a bay), so the
    // end-to-end gate was VACUOUS. Drive the pieces directly: sparse
    // framing forces applyDeviceOverrides to book blocking (assert it!),
    // compose the wall's batts, then splitBattsAroundBlocking must notch.
    const wallSlice = {
      id: 'w_dev',
      start: [0, 0] as [number, number],
      end: [6, 0] as [number, number],
      dir: [1, 0] as [number, number],
      length: 6,
      thickness: 0.114,
      height: 2.44,
      exterior: true,
      openings: [],
      curved: false,
    }
    const framing = frameWall(wallSlice, { ...DEFAULT_SPEC, detail: '400' as const })
    const sparse = framing.filter((m) => {
      if (m.role !== 'stud') return true
      const u = m.position[0]
      return u < 0.5 || u > 2.4 // open a ~1.9m bay mid-wall
    })
    const fixtures = layoutElectrical([wallSlice], [])
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const applied = applyDeviceOverrides(
      fixtures,
      [wallSlice],
      [],
      sparse,
      new Map([[id, { wallId: 'w_dev', wallT: 1.5 / 6, heightAff: 1.2 }]]),
    )
    const blocks = applied.members.filter((m) => m.label === 'device blocking — box off-stud')
    expect(blocks.length).toBe(1) // NON-VACUOUS: the block is really booked
    const room = {
      id: 'room_r',
      name: 'room',
      category: 'other' as const,
      polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
      boundaryWallIds: ['w_dev'],
      ceilingHeight: 2.7,
    }
    const layers = layoutWallLayers(
      [wallSlice],
      [room],
      { ...DEFAULT_SPEC, detail: '400' as const },
      'NY',
      [],
      new Map([['w_dev', { insulation: 'batt' as const }]]),
    )
    const combined = [...layers]
    const before = combined.filter((m) => m.role === 'insulation').length
    expect(before).toBeGreaterThan(0)
    splitBattsAroundBlocking(combined, applied.members)
    const batts = combined.filter((m) => m.role === 'insulation')
    // the split happened: one batt became two pieces (or clipped)
    expect(batts.length).toBeGreaterThan(before - 1)
    for (const block of blocks) {
      const byLo = block.position[1] - block.dims[1] / 2
      const byHi = block.position[1] + block.dims[1] / 2
      for (const b of batts) {
        const du = Math.hypot(
          b.position[0] - block.position[0],
          b.position[2] - block.position[2],
        )
        if (du > (b.dims[0] + block.dims[0]) / 2 - 0.005) continue
        const yLo = b.position[1] - b.dims[1] / 2
        const yHi = b.position[1] + b.dims[1] / 2
        expect(byLo >= yHi - 0.003 || byHi <= yLo + 0.003).toBe(true)
      }
    }
  })

  test('F2 residual: an UNFRAMED override wall falls back to the DERIVED spot, truthfully', () => {
    // Narrow re-check: the warn branch said 'using the derived spot' but
    // then applied the foreign wallT to the derived wall (x = 0.9 × 12m —
    // a spot the user never chose). The warning must be true.
    const scene = baselineScene()
    const cfg = baselineConfig('INTL')
    const base = computeLevel(scene, cfg)
    const target = base.devices.find(
      (d) => d.wallId === 'w_s' && d.deviceKind !== 'switch',
    ) as NonNullable<(typeof base.devices)[number]>
    const derivedX = base.fixtures.find((f) => f.meta?.deviceId === target.deviceId)
      ?.position[0] as number
    scene.bonesdevice_ghost = {
      id: 'bonesdevice_ghost',
      type: 'bones:device',
      parentId: 'level_1',
      visible: true,
      deviceId: target.deviceId,
      deviceKind: target.deviceKind,
      wallId: 'wall_that_never_existed',
      wallT: 0.9,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
    const result = computeLevel({ ...scene }, cfg)
    expect(result.warnings.some((w) => w.includes('not framed'))).toBe(true)
    const fx = result.fixtures.find((f) => f.meta?.deviceId === target.deviceId) as Fixture
    // stays at (about) the derived spot — never 0.9 × 12m = 10.8
    expect(Math.abs(fx.position[0] - derivedX)).toBeLessThan(0.5)
  })
})

describe('AC dedicated circuits (night-4: the "connection to power" half)', () => {
  const cfgWith = (showHvac: boolean) =>
    FramingNode.parse({
      id: 'bonesframing_baseline',
      parentId: 'level_1',
      jurisdiction: 'NY',
      detail: '400',
      studSpacingIn: 16,
      showWalls: true,
      showElectrical: true,
      showHvac,
    })

  test('panel → disconnect homerun exists, is continuous, and never doubles the service entrance', () => {
    const scene = baselineScene()
    const result = computeLevel(scene, cfgWith(true))
    const disc = result.fixtures.find((f) => f.kind === 'disconnect') as Fixture
    expect(disc).toBeDefined()
    expect(disc.meta?.circuit).toBe('AC-1')
    const acWires = result.members.filter((m) => m.sourceId === 'AC-1')
    expect(acWires.length).toBeGreaterThan(0)
    // heavy gauge on the label (30A/10 AWG for the small baseline unit)
    expect(acWires.some((m) => m.label?.includes('10/2'))).toBe(true)
    // continuity: the disconnect is panel-reachable as continuous cable
    const panel = result.fixtures.find((f) => f.kind === 'panel') as Fixture
    expect(unreachableDevices(result.members, [panel, disc])).toEqual([])
    // the AC subset wiring must NOT re-emit the service entrance
    const laterals = result.members.filter((m) => m.label?.includes('street lateral')).length
    const noHvac = computeLevel(baselineScene(), cfgWith(false))
    const baseLaterals = noHvac.members.filter((m) => m.label?.includes('street lateral')).length
    expect(laterals).toBe(baseLaterals)
  })
})
