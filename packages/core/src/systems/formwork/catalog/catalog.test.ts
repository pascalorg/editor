import { describe, expect, it } from 'bun:test'
import type { CornerLeg, JunctionCorner } from '../coverage/types'
import {
  ADJUSTABLE_COLUMN_CLAMPS,
  columnFormSizeMm,
  columnStackCount,
  DOKA_KS_XLIFE,
  FRAMAX_COLUMN,
} from './columns'
import { DOKA_FRAMAX_XLIFE } from './doka-framax'
import {
  DEFAULT_FORMWORK_SYSTEM_ID,
  FORMWORK_SYSTEMS,
  type FormworkSystem,
  formworkSystem,
  seededFormworkSystem,
} from './index'
import { fitCorner, unfittableCorners } from './junction-fit'
import { PERI_TRIO } from './peri-trio'
import { expectedReusesForFilm, SHEET_STOCK } from './sheets'
import {
  clampForSizeMm,
  cornerForAngle,
  cornerLegsMm,
  fillerForGap,
  panelWidthsMm,
  permissiblePressureKnM2,
} from './types'

/**
 * The catalog is data, so the tests that matter are the ones that catch a
 * transcription slip: a rating attached to the wrong widths, a corner whose legs
 * break the outside-longer-than-inside rule, a gap the cascade cannot fill.
 */

const SEEDED_SYSTEMS = Object.values(FORMWORK_SYSTEMS).filter((system) => system.seeded)

/** Every published design value in a seeded entry must say where it came from. */
function expectSourced(system: FormworkSystem) {
  for (const part of [...system.panels, ...system.corners, ...system.fillers, ...system.ties]) {
    expect(part.catalogSource.length).toBeGreaterThan(0)
    expect(part.verification).toBeDefined()
  }
}

describe('every shipped entry is sourced', () => {
  it('names the list each part was read from', () => {
    for (const system of SEEDED_SYSTEMS) expectSourced(system)
  })

  it('says which pressure code every rating was certified against', () => {
    for (const system of SEEDED_SYSTEMS) {
      for (const panel of system.panels) {
        expect(panel.pressure.pressureStandard).toBeDefined()
        expect(panel.pressure.sourceRef.length).toBeGreaterThan(0)
        // A rating with no stated basis is a factor-of-two ambiguity.
        expect(['permissible', 'ultimate', 'design']).toContain(panel.pressure.basis)
      }
    }
  })

  it('states the basis of every tie capacity', () => {
    for (const system of SEEDED_SYSTEMS) {
      for (const tie of system.ties) {
        expect(['permissible', 'ultimate', 'design']).toContain(tie.capacityBasis)
        expect(tie.capacityKn).toBeGreaterThan(0)
      }
    }
  })
})

describe('seeded and unseeded', () => {
  it('registers the unseeded panel systems the plan names', () => {
    for (const id of [
      'mivan-generic',
      'peri-srs',
      'peri-quattro',
      'peri-skydeck',
      'peri-multiflex',
      'doka-frami',
    ]) {
      const entry = formworkSystem(id)
      expect(entry?.seeded).toBe(false)
      // The refusal names the identifier, so a registration without one is worthless.
      expect(entry?.unseededReason.length).toBeGreaterThan(0)
    }
  })

  it('an unseeded system publishes no design value to be sourced', () => {
    for (const system of Object.values(FORMWORK_SYSTEMS)) {
      if (system.seeded) continue
      expect('panels' in system).toBe(false)
      expect(system.verification).toBe('unverified')
    }
  })

  it('every seeded panel carries a rated pressure — a system without one is unseeded', () => {
    // The spec's rule in registry form: a system "with no rated pressure" must read as
    // unseeded, because a system with no stated limit would pass every pressure check.
    // Seeded is therefore exactly "full data including a rated pressure on every panel" —
    // a partially filled entry has no business in the seeded half of the registry.
    for (const system of SEEDED_SYSTEMS) {
      expect(system.panels.length).toBeGreaterThan(0)
      for (const panel of system.panels) {
        expect(panel.pressure.wallsKnM2).toBeGreaterThan(0)
      }
    }
  })

  it('the default system is seeded, so an unconfigured project still designs', () => {
    expect(formworkSystem(DEFAULT_FORMWORK_SYSTEM_ID)?.seeded).toBe(true)
  })
})

