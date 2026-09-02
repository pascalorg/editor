import { describe, expect, test } from 'bun:test'
import type { OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import {
  AIR_SENSIBLE_WH_PER_M3K,
  APPLIANCES_SENSIBLE_W,
  BTUH_PER_W,
  INFILTRATION_ACH,
  MANUAL_S_MAX,
  MANUAL_S_MIN,
  OCCUPANT_SENSIBLE_W,
  R_IMPERIAL_TO_RSI,
  SHGC_ASSUMED,
  SOLAR_W_PER_M2,
  U_IMPERIAL_TO_SI,
  WINDOW_U_IMPERIAL,
  facadeOrientation,
  manualJLite,
  manualSTons,
  parseZone,
} from './manual-j'

/**
 * GATES (Manual-J-lite v1 — IRC M1401.3, ACCA Manual J/S govern):
 *  1. HAND-COMPUTED LOAD on a pinned scene: every term (UA·ΔT, solar,
 *     internal, infiltration) derived independently in the test with its
 *     own arithmetic — the engine must match to 1e-9, not "roughly";
 *  2. climate-zone divergence: the same house loads differently in a hot
 *     zone (2: design 35°C) vs a cold one (6: 31°C) — through ΔT;
 *  3. fallback triggers are STATED, never silent: unknown zone (INTL),
 *     no exterior envelope, no conditioned volume;
 *  4. Manual S selection: smallest half-ton ≥ load, 1.5 floor, and the
 *     95–115% band honestly reported when stock steps fall outside it;
 *  5. orientation bucketing under the stated axis assumption
 *     (+x = east, −z = north) with the outward normal away from interior.
 */

function opening(
  id: string,
  u: number,
  width: number,
  height: number,
  kind: 'door' | 'window' = 'window',
): OpeningSlice {
  return {
    id,
    kind,
    u,
    width,
    height,
    sillHeight: kind === 'door' ? 0 : 0.9,
    roughWidth: width + 0.05,
    roughHeight: height + 0.1,
  }
}

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  exterior = true,
  openings: OpeningSlice[] = [],
): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.2,
    height: 2.7,
    exterior,
    openings,
    curved: false,
  }
}

function room(
  id: string,
  name: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
  ceilingHeight = 2.5,
): RoomSlice {
  return { id, name, category, polygon, boundaryWallIds: [], ceilingHeight }
}

/** The PINNED hand-computed scene: 10×6 m shell, one bedroom, a north-
 * facing window + door on the z=0 wall, a south-facing window on z=6. */
function pinnedScene() {
  const winN = opening('win_n', 5, 1.2, 1.5) // on z=0 wall → faces −z = NORTH
  const doorN = opening('door_n', 2, 0.9, 2.1, 'door')
  const winS = opening('win_s', 5, 2.0, 1.2) // on z=6 wall → faces +z = SOUTH
  const winE = opening('win_e', 3, 1.0, 1.0) // on x=10 wall → faces +x = EAST
  const walls = [
    wall('w_zn', [0, 0], [10, 0], true, [winN, doorN]),
    wall('w_zs', [0, 6], [10, 6], true, [winS]),
    wall('w_xw', [0, 0], [0, 6], true),
    wall('w_xe', [10, 0], [10, 6], true, [winE]),
  ]
  const rooms = [
    room('r_bed', 'Bedroom', 'bedroom', [
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
    ]),
    room('r_living', 'Living', 'other', [
      [4, 0],
      [10, 0],
      [10, 6],
      [4, 6],
    ]),
  ]
  return { walls, rooms }
}

