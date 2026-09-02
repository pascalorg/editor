import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import type { PlacedFixtureSlice } from '../core/wall-model'
import {
  layoutElectrical,
  overrideWallPoint,
  placeElectricMeterSpot,
  placePanelSpot,
  routeWiring,
} from './electrical'
import { cableConnects, endpointsOf, unreachableDevices } from './electrical.test-helpers'
import { layoutHvac, placeCondenserSeedSpot, placeThermostatSpot } from './hvac'
import { layoutPlumbing, placeSewerExit } from './plumbing'
import {
  buildingDrainExit,
  checkSupply,
  drainFailures,
  levelDrains,
  stubs,
} from './plumbing.test-helpers'

/**
 * Checklist invariant A4 — service overrides are authoritative; routing
 * follows. A `bones:service` node's location replaces auto-placement
 * VERBATIM, and the routed geometry stays physical:
 *  - panel override → the panel mounts there and every homerun re-anchors
 *    (E2 continuity, proven by unreachableDevices);
 *  - water-entry / water-heater overrides → supplies re-route, still
 *    continuous meter→stubs and WH→hot stubs;
 *  - sewer-exit override → the building drain re-slopes to the new exit and
 *    every trap still drains strictly downhill (P3005.3).
 */

// ---- scene builders (connectivity-test pattern) -----------------------------

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    thickness: 0.114,
    height: 2.5,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

const door = (u: number, roughWidth = 0.95): OpeningSlice => ({
  id: `door_${u}`,
  kind: 'door',
  u,
  width: roughWidth - 0.05,
  roughWidth,
  height: 2.1,
  roughHeight: 2.15,
  sillHeight: 0,
})

const room = (
  id: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
  boundaryWallIds: string[] = [],
): RoomSlice => ({ id, name: category, category, polygon, boundaryWallIds, ceilingHeight: 2.5 })

const PROFILES: Record<
  PlacedFixtureSlice['kind'],
  { hot: boolean; dfu: number; drainIn: number }
> = {
  toilet: { hot: false, dfu: 3, drainIn: 3 },
  lavatory: { hot: true, dfu: 1, drainIn: 1.25 },
  shower: { hot: true, dfu: 2, drainIn: 2 },
  bathtub: { hot: true, dfu: 2, drainIn: 1.5 },
  'clothes-washer': { hot: true, dfu: 2, drainIn: 2 },
  'kitchen-sink': { hot: true, dfu: 2, drainIn: 1.5 },
}
const pf = (
  id: string,
  kind: PlacedFixtureSlice['kind'],
  plan: [number, number],
): PlacedFixtureSlice => ({ id, kind, plan, yaw: 0, ...PROFILES[kind] })

// ---- electrical: panel override ---------------------------------------------

function electricalPlan() {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
    makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
    makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
    makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    makeWall({ id: 'w_div', start: [4, 0], end: [4, 4], exterior: false, openings: [door(2)] }),
  ]
  const rooms = [
    room('r_kitchen', 'kitchen', [[0, 0], [4, 0], [4, 4], [0, 4]]),
    room('r_bed', 'bedroom', [[4, 0], [8, 0], [8, 4], [4, 4]]),
  ]
  return { walls, rooms }
}