describe('Doka Framax', () => {
  it('offers the published five-width grid', () => {
    const widths = panelWidthsMm(DOKA_FRAMAX_XLIFE)
    for (const width of [300, 450, 600, 900, 1350]) expect(widths).toContain(width)
  })

  it('uprates only the narrow panels, not the wide ones', () => {
    const panelOfWidth = (widthMm: number) =>
      DOKA_FRAMAX_XLIFE.panels.find(
        (p) => p.widthMm === widthMm && p.heightMm === 2700 && !p.universal,
      )
    // The uprating is published for 105/75/60/45/30 cm only. A 0.90 panel stays
    // at 80 however narrow the wall — which is why this is read off the panel.
    expect(permissiblePressureKnM2(panelOfWidth(600) as never, 'wall')).toBe(100)
    expect(permissiblePressureKnM2(panelOfWidth(450) as never, 'wall')).toBe(100)
    expect(permissiblePressureKnM2(panelOfWidth(300) as never, 'wall')).toBe(100)
    expect(permissiblePressureKnM2(panelOfWidth(900) as never, 'wall')).toBe(80)
    expect(permissiblePressureKnM2(panelOfWidth(1350) as never, 'wall')).toBe(80)
  })

  it('rates a column higher than a wall', () => {
    const panel = DOKA_FRAMAX_XLIFE.panels[0]
    expect(permissiblePressureKnM2(panel as never, 'column')).toBe(90)
  })

  it('marks the universal panels heavier than the run panel of the same size', () => {
    const run = DOKA_FRAMAX_XLIFE.panels.find(
      (p) => p.widthMm === 900 && p.heightMm === 2700 && !p.universal,
    )
    const universal = DOKA_FRAMAX_XLIFE.panels.find(
      (p) => p.widthMm === 900 && p.heightMm === 2700 && p.universal && !p.selfCompacting,
    )
    expect((universal?.weightKg ?? 0) > (run?.weightKg ?? 0)).toBe(true)
  })

  it('puts tie holes inside the panel, never above its top', () => {
    for (const panel of DOKA_FRAMAX_XLIFE.panels) {
      for (const level of panel.tieHoles.levelsMm) {
        expect(level).toBeGreaterThan(0)
        expect(level).toBeLessThan(panel.heightMm)
      }
      for (const column of panel.tieHoles.columnsMm) {
        expect(column).toBeGreaterThan(0)
        expect(column).toBeLessThan(panel.widthMm)
      }
    }
  })
})

describe('PERI TRIO', () => {
  it('ties on the published dimension chain, not on a spacing rule', () => {
    const panel = PERI_TRIO.panels.find((p) => p.heightMm === 2700 && p.widthMm === 600)
    expect(panel?.tieHoles.levelsMm).toEqual([575, 2125])
  })

  it('gives the 330 panel four tie levels and the 120 one', () => {
    const tall = PERI_TRIO.panels.find((p) => p.heightMm === 3300 && p.widthMm === 900)
    const short = PERI_TRIO.panels.find((p) => p.heightMm === 1200 && p.widthMm === 900)
    expect(tall?.tieHoles.levelsMm).toEqual([475, 1075, 1650, 2725])
    expect(short?.tieHoles.levelsMm).toEqual([875])
  })

  it('gives the 240-wide panel two tie columns and the narrow ones one', () => {
    const wide = PERI_TRIO.panels.find((p) => p.widthMm === 2400 && p.heightMm === 2700)
    const narrow = PERI_TRIO.panels.find((p) => p.widthMm === 600 && p.heightMm === 2700)
    expect(wide?.tieHoles.columnsMm).toEqual([540, 1860])
    expect(narrow?.tieHoles.columnsMm).toHaveLength(1)
  })

  it('keeps the 120 mm frame depth on every panel, which is what shares one tie length', () => {
    for (const panel of PERI_TRIO.panels) expect(panel.frameDepthMm).toBe(120)
  })

  it('drills the Multi Panel on a continuous grid, because it takes the odd angles', () => {
    const multi = PERI_TRIO.panels.find((p) => p.universal && p.heightMm === 2700)
    expect((multi?.tieHoles.levelsMm.length ?? 0) > 4).toBe(true)
  })
})