describe('Manual-J-lite — hand-computed load (the bite gate)', () => {
  test('every term matches an independent hand derivation (FL, zone 2A)', () => {
    const { walls, rooms } = pinnedScene()
    const load = manualJLite(walls, rooms, 'FL')
    expect(load.ok).toBe(true)
    if (!load.ok) return

    // ---- hand derivation, term by term ----
    // zone 2A → outdoor design 35°C, indoor 24°C
    const deltaT = 35 - 24
    expect(load.zone).toBe('2A')
    expect(load.deltaTK).toBe(deltaT)

    // walls: perimeter 2·(10+6)=32 m × 2.7 h = 86.4 m² gross, minus
    // openings 1.2·1.5 + 0.9·2.1 + 2.0·1.2 + 1.0·1.0 = 1.8+1.89+2.4+1.0
    const wallNet = 32 * 2.7 - (1.8 + 1.89 + 2.4 + 1.0)
    const windowArea = 1.8 + 2.4 + 1.0
    // zone 2 wall cavity R-13 (2021 IECC R402.1.3), ceiling R-49
    const uaWalls = wallNet / (13 * R_IMPERIAL_TO_RSI)
    const uaWindows = windowArea * WINDOW_U_IMPERIAL * U_IMPERIAL_TO_SI
    const areaM2 = 60
    const uaCeiling = areaM2 / (49 * R_IMPERIAL_TO_RSI)
    const envelopeW = (uaWalls + uaWindows + uaCeiling) * deltaT
    expect(load.uaWallsWPerK).toBeCloseTo(uaWalls, 9)
    expect(load.uaWindowsWPerK).toBeCloseTo(uaWindows, 9)
    expect(load.uaCeilingWPerK).toBeCloseTo(uaCeiling, 9)
    expect(load.envelopeW).toBeCloseTo(envelopeW, 9)

    // solar: N 1.8 m², S 2.4 m², E 1.0 m² × factor × SHGC 0.3
    const solarW =
      (1.8 * SOLAR_W_PER_M2.N + 2.4 * SOLAR_W_PER_M2.S + 1.0 * SOLAR_W_PER_M2.E) * SHGC_ASSUMED
    expect(load.solarW).toBeCloseTo(solarW, 9)

    // internal: 1 bedroom → 2 occupants × 67.4 + 351.7
    const internalW = 2 * OCCUPANT_SENSIBLE_W + APPLIANCES_SENSIBLE_W
    expect(load.bedrooms).toBe(1)
    expect(load.occupants).toBe(2)
    expect(load.internalW).toBeCloseTo(internalW, 9)

    // infiltration: 0.33 × 0.35 × (60 m² × 2.5 m) × ΔT
    const volume = 60 * 2.5
    const infiltrationW = AIR_SENSIBLE_WH_PER_M3K * INFILTRATION_ACH * volume * deltaT
    expect(load.conditionedVolumeM3).toBeCloseTo(volume, 9)
    expect(load.infiltrationW).toBeCloseTo(infiltrationW, 9)

    // total → Btu/h → sensible tons → ×1.25 humid latent allowance (2A → A)
    const totalW = envelopeW + solarW + internalW + infiltrationW
    expect(load.totalW).toBeCloseTo(totalW, 9)
    expect(load.totalBtuH).toBeCloseTo(totalW * BTUH_PER_W, 6)
    const sensTons = (totalW * BTUH_PER_W) / 12000
    expect(load.sensibleTons).toBeCloseTo(sensTons, 9)
    expect(load.moistureRegime).toBe('A')
    expect(load.latentFactor).toBe(1.25)
    expect(load.loadTons).toBeCloseTo(sensTons * 1.25, 9)

    // the basis is STATED — every assumption in the notes
    const joined = load.notes.join('\n')
    for (const needle of [
      'Manual J-lite',
      'M1401.3',
      'verify local design conditions',
      'design 35°C',
      'R-13',
      'R-49',
      `SHGC ${SHGC_ASSUMED}`,
      `ACH ${INFILTRATION_ACH}`,
      'bedrooms 1 + 1',
      '−z = north assumed',
      'Latent allowance ×1.25 (moisture regime A — humid',
      'full Manual J latent calculation governs',
    ]) {
      expect(joined).toContain(needle)
    }
  })

  test('climate-zone divergence: the SAME house loads more in zone 2 than zone 6', () => {
    const { walls, rooms } = pinnedScene()
    const hot = manualJLite(walls, rooms, 'FL') // 2A → 35°C
    const cold = manualJLite(walls, rooms, 'MN') // 6A → 31°C
    expect(hot.ok && cold.ok).toBe(true)
    if (!hot.ok || !cold.ok) return
    expect(hot.deltaTK).toBe(11)
    expect(cold.deltaTK).toBe(7)
    expect(hot.totalW).toBeGreaterThan(cold.totalW)
    // and not only via ΔT: MN's zone-6 envelope carries MORE R (R30 wall)
    expect(cold.wallR).toBeGreaterThan(hot.wallR)
  })

  test('marine 4C (WA) resolves the 4M insulation row with zone-4 design temp', () => {
    const { walls, rooms } = pinnedScene()
    const wa = manualJLite(walls, rooms, 'WA')
    expect(wa.ok).toBe(true)
    if (!wa.ok) return
    expect(wa.zone).toBe('4C')
    expect(wa.zoneKey).toBe('4M')
    expect(wa.outdoorDesignC).toBe(33)
    expect(wa.wallR).toBe(30)
    // marine regime → ×1.10 latent allowance
    expect(wa.moistureRegime).toBe('C')
    expect(wa.latentFactor).toBe(1.1)
    expect(wa.loadTons).toBeCloseTo(wa.sensibleTons * 1.1, 12)
  })

  test('latent allowance by moisture regime: A ×1.25, B ×1.05, none ×1.0 — stated either way', () => {
    const { walls, rooms } = pinnedScene()
    const humid = manualJLite(walls, rooms, 'FL') // 2A
    const dry = manualJLite(walls, rooms, 'AZ') // 2B — same digit, same ΔT/R
    const bare = manualJLite(walls, rooms, 'AK') // '7 (8 interior)' — no letter
    expect(humid.ok && dry.ok && bare.ok).toBe(true)
    if (!humid.ok || !dry.ok || !bare.ok) return
    // 2A and 2B share the whole sensible calculation — only the regime moves
    expect(dry.totalW).toBeCloseTo(humid.totalW, 9)
    expect(humid.latentFactor).toBe(1.25)
    expect(dry.moistureRegime).toBe('B')
    expect(dry.latentFactor).toBe(1.05)
    expect(dry.loadTons).toBeCloseTo(dry.sensibleTons * 1.05, 12)
    // a bare-digit zone takes NO allowance and says so — never silent
    expect(bare.moistureRegime).toBeNull()
    expect(bare.latentFactor).toBe(1)
    expect(bare.loadTons).toBeCloseTo(bare.sensibleTons, 12)
    expect(
      bare.notes.some((n) => n.includes('No moisture-regime letter') && n.includes('×1.0')),
    ).toBe(true)
  })
})