describe('A4 gate — panel override re-anchors the homeruns', () => {
  const { walls, rooms } = electricalPlan()
  const auto = layoutElectrical(walls, rooms)
  const autoPanel = auto.find((f) => f.kind === 'panel') as Fixture

  test('auto panel lands on the longest wall (the baseline to move from)', () => {
    expect(autoPanel).toBeDefined()
    const spot = placePanelSpot(walls, rooms)
    expect(spot?.wall.id).toBe('w_s')
  })

  test('wallId+wallT override mounts the panel there, verbatim', () => {
    // real node shape: `position` is always present, default [0,0,0]
    const fixtures = layoutElectrical(walls, rooms, {
      panel: { wallId: 'w_e', wallT: 0.5, heightAff: 1.4, position: [0, 0, 0] },
    })
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    expect(panel).toBeDefined()
    // On w_e at u = 2 → plan [8, 2], faced into the bedroom (x < 8).
    expect(Math.abs(panel.position[0] - 8)).toBeLessThan(0.15)
    expect(panel.position[2]).toBeCloseTo(2, 6)
    expect(panel.position[1]).toBeCloseTo(1.4, 6)
    // It actually moved off the auto wall.
    const moved = Math.hypot(
      panel.position[0] - autoPanel.position[0],
      panel.position[2] - autoPanel.position[2],
    )
    expect(moved).toBeGreaterThan(1)
    // …and EVERY device is still panel-reachable as continuous cable (E2).
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('position-only override (gizmo drag) snaps to the nearest wall and stays continuous', () => {
    const fixtures = layoutElectrical(walls, rooms, {
      panel: { position: [0.2, 1.52, 3.0] },
    })
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    // nearest wall to (0.2, 3.0) is w_w at x=0
    expect(Math.abs(panel.position[0])).toBeLessThan(0.15)
    expect(Math.abs(panel.position[2] - 3)).toBeLessThan(0.3)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  // GATE (dead anchors): a real node always carries `position` (schema
  // default [0,0,0]) — an unresolvable wallId must NOT teleport the panel to
  // the origin-nearest wall; it is no override at all → auto placement.
  test('override pointing at a missing wall with a never-moved position falls back to auto', () => {
    const fixtures = layoutElectrical(walls, rooms, {
      panel: { wallId: 'w_gone', wallT: 0.5, position: [0, 0, 0] },
    })
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    expect(panel.position[0]).toBeCloseTo(autoPanel.position[0], 6)
    expect(panel.position[2]).toBeCloseTo(autoPanel.position[2], 6)
  })

  // GATE (gizmo precedence): `position` moved off the default OUTRANKS the
  // wall anchor — otherwise a host gizmo drag (which writes `position` only)
  // would silently no-op while wallId+wallT pin the panel in place.
  test('gizmo-moved position outranks a live wallId+wallT anchor', () => {
    const fixtures = layoutElectrical(walls, rooms, {
      panel: { wallId: 'w_e', wallT: 0.5, position: [0.2, 1.52, 3.0] },
    })
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    // nearest wall to the dragged spot (0.2, 3.0) is w_w at x=0 — NOT w_e at x=8
    expect(Math.abs(panel.position[0])).toBeLessThan(0.15)
    expect(Math.abs(panel.position[2] - 3)).toBeLessThan(0.3)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  // GATE (NaN guards, engine side): hostile wallT/position never produce a
  // NaN mount — NaN wallT → wall midpoint; NaN position → never-moved.
  test('overrideWallPoint guards NaN wallT and NaN position components', () => {
    const wp = overrideWallPoint(walls, {
      wallId: 'w_e',
      wallT: Number.NaN,
      position: [0, 0, 0],
    })
    expect(wp?.wall.id).toBe('w_e')
    expect(wp?.u).toBeCloseTo(2, 6) // midpoint of the 4 m wall
    // NaN position is unusable → treated as never-moved → wall anchor wins
    const wp2 = overrideWallPoint(walls, {
      wallId: 'w_e',
      wallT: 0.25,
      position: [Number.NaN, 0, 3],
    })
    expect(wp2?.wall.id).toBe('w_e')
    expect(wp2?.u).toBeCloseTo(1, 6)
    // NaN position + missing wall → no override at all
    expect(
      overrideWallPoint(walls, { wallId: 'w_gone', position: [Number.NaN, 0, Number.NaN] }),
    ).toBeNull()
  })

  test('overrideWallPoint: curved wall + never-moved position is NOT an override', () => {
    const curved = makeWall({ id: 'w_curve', curved: true })
    expect(
      overrideWallPoint([curved, ...walls], {
        wallId: 'w_curve',
        wallT: 0.5,
        position: [0, 0, 0],
      }),
    ).toBeNull()
    // missing wall id, default position — same verdict
    expect(
      overrideWallPoint(walls, { wallId: 'w_other_level', position: [0, 0, 0] }),
    ).toBeNull()
  })
})

// ---- plumbing: sewer-exit / meter / WH overrides ----------------------------

/** 10×8 shell: garage west of x=5/z<5, bathroom SE, kitchen NW. */
function plumbingPlan() {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [10, 0], openings: [door(4)] }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false }),
  ]
  const rooms = [
    room('r_garage', 'garage', [[0, 0], [5, 0], [5, 5], [0, 5]], ['w_w', 'w_mid']),
    room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
    room('r_kitchen', 'kitchen', [[0, 5], [5, 5], [5, 8], [0, 8]]),
  ]
  const placed = [
    pf('fx_wc', 'toilet', [9.3, 1]),
    pf('fx_lav', 'lavatory', [8, 0.5]),
    pf('fx_sink', 'kitchen-sink', [1, 7.6]),
  ]
  return { walls, rooms, placed }
}

describe('A4 gate — sewer-exit override re-slopes the drains', () => {
  const { walls, rooms, placed } = plumbingPlan()
  const ids = placed.map((f) => f.id)

  test('auto exit differs from the override target (the move is real)', () => {
    const autoExit = placeSewerExit(walls, rooms, placed)
    expect(autoExit).not.toBeNull()
    const d = Math.hypot((autoExit as [number, number])[0] - 9.5, (autoExit as [number, number])[1] - 7.5)
    expect(d).toBeGreaterThan(2)
  })

  test('drains re-route to the overridden exit, strictly downhill (P3005.3)', () => {
    const { members } = layoutPlumbing(walls, rooms, undefined, placed, {
      sewerExit: { position: [9.5, 0, 7.5] },
    })
    const exit = buildingDrainExit(members)
    expect(exit).not.toBeNull()
    // The building drain's LOW end lands at the override point…
    expect(Math.hypot((exit?.x ?? 0) - 9.5, (exit?.z ?? 0) - 7.5)).toBeLessThan(0.1)
    // …every trap still reaches it walking only downhill…
    expect(drainFailures(members, ids)).toEqual([])
    // …and no drain leg lost its pitch.
    expect(levelDrains(members)).toEqual([])
  })

  test('cleanout fixture follows the exit', () => {
    const { fixtures } = layoutPlumbing(walls, rooms, undefined, placed, {
      sewerExit: { position: [9.5, 0, 7.5] },
    })
    const cleanouts = fixtures.filter((f) => f.kind === 'cleanout')
    expect(
      cleanouts.some((c) => Math.hypot(c.position[0] - 9.5, c.position[2] - 7.5) < 0.1),
    ).toBe(true)
  })

  test('wall-anchored sewer override resolves through the wall lerp', () => {
    const { members } = layoutPlumbing(walls, rooms, undefined, placed, {
      sewerExit: { wallId: 'w_n', wallT: 0.5 },
    })
    const exit = buildingDrainExit(members)
    // w_n runs [10,8] → [0,8]; t=0.5 → [5,8]
    expect(Math.hypot((exit?.x ?? 0) - 5, (exit?.z ?? 0) - 8)).toBeLessThan(0.1)
    expect(drainFailures(members, ids)).toEqual([])
  })
})

describe('A4 gate — meter + WH overrides keep the supplies continuous', () => {
  const { walls, rooms, placed } = plumbingPlan()

  test('water-entry override moves the meter; cold/hot reach every stub', () => {
    const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed, {
      waterEntry: { wallId: 'w_e', wallT: 0.25, heightAff: 0.4 },
    })
    const meter = fixtures.find((f) => f.kind === 'water-meter') as Fixture
    // w_e runs [10,0] → [10,8]; t=0.25 → [10, 2]
    expect(meter.position[0]).toBeCloseTo(10, 6)
    expect(meter.position[2]).toBeCloseTo(2, 6)
    expect(meter.position[1]).toBeCloseTo(0.4, 6)
    checkSupply(members, fixtures)
    expect(stubs(fixtures).length).toBe(placed.length)
  })

  test('water-heater override moves the WH; hot homeruns re-anchor', () => {
    const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed, {
      waterHeater: { wallId: 'w_mid', wallT: 0.75 },
    })
    const wh = fixtures.find((f) => f.kind === 'water-heater') as Fixture
    // w_mid runs [5,0] → [5,8]; t=0.75 → [5,6] (± the off-wall body offset)
    expect(Math.abs(wh.position[0] - 5)).toBeLessThan(0.5)
    expect(Math.abs(wh.position[2] - 6)).toBeLessThan(0.1)
    checkSupply(members, fixtures)
  })

  // GATE (gizmo precedence, plumbing side): the moved position wins for the
  // wall-anchored consumers (nearest wall point) and verbatim for the floor
  // sewer exit — wallId+wallT must not pin them once the node was dragged.
  test('gizmo-moved WH position outranks its wall anchor (snaps to nearest wall)', () => {
    const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed, {
      waterHeater: { wallId: 'w_mid', wallT: 0.75, position: [9.6, 0, 4.0] },
    })
    const wh = fixtures.find((f) => f.kind === 'water-heater') as Fixture
    // dragged next to w_e at x=10 — the w_mid anchor (x=5) must NOT win
    expect(Math.abs(wh.position[0] - 10)).toBeLessThan(0.5)
    expect(Math.abs(wh.position[2] - 4)).toBeLessThan(1.0)
    checkSupply(members, fixtures)
  })

  test('gizmo-moved sewer-exit position outranks its wall anchor (verbatim)', () => {
    const { members } = layoutPlumbing(walls, rooms, undefined, placed, {
      sewerExit: { wallId: 'w_n', wallT: 0.5, position: [9.5, 0, 7.5] },
    })
    const exit = buildingDrainExit(members)
    // w_n lerp would say [5,8] — the dragged position [9.5,7.5] must win
    expect(Math.hypot((exit?.x ?? 0) - 9.5, (exit?.z ?? 0) - 7.5)).toBeLessThan(0.1)
    expect(drainFailures(members, placed.map((f) => f.id))).toEqual([])
  })
})