describe('corner leg geometry', () => {
  it('makes a cut-to-fit outside leg longer than the inside one by the core it wraps', () => {
    const inside = DOKA_FRAMAX_XLIFE.corners.find((c) => c.side === 'inside' && !c.hinged)
    const outside = DOKA_FRAMAX_XLIFE.corners.find((c) => c.side === 'outside' && !c.hinged)
    const core = 200
    const insideLeg = cornerLegsMm(inside as never, core).legAMm
    const outsideLeg = cornerLegsMm(outside as never, core).legAMm
    expect(outsideLeg - insideLeg).toBeCloseTo(core, 6)
  })

  it('ignores the core on a manufactured corner — its legs are what it was made as', () => {
    const te = PERI_TRIO.corners.find((c) => c.itemNo === '022580')
    expect(cornerLegsMm(te as never, 200)).toEqual({ legAMm: 180, legBMm: 300 })
    expect(cornerLegsMm(te as never, 400)).toEqual({ legAMm: 180, legBMm: 300 })
  })

  it('prefers a rigid corner over a hinged one at a right angle', () => {
    const found = cornerForAngle(DOKA_FRAMAX_XLIFE, 'inside', 90, 2700)
    expect(found?.hinged ?? false).toBe(false)
  })

  it('reaches for the hinged unit at a skew angle a rigid one cannot turn', () => {
    const found = cornerForAngle(DOKA_FRAMAX_XLIFE, 'inside', 112, 2700)
    expect(found?.hinged).toBe(true)
  })

  it('has nothing for an angle outside every unit’s sweep', () => {
    expect(cornerForAngle(DOKA_FRAMAX_XLIFE, 'inside', 40, 2700)).toBeUndefined()
  })
})

/**
 * `fitCorner` is the join between the geometry engine and the catalog: the
 * coverage pass says an inside 90° corner lands here, and this has to answer with
 * a part number or an honest nothing.
 */
describe('fitting a product to a junction the geometry found', () => {
  function junctionCorner(
    side: 'inside' | 'outside',
    angleDeg: number,
    turnsOntoThicknessM = 0.2,
  ): JunctionCorner {
    const leg = (face: 'a' | 'b'): CornerLeg => ({
      elementId: 'wall_x' as never,
      alongM: 3,
      face,
      towardEnd: true,
      turnsOntoThicknessM,
    })
    return { side, angleDeg, legs: [leg('a'), leg('b')] }
  }

  it('turns a square inside corner on the system’s own unit', () => {
    const fit = fitCorner(DOKA_FRAMAX_XLIFE, junctionCorner('inside', 90), 2700)
    expect(fit?.corner.itemNo).toBe('588130500')
    expect(fit?.legLengthsM[0]).toBeCloseTo(0.3, 6)
  })

  it('measures an outside leg off the core, so it exceeds the inside leg', () => {
    const inside = fitCorner(DOKA_FRAMAX_XLIFE, junctionCorner('inside', 90), 2700)
    const outside = fitCorner(DOKA_FRAMAX_XLIFE, junctionCorner('outside', 90), 2700)
    expect((outside?.legLengthsM[0] ?? 0) - (inside?.legLengthsM[0] ?? 0)).toBeCloseTo(0.2, 6)
  })

  it('returns PERI’s unequal legs in the junction’s own leg order', () => {
    const fit = fitCorner(PERI_TRIO, junctionCorner('inside', 90), 2700)
    expect(fit?.legLengthsM).toEqual([0.18, 0.3])
  })

  it('falls back to another height rather than failing on the angle', () => {
    // 2.10 m is not a Framax corner height, but the angle is still turnable.
    const fit = fitCorner(DOKA_FRAMAX_XLIFE, junctionCorner('inside', 90), 2100)
    expect(fit?.corner.side).toBe('inside')
  })

  it('reports the junctions the system cannot turn instead of billing a corner that does not exist', () => {
    const corners = [junctionCorner('inside', 90), junctionCorner('inside', 35)]
    const unfittable = unfittableCorners(DOKA_FRAMAX_XLIFE, corners)
    expect(unfittable).toHaveLength(1)
    expect(unfittable[0]?.angleDeg).toBe(35)
  })
})

describe('the compensation cascade', () => {
  it('spends a discrete plate before the adjustable filler', () => {
    const found = fillerForGap(PERI_TRIO, 50, 2700)
    expect(found?.madeFrom).toBe('system-plate')
    expect(found?.itemNo).toBe('023182')
  })

  it('falls to the continuous filler plate for a width no plate covers', () => {
    const found = fillerForGap(PERI_TRIO, 210, 2700)
    expect(found?.label).toContain('Filler Plate LA')
  })

  it('reaches the site-cut profile only below the filler plate’s range', () => {
    const found = fillerForGap(PERI_TRIO, 40, 2700)
    expect(found?.madeFrom).toBe('site-cut')
  })

  it('finds nothing for a sliver below every filler’s reach, so the run is re-split', () => {
    expect(fillerForGap(PERI_TRIO, 5, 2700)).toBeUndefined()
  })

  it('will not close a tall run with a short plate, however well its width fits', () => {
    // Same 50 mm gap, a 3.30 m lift: the 2.70 m plate is the wrong part.
    const found = fillerForGap(PERI_TRIO, 50, 3300)
    expect(found?.heightMm).toBe(3300)
    expect(found?.itemNo).toBe('054391')
  })
})