describe('Manual-J-lite — fallback triggers are stated, never silent', () => {
  test('unknown climate zone (INTL / unset) names the trigger', () => {
    const { walls, rooms } = pinnedScene()
    const intl = manualJLite(walls, rooms, 'INTL')
    expect(intl.ok).toBe(false)
    if (intl.ok) return
    expect(intl.reason).toContain("climate zone unknown for 'INTL'")
    const unset = manualJLite(walls, rooms, undefined)
    expect(unset.ok).toBe(false)
    if (unset.ok) return
    expect(unset.reason).toContain('unset')
  })

  test('no straight exterior envelope names the trigger', () => {
    const { walls, rooms } = pinnedScene()
    const interiorOnly = walls.map((w) => ({ ...w, exterior: false }))
    const res = manualJLite(interiorOnly, rooms, 'FL')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toContain('no straight exterior envelope')
  })

  test('no conditioned volume (outdoor/garage-only zones) names the trigger', () => {
    const { walls } = pinnedScene()
    const outdoorOnly = [
      room('r_garden', 'Garden', 'outdoor', [
        [0, 0],
        [10, 0],
        [10, 6],
        [0, 6],
      ]),
      room('r_garage', 'Garage', 'garage', [
        [0, 0],
        [4, 0],
        [4, 6],
        [0, 6],
      ]),
    ]
    const res = manualJLite(walls, outdoorOnly, 'FL')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toContain('no conditioned volume')
  })
})

describe('Manual S selection — 95–115% band, half-ton steps, 1.5 floor', () => {
  test('smallest half-ton ≥ load, within band when steps allow', () => {
    expect(manualSTons(2.8)).toEqual({ tons: 3, withinBand: true })
    expect(manualSTons(3.0)).toEqual({ tons: 3, withinBand: true })
    expect(manualSTons(4.6)).toEqual({ tons: 5, withinBand: true })
  })

  test('the 1.5-ton floor and coarse steps are reported as out of band', () => {
    const tiny = manualSTons(0.4)
    expect(tiny.tons).toBe(1.5)
    expect(tiny.withinBand).toBe(false)
    // 1.6-ton load: next stock step 2.0 = 125% > 115% — honest, not silent
    const step = manualSTons(1.6)
    expect(step.tons).toBe(2)
    expect(step.withinBand).toBe(false)
  })

  test('band constants come from the data table (95–115%)', () => {
    expect(MANUAL_S_MIN).toBeCloseTo(0.95, 9)
    expect(MANUAL_S_MAX).toBeCloseTo(1.15, 9)
  })
})

describe('facade orientation — outward normal, stated axes', () => {
  test('rect shell walls bucket N/S/E/W away from the interior centroid', () => {
    const { walls, rooms } = pinnedScene()
    const interior: [number, number] = [5, 3]
    void rooms
    expect(facadeOrientation(walls[0] as WallSlice, interior)).toBe('N') // z=0 → −z
    expect(facadeOrientation(walls[1] as WallSlice, interior)).toBe('S') // z=6 → +z
    expect(facadeOrientation(walls[2] as WallSlice, interior)).toBe('W') // x=0 → −x
    expect(facadeOrientation(walls[3] as WallSlice, interior)).toBe('E') // x=10 → +x
  })

  test('parseZone: split states, marine, garbage', () => {
    expect(parseZone('2A-3A (3B/4B west)')).toEqual({ label: '2A', key: '2' })
    expect(parseZone('4C west (5B east)')).toEqual({ label: '4C', key: '4M' })
    expect(parseZone('n/a')).toBeNull()
  })
})