// ---- hvac: thermostat + heat-pump overrides ----------------------------------

describe('A4 gate — thermostat + heat-pump service nodes drive the hvac engine', () => {
  const { walls, rooms } = electricalPlan()

  test('auto thermostat sits on an interior wall at 52" AFF', () => {
    const spot = placeThermostatSpot(walls, rooms)
    expect(spot).not.toBeNull()
    expect(spot?.wall.exterior).toBe(false) // the divider, not the shell
    expect(spot?.heightAff).toBeCloseTo(52 * 0.0254, 6)
    const { fixtures } = layoutHvac(walls, rooms)
    const tstat = fixtures.find((f) => f.kind === 'thermostat') as Fixture
    expect(tstat.sourceId).toBe(spot?.wall.id ?? '')
    expect(tstat.position[1]).toBeCloseTo(52 * 0.0254, 6)
  })

  test('thermostat wallId+wallT+heightAff override mounts it there, verbatim', () => {
    const { fixtures } = layoutHvac(walls, rooms, DEFAULT_SPEC, {
      thermostat: { wallId: 'w_e', wallT: 0.5, heightAff: 1.2, position: [0, 0, 0] },
    })
    const tstat = fixtures.find((f) => f.kind === 'thermostat') as Fixture
    // w_e runs [8,0] → [8,4]; t=0.5 → [8,2]
    expect(tstat.position[0]).toBeCloseTo(8, 6)
    expect(tstat.position[2]).toBeCloseTo(2, 6)
    expect(tstat.position[1]).toBeCloseTo(1.2, 6)
    expect(tstat.sourceId).toBe('w_e')
  })

  test('gizmo-moved thermostat position snaps to the nearest wall', () => {
    const { fixtures } = layoutHvac(walls, rooms, DEFAULT_SPEC, {
      thermostat: { wallId: 'w_e', wallT: 0.5, position: [0.2, 1.3, 3.0] },
    })
    const tstat = fixtures.find((f) => f.kind === 'thermostat') as Fixture
    // dragged next to w_w at x=0 — the w_e anchor must NOT win
    expect(Math.abs(tstat.position[0])).toBeLessThan(0.15)
    expect(Math.abs(tstat.position[2] - 3)).toBeLessThan(0.3)
  })

  test('heat-pump override re-anchors pad, cabinet AND lineset at ANY LOD', () => {
    // default LOD (300): the outdoor block ships even WITHOUT an override
    // (condenser-always fix — an AH never ships without its outdoor unit)
    const auto = layoutHvac(walls, rooms)
    expect(auto.members.some((m) => m.sourceId.startsWith('lineset-'))).toBe(true)
    // override present → the whole outdoor block re-anchors AT the node
    const moved = layoutHvac(walls, rooms, DEFAULT_SPEC, {
      heatPump: { position: [11, 0, 2] },
    })
    const condenser = moved.fixtures.find((f) => f.label?.includes('Condenser')) as Fixture
    expect(condenser.position[0]).toBeCloseTo(11, 6)
    expect(condenser.position[2]).toBeCloseTo(2, 6)
    const pad = moved.members.find((m) => m.role === 'equipment' && m.material === 'concrete')
    const unit = moved.members.find((m) => m.role === 'equipment' && m.material === 'steel')
    expect(pad?.position[0]).toBeCloseTo(11, 6)
    expect(unit?.position[0]).toBeCloseTo(11, 6)
    // the lineset's far end lands at the pad (re-anchored, not the auto spot)
    const lineset = moved.members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(lineset.length).toBeGreaterThan(0)
    const reaches = lineset.some((m) =>
      endpointsOf(m).some((e) => Math.hypot(e.x - 11, e.z - 2) < 0.05),
    )
    expect(reaches).toBe(true)
  })

  test('auto pad at LOD 400 stands outside the nearest exterior wall, at the seed spot', () => {
    // The composed anchor = the SEED spot (RO slide + grid snap included,
    // HP polish item 3); placeHeatPumpSpot is the raw pre-snap election.
    const spot = placeCondenserSeedSpot(walls, rooms)
    expect(spot).not.toBeNull()
    const at400 = layoutHvac(walls, rooms, { ...DEFAULT_SPEC, detail: '400' })
    const condenser = at400.fixtures.find((f) => f.label?.includes('Condenser')) as Fixture
    expect(condenser.position[0]).toBeCloseTo(spot?.[0] ?? 0, 6)
    expect(condenser.position[2]).toBeCloseTo(spot?.[1] ?? 0, 6)
    // outside the 8×4 shell
    const [cx, , cz] = condenser.position
    expect(cx > 0 && cx < 8 && cz > 0 && cz < 4).toBe(false)
  })
})