describe('column forms size by increment, not by tiling', () => {
  it('snaps a cross-section up to the next increment', () => {
    expect(columnFormSizeMm(DOKA_KS_XLIFE, 337)).toBe(350)
    expect(columnFormSizeMm(DOKA_KS_XLIFE, 350)).toBe(350)
  })

  it('lifts an undersized column to the form’s minimum', () => {
    expect(columnFormSizeMm(DOKA_KS_XLIFE, 150)).toBe(200)
  })

  it('refuses a cross-section past the form’s reach rather than rounding it down', () => {
    expect(columnFormSizeMm(DOKA_KS_XLIFE, 700)).toBeUndefined()
    expect(columnFormSizeMm(FRAMAX_COLUMN, 1050)).toBe(1067)
  })

  it('stacks on the height grid and stops at the published maximum', () => {
    expect(columnStackCount(DOKA_KS_XLIFE, 3000)).toBe(10)
    expect(columnStackCount(DOKA_KS_XLIFE, 7000)).toBeUndefined()
  })
})

describe('column clamps close the box, and their reach is its own constraint', () => {
  it('picks the shortest reach that closes the section', () => {
    // A 450–1200 clamp set to 300 is at the bottom of its adjustment with its arm at
    // full extension, so the 150–600 is both cheaper and stiffer.
    expect(clampForSizeMm(DOKA_KS_XLIFE, 300)?.maxSizeMm).toBe(600)
    expect(clampForSizeMm(FRAMAX_COLUMN, 700)?.maxSizeMm).toBe(900)
    expect(clampForSizeMm(FRAMAX_COLUMN, 1000)?.maxSizeMm).toBe(1200)
  })

  it('reaches every section a KS Xlife can be set to', () => {
    for (let dim = DOKA_KS_XLIFE.minDimMm; dim <= DOKA_KS_XLIFE.maxDimMm; dim += 50) {
      expect(clampForSizeMm(DOKA_KS_XLIFE, dim)).toBeDefined()
    }
  })

  it('offers nothing below the smallest reach or above the largest', () => {
    expect(clampForSizeMm(DOKA_KS_XLIFE, 100)).toBeUndefined()
    expect(clampForSizeMm(FRAMAX_COLUMN, 1250)).toBeUndefined()
  })

  it('comes in sets of four and rates its capacity per side', () => {
    for (const clamp of ADJUSTABLE_COLUMN_CLAMPS) {
      expect(clamp.setQuantity).toBe(4)
      expect(clamp.capacityBasis).toBe('permissible')
      // The capacity is by analogy, not published, and must say so.
      expect(clamp.verification).toBe('unverified')
    }
  })
})

describe('sheet stock', () => {
  it('forbids rotating film-faced ply, because the grain carries the bending', () => {
    for (const sheet of SHEET_STOCK) expect(sheet.rotatable).toBe(false)
  })

  it('runs length along the grain, so 1250 x 2500 is not 2500 x 1250', () => {
    const birch = SHEET_STOCK.find((s) => s.id === 'ply-1250x2500x18-birch-wbp')
    expect(birch?.lengthMm).toBe(2500)
    expect(birch?.widthMm).toBe(1250)
  })

  it('predicts more reuses from a heavier film, monotonically', () => {
    const bands = [undefined, 80, 120, 220, 400].map(
      (film) => expectedReusesForFilm(film as number | undefined).max,
    )
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i] as number).toBeGreaterThanOrEqual(bands[i - 1] as number)
    }
  })
})

describe('the registry', () => {
  it('resolves a system by id and nothing by an unknown one', () => {
    expect(formworkSystem('peri-trio')?.manufacturer).toBe('PERI')
    expect(formworkSystem('nope')).toBeUndefined()
  })

  it('resolves an unseeded id to its registration rather than to nothing', () => {
    expect(formworkSystem('mivan-generic')?.seeded).toBe(false)
    // The seeded-only lookup is where the layout paths go, so an unseeded id can never
    // be laid out by accident.
    expect(seededFormworkSystem('mivan-generic')).toBeUndefined()
    expect(seededFormworkSystem('peri-trio')?.manufacturer).toBe('PERI')
  })
})