// ---- electrical: METER + service cable (street → meter → panel) --------------
// (continuity helper `cableConnects` lives in electrical.test-helpers.ts —
// shared with the E1 service-cable gates in electrical.openings.test.ts)

describe('E gate — electric meter: street → METER → panel', () => {
  const { walls, rooms } = electricalPlan()

  test('auto meter lands on the EXTERIOR face beside the panel, RO-clear', () => {
    const spot = placeElectricMeterSpot(walls, rooms)
    expect(spot).not.toBeNull()
    expect(spot?.wall.exterior).toBe(true)
    const panelSpot = placePanelSpot(walls, rooms)
    expect(spot?.wall.id).toBe(panelSpot?.wall.id ?? '')
    expect(Math.abs((spot?.u ?? 0) - (panelSpot?.u ?? 0))).toBeCloseTo(0.6, 6)
    const fixtures = layoutElectrical(walls, rooms)
    const meter = fixtures.find((f) => f.kind === 'electric-meter') as Fixture
    expect(meter).toBeDefined()
    // exterior face of w_s (rooms fill z>0) → the meter hangs at z<0
    expect(meter.position[2]).toBeLessThan(0)
    expect(meter.position[1]).toBeCloseTo(55 * 0.0254, 6)
  })

  test('service cable is CONTINUOUS street-edge → meter → panel', () => {
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    const meter = fixtures.find((f) => f.kind === 'electric-meter') as Fixture
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    const cable = members.filter((m) => m.sourceId === 'service-entrance')
    expect(cable.length).toBeGreaterThanOrEqual(4)
    // the lateral starts at a map-edge point OUTSIDE the walls' bbox…
    const street = cable.find((m) => m.label?.includes('street lateral'))
    expect(street).toBeDefined()
    const escapes = cable.some((m) =>
      endpointsOf(m).some((e) => e.x < -3.9 || e.x > 11.9 || e.z < -3.9 || e.z > 7.9),
    )
    expect(escapes).toBe(true)
    // …runs underground, and one component carries street + meter + panel
    expect(street?.position[1]).toBeLessThan(0)
    expect(
      cableConnects(members, [
        [meter.position[0], meter.position[1], meter.position[2]],
        [panel.position[0], panel.position[1], panel.position[2]],
      ]),
    ).toBe(true)
    // …and the regular branch circuits still all reach the panel (E2)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('moved meter re-anchors the whole feed (override authoritative)', () => {
    const fixtures = layoutElectrical(walls, rooms, {
      electricMeter: { wallId: 'w_n', wallT: 0.25, heightAff: 1.3, position: [0, 0, 0] },
    })
    const meter = fixtures.find((f) => f.kind === 'electric-meter') as Fixture
    // w_n runs [8,4] → [0,4]; t=0.25 → [6,4] (± the face offset)
    expect(Math.abs(meter.position[0] - 6)).toBeLessThan(0.05)
    expect(Math.abs(meter.position[2] - 4)).toBeLessThan(0.2)
    expect(meter.position[1]).toBeCloseTo(1.3, 6)
    const members = routeWiring(fixtures, walls)
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    // the feed re-anchors: cable still one street→meter→panel component
    expect(
      cableConnects(members, [
        [meter.position[0], meter.position[1], meter.position[2]],
        [panel.position[0], panel.position[1], panel.position[2]],
      ]),
    ).toBe(true)
    // …and some cable endpoint sits exactly at the NEW meter socket
    const touchesMeter = members
      .filter((m) => m.sourceId === 'service-entrance')
      .some((m) =>
        endpointsOf(m).some(
          (e) =>
            Math.hypot(e.x - meter.position[0], e.y - meter.position[1], e.z - meter.position[2]) <
            0.03,
        ),
      )
    expect(touchesMeter).toBe(true)
  })

  test('meter for an interior garage panel still lands on the shell', () => {
    // Panel elects the longest garage wall — make it an interior divider.
    const { walls: pw, rooms: pr } = plumbingPlan()
    const spot = placeElectricMeterSpot(pw, pr)
    expect(spot).not.toBeNull()
    expect(spot?.wall.exterior).toBe(true)
  })
})
