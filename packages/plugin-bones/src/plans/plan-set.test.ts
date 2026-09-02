import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, OpeningSlice, RoomSlice, SlabSlice, WallSlice } from '../core/types'
import { feet, formatFtIn, inches } from '../core/units'
import type { BuildingCharacteristics } from '../engines/characteristics'
import { buildFoundation } from '../engines/foundation'
import { applyJurisdiction, profileFor } from '../jurisdiction/profiles'
import { layoutHvac } from '../engines/hvac'
import { layoutPlumbing } from '../engines/plumbing'
import { frameWalls } from '../engines/wall-framing'
import { lgsFrameWalls } from '../engines/lgs-wall-framing'
import { assignOpeningMarks, buildPlanSet, planSetHtml, relativeLevelBaseY } from './plan-set'

const member = (over: Partial<Member>): Member => ({
  system: 'floor-framing',
  role: 'joist',
  size: '2x10',
  dims: [4, 0.235, 0.038],
  length: 4,
  position: [2, -0.3, 1],
  rotation: [0, 0, 0],
  material: 'lumber',
  sourceId: 'slab_1',
  ...over,
})

const fixture = (over: Partial<Fixture>): Fixture => ({
  system: 'electrical',
  kind: 'receptacle',
  position: [1, 0.38, 0],
  rotationY: 0,
  sourceId: 'wall_1',
  ...over,
})

describe('buildPlanSet', () => {
  test('one sheet per system present + schedules; empty systems skipped', () => {
    const members = [
      member({}),
      member({ role: 'girder', size: '4x10' }),
      member({ system: 'wall-framing', role: 'stud', size: '2x4', dims: [0.038, 2.3, 0.089], rotation: [0, Math.PI / 4, 0] }),
      member({ system: 'foundation', role: 'footing', size: undefined, material: 'concrete', dims: [4, 0.2, 0.4] }),
      member({ system: 'roof-framing', role: 'rafter', dims: [3.5, 0.14, 0.038], rotation: [0, Math.PI / 2, 0.7] }),
      member({
        system: 'electrical',
        role: 'wire-run',
        size: undefined,
        material: 'copper',
        dims: [2, 0.013, 0.013],
        label: 'NM-B 12/2 w/G — SA-1',
        sourceId: 'SA-1',
      }),
    ]
    const fixtures = [
      fixture({ meta: { circuit: 'SA-1', breakerA: 20, gaugeAwg: 12 } }),
      fixture({ kind: 'switch' }),
    ]
    const sheets = buildPlanSet(members, fixtures, {
      projectName: 'Demo House',
      levelName: 'Ground Floor',
      jurisdiction: 'FL',
      date: '2026-08-14',
    })
    const titles = sheets.map((s) => s.title)
    expect(titles).toEqual([
      'Cover',
      'Foundation plan',
      'Floor framing plan',
      'Wall framing plan',
      'Roof framing plan',
      'Electrical rough-in plan',
      'South elevation (framing)',
      'North elevation (framing)',
      'East elevation (framing)',
      'West elevation (framing)',
      'Section A-A (transverse)',
      'Schedules + takeoff',
    ])
    // no plumbing/hvac members → no MEP sheet
    expect(titles).not.toContain('Plumbing + HVAC plan')
    for (const s of sheets) {
      expect(s.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
      expect(s.svg).toContain('viewBox="0 0 1056 816"')
      if (s.title === 'Cover') continue // hero layout: title + index, no chrome block
      expect(s.svg).toContain('Demo House')
      expect(s.svg).toContain('Ground Floor')
      expect(s.svg).toContain('Jurisdiction: FL')
      expect(s.svg).toContain('2026-08-14')
      expect(s.svg).toContain('Drafting aid, not engineering')
      // scale bar on drawing sheets only — the text-only schedules sheet
      // dropping it is intentional (quality C1)
      if (!s.title.startsWith('Schedules')) {
        // bar label now carries the snapped ratio: "3 m (1:75)"
        expect(s.svg).toMatch(/>\d+ m \(1:\d+\)<\/text>/)
        // north arrow on PLAN sheets only — elevations/sections have none
        if (!s.title.includes('elevation') && !s.title.startsWith('Section')) {
          expect(s.svg).toContain('>N</text>')
        }
      }
      expect(s.svg).toMatch(/SHEET \d+\/\d+/) // numbering
    }
    // electrical sheet symbolizes devices with tags
    const elec = sheets.find((s) => s.title.startsWith('Electrical'))?.svg ?? ''
    expect(elec).toContain('>R</text>')
    expect(elec).toContain('>S</text>')
    // wires carry their CIRCUIT color + the zone legend
    const { circuitColor } = require('./circuit-colors') as typeof import('./circuit-colors')
    expect(elec).toContain(circuitColor('SA-1'))
    expect(elec).toContain('SA-1')
    expect(elec).toContain('kitchen small-appliance')
    // rotated stud carries its yaw into the plan transform (−45°)
    const wall = sheets.find((s) => s.title.startsWith('Wall'))?.svg ?? ''
    expect(wall).toContain('rotate(-45.00)')
    // sloped rafter is foreshortened in plan: 3.5·cos(0.7)·scale, not full length
    const roof = sheets.find((s) => s.title.startsWith('Roof'))?.svg ?? ''
    expect(roof).toContain('rect')
    // schedules sheet lists takeoff rows
    const sched = sheets.find((s) => s.title.startsWith('Schedules'))?.svg ?? ''
    expect(sched).toContain('Material takeoff')
    expect(sched).toMatch(/2x10/)
  })

  test('engineering flags surface on the schedules sheet', () => {
    const flagged = member({ flag: 'ENGINEERED BEAM REQUIRED — exceeds prescriptive header span' })
    const sched = buildPlanSet([flagged], [], {}).find((s) => s.title.startsWith('Schedules'))
    expect(sched?.svg).toContain('ENGINEERED BEAM REQUIRED')
  })

  test('empty input → no sheets', () => {
    expect(buildPlanSet([], [])).toEqual([])
  })
})

describe('planSetHtml', () => {
  test('paginates every sheet with print CSS', () => {
    const sheets = buildPlanSet([member({})], [], { projectName: 'P' })
    const html = planSetHtml(sheets, { projectName: 'P' })
    expect(html).toContain('@page { size: letter landscape')
    expect(html).toContain('page-break-after: always')
    expect((html.match(/<section class="sheet">/g) ?? []).length).toBe(sheets.length)
    expect(html).toContain('Save as PDF')
    // self-contained: the svg markup is inlined
    expect(html).toContain('viewBox="0 0 1056 816"')
  })
})

describe('cover / elevations / section (round: standard set)', () => {
  test('cover leads with title + sheet index; elevations carry a grade line', () => {
    const members = [
      member({ system: 'wall-framing', role: 'stud', dims: [0.04, 2.4, 0.09], position: [1, 1.2, 0], rotation: [0, 0, 0] }),
      member({ system: 'roof-framing', role: 'rafter', dims: [3, 0.04, 0.09], position: [2, 0.5, 1], rotation: [0, 0, 0.5], levelId: 'lvlroof' }),
    ]
    const sheets = buildPlanSet(members, [], {
      projectName: 'Two Storey',
      levelBaseY: { lvlroof: 5.0 },
    })
    expect(sheets[0]?.title).toBe('Cover')
    expect(sheets[0]?.svg).toContain('SHEET INDEX')
    expect(sheets[0]?.svg).toContain('Two Storey')
    const south = sheets.find((s) => s.title.startsWith('South elevation'))
    expect(south).toBeDefined()
    expect(south?.svg).toContain('GRADE')
    expect(sheets.some((s) => s.title.startsWith('Section A-A'))).toBe(true)
  })
})

describe('MEP sheet — plumbing system colors + slope note (plumbing rebuild)', () => {
  // Distinct positions — identical (role, position, dims) triples would be
  // collapsed by the sheet's dedupeShapes pass.
  let pipeZ = 0
  const pipe = (sourceId: string): Member =>
    member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: sourceId.startsWith('dwv') ? 'pvc' : 'copper',
      dims: [2, 0.02, 0.02],
      position: [2, 0.4, (pipeZ += 0.5)],
      sourceId,
    })

  test('cold/hot/DWV runs carry their prefix colors; legend + slope note print', () => {
    const members = [
      pipe('cold-lav'),
      pipe('hot-lav'),
      pipe('dwv-main'),
      // hvac line-set pair — the M2 line-set round: same sheet, own colors
      { ...pipe('lineset-suction-1'), system: 'hvac' as const },
      { ...pipe('lineset-liquid-1'), system: 'hvac' as const },
    ]
    const fixtures = [
      fixture({
        system: 'plumbing',
        kind: 'water-meter',
        position: [0, 0.3, 0],
        sourceId: 'w_s',
      }),
    ]
    const { PLUMBING_COLORS } = require('./circuit-colors') as typeof import('./circuit-colors')
    const mep = buildPlanSet(members, fixtures, {}).find((s) => s.title.startsWith('Plumbing'))
    expect(mep).toBeDefined()
    const svg = mep?.svg ?? ''
    for (const color of Object.values(PLUMBING_COLORS)) expect(svg).toContain(color)
    // every color on the sheet appears in its legend (invariant P2)
    expect(svg).toContain('supply — cold water')
    expect(svg).toContain('supply — hot water')
    expect(svg).toContain('DWV drain / vent')
    // two short rows — the one-liner overflowed the legend box (E1)
    expect(svg).toContain('DWV SLOPE 1/4 IN/FT (1/8 AT 3 IN+)')
    expect(svg).toContain('ARROWS POINT TO SEWER (P3005.3)')
    // refrigerant line-set legend rows (examiner round-5 carried minor)
    expect(svg).toContain('line-set — suction ¾&quot; (insulated)')
    expect(svg).toContain('line-set — liquid ⅜&quot;')
    // the meter tags with M and the tag is named in the legend
    expect(svg).toContain('>M</text>')
    expect(svg).toContain('water meter')
  })

  test('line-set pair prints BOTH colors at DISTINCT plan positions (examiner blocker)', () => {
    // The real pair shares one plan path (the 4 cm offset is VERTICAL) — a
    // truthful projection overprints the two rects and the last-drawn pipe
    // wins: the suction line never rendered a visible pixel. The schematic
    // perpendicular nudge must split them on paper.
    const twinPipe = (sourceId: string, y: number): Member =>
      member({
        system: 'hvac',
        role: 'pipe-run',
        size: undefined,
        material: 'copper',
        dims: [2, 0.019, 0.019],
        length: 2,
        position: [2, y, 4],
        sourceId,
      })
    const members = [twinPipe('lineset-suction-1', 0.42), twinPipe('lineset-liquid-1', 0.38)]
    const mep = buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Plumbing'))
    const svg = mep?.svg ?? ''
    const rectsOf = (color: string): [number, number][] =>
      [...svg.matchAll(
        new RegExp(`<rect[^>]*fill="${color}"[^>]*transform="translate\\(([-\\d.]+) ([-\\d.]+)\\)`, 'g'),
      )].map((m) => [Number(m[1]), Number(m[2])])
    const suctionRects = rectsOf('#35b8c9')
    const liquidRects = rectsOf('#d98134')
    // both pipes DRAW (transform-bearing rects — legend swatches don't count)
    expect(suctionRects.length).toBe(1)
    expect(liquidRects.length).toBe(1)
    // … at distinct plan positions: the nudge splits the pair ~5 px apart
    const [sx, sz] = suctionRects[0] as [number, number]
    const [lx, lz] = liquidRects[0] as [number, number]
    expect(Math.hypot(sx - lx, sz - lz)).toBeGreaterThanOrEqual(4)
  })

  test('room-category fallback keeps the single pipe tint (no phantom legend rows)', () => {
    const mep = buildPlanSet([pipe('r_bath')], [], {}).find((s) => s.title.startsWith('Plumbing'))
    const svg = mep?.svg ?? ''
    expect(svg).toContain('supply / DWV pipe')
    expect(svg).not.toContain('supply — cold water')
    // plumbing present → the standing slope note prints
    expect(svg).toContain('ARROWS POINT TO SEWER (P3005.3)')
  })

  test('under-floor drains print a downstream flow arrow; level supply does not', () => {
    // A buried 3" branch falling at 1/8"/ft toward −X: member +X points
    // UPHILL (leg convention), so the arrow must point downstream (−X).
    const drain = member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: 'pvc',
      dims: [4, 0.0762, 0.0762],
      position: [4, -0.5, 2],
      rotation: [0, 0, Math.atan(1 / 96)],
      sourceId: 'dwv-branch-r_bath',
    })
    const supply = member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: 'copper',
      dims: [4, 0.02, 0.02],
      position: [4, 0.28, 3],
      rotation: [0, 0, 0],
      sourceId: 'cold-lav',
    })
    const mep = buildPlanSet([drain, supply], [], {}).find((s) => s.title.startsWith('Plumbing'))
    const svg = mep?.svg ?? ''
    const arrows = svg.match(/fill="#41637a"/g) ?? []
    expect(arrows).toHaveLength(1) // one sloped drain → one arrow, none on supply
    // pointing −X on paper: the glyph rotates 180° (±)
    const rot = svg.match(/#41637a" transform="translate\([^)]*\) rotate\((-?[\d.]+)\)/)
    expect(Math.abs(Math.abs(Number(rot?.[1])) - 180)).toBeLessThan(1.5)
  })

  test('E2: an arrow under a device bubble slides along its run instead of vanishing', () => {
    const drain = member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: 'pvc',
      dims: [4, 0.0762, 0.0762],
      position: [4, -0.5, 2],
      rotation: [0, 0, Math.atan(1 / 96)],
      sourceId: 'dwv-branch-r_bath',
    })
    // a supply register bubble EXACTLY on the run's midpoint (the E2 repro)
    const reg = fixture({ system: 'hvac', kind: 'register', position: [4, 2.6, 2], sourceId: 'r' })
    const mep = buildPlanSet([drain], [reg], {}).find((s) => s.title.startsWith('Plumbing'))
    const svg = mep?.svg ?? ''
    const arrow = svg.match(/fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/)
    expect(arrow).not.toBeNull()
    const bubble = svg.match(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><circle r="7"/)
    expect(bubble).not.toBeNull()
    const d = Math.hypot(
      Number(arrow?.[1]) - Number(bubble?.[1]),
      Number(arrow?.[2]) - Number(bubble?.[2]),
    )
    expect(d).toBeGreaterThanOrEqual(12)
  })

  test('E3: the sewer exit prints a marker + SEWER/SEPTIC tag, not just a CO bubble', () => {
    const main = member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: 'pvc',
      dims: [3, 0.0762, 0.0762],
      position: [2, -0.6, 1],
      rotation: [0, 0, Math.atan(1 / 48)], // +X uphill → downhill toward −X
      sourceId: 'dwv-main',
      label: '3" building drain — 8 DFU @ 1/4"/ft → sewer/septic (P3005.4)',
    })
    const co = fixture({
      system: 'plumbing',
      kind: 'cleanout',
      position: [0.5, 0.15, 1],
      sourceId: 'dwv-main',
      label: 'Cleanout @ sewer exit (P3005.2.1)',
    })
    const mep = buildPlanSet([main], [co], {}).find((s) => s.title.startsWith('Plumbing'))
    const svg = mep?.svg ?? ''
    expect(svg).toContain('SEWER/SEPTIC (P3005.4)')
    // upper-storey wording (no 'sewer' cleanout) prints NO marker
    const upperCo = fixture({
      system: 'plumbing',
      kind: 'cleanout',
      position: [0.5, 0.15, 1],
      sourceId: 'dwv-main',
      label: 'Cleanout @ drain main terminus (P3005.2)',
    })
    const upper = buildPlanSet([main], [upperCo], {}).find((s) => s.title.startsWith('Plumbing'))
    expect(upper?.svg ?? '').not.toContain('SEWER/SEPTIC (P3005.4)')
  })

  test('below-grade DWV prints DASHED on elevations (foundation hidden-work convention)', () => {
    const buried = member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: 'pvc',
      dims: [3, 0.0762, 0.0762],
      position: [2, -0.6, 1],
      rotation: [0, 0, Math.atan(1 / 48)],
      sourceId: 'dwv-main',
    })
    const supply = member({
      system: 'plumbing',
      role: 'pipe-run',
      size: undefined,
      material: 'copper',
      dims: [3, 0.02, 0.02],
      position: [2, 0.28, 2],
      sourceId: 'cold-lav',
    })
    // a wall member so the elevation sheet has a facade to draw
    const stud = member({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.038, 2.3, 0.089],
      position: [2, 1.2, 0],
    })
    const sheets = buildPlanSet([buried, supply, stud], [], {})
    const south = sheets.find((s) => s.title.startsWith('South elevation'))
    expect(south).toBeDefined()
    const svg = south?.svg ?? ''
    const dashed = svg.match(/stroke-dasharray="5 3"/g) ?? []
    expect(dashed.length).toBeGreaterThan(0)
    // the dashes belong to the buried run, not the in-wall supply: every
    // plumbing line above the floor stays solid
    const lines = svg.match(/<line [^/]*\/>/g) ?? []
    const plumbLines = lines.filter((l) => l.includes('stroke-dasharray'))
    expect(plumbLines.length).toBeGreaterThan(0)
  })
})

describe('MEP sheet — return duct prints in its own tone + legend row (B19c / M3)', () => {
  const duct = (sourceId: string, label: string, z: number): Member =>
    member({
      system: 'hvac',
      role: 'duct-run',
      size: undefined,
      material: 'duct',
      dims: [3, 0.203, 0.356],
      position: [3, 2.8, z],
      sourceId,
      label,
    })
  const supply = duct('r_hall', 'Trunk 14"×8" — 800 cfm', 1)
  const ret = duct('return-trunk', 'Return trunk 14"×8" — 800 cfm (M1602)', 2)

  test('return runs carry the darker tone; supply keeps the base duct fill; both legend rows print', () => {
    const { DUCT_COLORS } = require('./circuit-colors') as typeof import('./circuit-colors')
    const mep = buildPlanSet([supply, ret], [], {}).find((s) => s.title.startsWith('Plumbing'))
    expect(mep).toBeDefined()
    const svg = mep?.svg ?? ''
    // both tones drawn…
    expect(svg).toContain(`fill="${DUCT_COLORS.return}"`)
    expect(svg).toContain(`fill="${DUCT_COLORS.supply}"`)
    // …and both named in the legend (P2) — the base row says which air path
    expect(svg).toContain('duct — return air')
    expect(svg).toContain('>duct — supply air</text>')
  })

  test('supply-only sheet shows no return legend row (and vice versa)', () => {
    const { DUCT_COLORS } = require('./circuit-colors') as typeof import('./circuit-colors')
    const supplyOnly = buildPlanSet([supply], [], {}).find((s) => s.title.startsWith('Plumbing'))
    expect(supplyOnly?.svg ?? '').not.toContain('duct — return air')
    const returnOnly = buildPlanSet([ret], [], {}).find((s) => s.title.startsWith('Plumbing'))
    const rsvg = returnOnly?.svg ?? ''
    expect(rsvg).toContain('duct — return air')
    // the base supply swatch never prints for tin the sheet doesn't draw
    expect(rsvg).not.toContain('>duct — supply air</text>')
    expect(rsvg).not.toContain(`fill="${DUCT_COLORS.supply}"`)
  })
})

describe('BUILDING CHARACTERISTICS block on the schedules sheet', () => {
  const characteristics: BuildingCharacteristics = {
    floorAreaM2: 40,
    volumeM3: 108,
    envelopeAreaM2: 61.4,
    windowCount: 1,
    windowAreaM2: 1.8,
    doorCount: 1,
    insulation: { climateZone: '2A', wallR: 13, citation: '2021 IECC Table R402.1.3' },
    uaWPerK: 30.1,
    designHeatLossW: 662,
    coolingTonsEstimate: 0.9,
    notes: ['Design heat loss at ΔT = 22 K (winter design assumption)'],
  }

  test('prints the compact metrics block when characteristics are passed', () => {
    const sched = buildPlanSet([member({})], [], { characteristics }).find((s) =>
      s.title.startsWith('Schedules'),
    )
    const svg = sched?.svg ?? ''
    expect(svg).toContain('BUILDING CHARACTERISTICS')
    expect(svg).toContain('Floor area 40.0 m²')
    expect(svg).toContain('Volume 108.0 m³')
    expect(svg).toContain('Envelope 61.4 m²')
    expect(svg).toContain('Climate zone 2A')
    expect(svg).toContain('Wall cavity R-13')
    expect(svg).toContain('Envelope UA 30.1 W/K')
    expect(svg).toContain('Design heat loss 662 W')
    expect(svg).toContain('RULE OF THUMB')
    expect(svg).toContain('2021 IECC Table R402.1.3')
  })

  test('no characteristics option → no block', () => {
    const sched = buildPlanSet([member({})], [], {}).find((s) => s.title.startsWith('Schedules'))
    expect(sched?.svg).not.toContain('BUILDING CHARACTERISTICS')
  })

  test('Manual-J-lite basis prints ON PAPER: composition (sensible × latent → total) + the M1401.3 line', () => {
    const mj: BuildingCharacteristics = {
      ...characteristics,
      coolingTonsEstimate: 0.35,
      coolingBasis: 'manual-j-lite',
      coolingSensibleTons: 0.28,
      coolingLatentFactor: 1.25,
      coolingMoistureRegime: 'A',
    }
    const sched = buildPlanSet([member({})], [], { characteristics: mj }).find((s) =>
      s.title.startsWith('Schedules'),
    )
    const svg = sched?.svg ?? ''
    // the F1 reach: sensible + allowance + total ALL on the sheet
    // (wrap-safe pieces — the composition may break across wrapped lines;
    // 0.35 prints '0.3' via toFixed(1) float round-down)
    expect(svg).toContain('Cooling ~0.3 ton (MANUAL J-LITE: 0.28 t')
    expect(svg).toContain('sensible × 1.25 latent A)')
    // (wrapRow may break the line — assert the wrap-safe pieces)
    expect(svg).toContain('cooling per Manual J-LITE')
    expect(svg).toContain('M1401.3')
    expect(svg).toContain('coarse latent allowance by moisture regime')
    expect(svg).toContain('full Manual J latent governs')
    // 'verify local design conditions' wraps mid-phrase at this column
    expect(svg).toContain('verify local')
    expect(svg).toContain('design conditions')
    expect(svg).toContain('not a full Manual J')
    expect(svg).not.toContain('RULE OF THUMB')
    // a regime-less zone (no latent fields / ×1.0) states sensible-only
    const bare: BuildingCharacteristics = {
      ...characteristics,
      coolingTonsEstimate: 0.28,
      coolingBasis: 'manual-j-lite',
      coolingSensibleTons: 0.28,
      coolingLatentFactor: 1,
      coolingMoistureRegime: null,
    }
    const svg2 =
      buildPlanSet([member({})], [], { characteristics: bare })
        .find((s) => s.title.startsWith('Schedules'))?.svg ?? ''
    // wrap-safe fragments (the ~100-char column breaks these phrases)
    expect(svg2).toContain('MANUAL J-LITE load,')
    expect(svg2).toContain('sensible-only — no latent')
    expect(svg2).toContain('sensible-only — verify local')
    // legacy/fallback objects (no basis) keep the rule-of-thumb wording —
    // the sibling test above pins it; the strings never coexist
  })

  test('coexists with flags: block stacks ABOVE the red flag list', () => {
    const flagged = member({ flag: 'ENGINEERED BEAM REQUIRED — exceeds prescriptive header span' })
    const sched = buildPlanSet([flagged], [], { characteristics }).find((s) =>
      s.title.startsWith('Schedules'),
    )
    const svg = sched?.svg ?? ''
    expect(svg).toContain('BUILDING CHARACTERISTICS')
    expect(svg).toContain('ENGINEERED BEAM REQUIRED')
    // the block's lowest line sits above the topmost flag line
    const yOf = (needle: string): number => {
      const at = svg.indexOf(needle)
      const m = /y="([\d.]+)"/.exec(svg.slice(svg.lastIndexOf('<text', at), at))
      return m ? Number(m[1]) : Number.NaN
    }
    expect(yOf('2021 IECC Table R402.1.3')).toBeLessThan(yOf('ENGINEERED BEAM REQUIRED'))
  })

  test('slab-less model prints n/a — never Floor area 0.0 / Cooling ~0.0 (round-3 C5)', () => {
    const noSlab: BuildingCharacteristics = {
      ...characteristics,
      floorAreaM2: 0,
      volumeM3: 0,
      coolingTonsEstimate: 0,
    }
    const sched = buildPlanSet([member({})], [], { characteristics: noSlab }).find((s) =>
      s.title.startsWith('Schedules'),
    )
    const svg = sched?.svg ?? ''
    expect(svg).toContain('n/a — no floor slabs (see flags)')
    expect(svg).not.toContain('Floor area 0.0')
    expect(svg).not.toContain('Cooling ~0.0')
    // envelope-derived metrics still print as numbers
    expect(svg).toContain('Envelope UA 30.1 W/K')
  })

  test('multi-page takeoff: block prints on the LAST schedules page only', () => {
    // enough distinct (system × size × stock length) rows to overflow one
    // schedules page — rows aggregate on that triple
    const many: Member[] = []
    const systems = ['floor-framing', 'wall-framing', 'roof-framing'] as const
    for (let i = 0; i < 400; i++) {
      const len = 0.5 + (i % 80) * 0.09
      many.push(
        member({
          system: systems[i % 3],
          role: i % 2 === 0 ? 'joist' : 'stud',
          size: (['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '4x6', '4x8'] as const)[i % 8],
          length: len,
          dims: [len, 0.235, 0.038],
          position: [i * 0.1, 0, 1],
        }),
      )
    }
    const sheets = buildPlanSet(many, [], { characteristics }).filter((s) =>
      s.title.startsWith('Schedules'),
    )
    expect(sheets.length).toBeGreaterThan(1)
    for (const [i, s] of sheets.entries()) {
      if (i === sheets.length - 1) expect(s.svg).toContain('BUILDING CHARACTERISTICS')
      else expect(s.svg).not.toContain('BUILDING CHARACTERISTICS')
    }
  })
})

describe('round-3 fixCheck2 — EM symbol, SE legend row, notes wrap', () => {
  test('electric-meter tags EM on the electrical sheet, named in the legend (P4)', () => {
    // pre-fix: FIXTURE_TAG lacked 'electric-meter' → plan symbol '⊙·' and a
    // legend row literally named '·' (the one true P4 defect of the round)
    const members = [
      member({
        system: 'electrical',
        role: 'wire-run',
        size: undefined,
        material: 'copper',
        dims: [2, 0.013, 0.013],
        label: 'NM-B 14/2 w/G — GEN-1',
        sourceId: 'GEN-1',
      }),
    ]
    const fixtures = [
      fixture({ meta: { circuit: 'GEN-1', breakerA: 15, gaugeAwg: 14 } }),
      fixture({ kind: 'electric-meter', position: [3, 1.4, 0] }),
    ]
    const elec = buildPlanSet(members, fixtures, {}).find((s) =>
      s.title.startsWith('Electrical'),
    )
    const svg = elec?.svg ?? ''
    expect(svg).toContain('>EM</text>')
    expect(svg).toContain('electric meter')
    expect(svg).not.toContain('>·</text>')
  })

  test('service-entrance legend row reads like the takeoff, never a placeholder', () => {
    const members = [
      member({
        system: 'electrical',
        role: 'wire-run',
        size: undefined,
        material: 'copper',
        dims: [2, 0.013, 0.013],
        label: 'NM-B 14/2 w/G — GEN-1',
        sourceId: 'GEN-1',
        position: [2, 0.45, 1],
      }),
      member({
        system: 'electrical',
        role: 'wire-run',
        size: undefined,
        material: 'copper',
        dims: [3, 0.035, 0.035],
        label: 'Service entrance 2 AWG Cu — meter → panel feed',
        sourceId: 'service-entrance',
        position: [2, 1.4, 2],
      }),
    ]
    const fixtures = [fixture({ meta: { circuit: 'GEN-1', breakerA: 15, gaugeAwg: 14 } })]
    const elec = buildPlanSet(members, fixtures, {}).find((s) =>
      s.title.startsWith('Electrical'),
    )
    const svg = elec?.svg ?? ''
    expect(svg).toContain('SE cable 2 AWG Cu — street → meter → panel (NEC 230)')
    expect(svg).not.toContain('—A/—AWG · service-entrance')
    // branch circuits keep the breaker/gauge row format
    expect(svg).toContain('GEN-1 — 15A/14AWG')
  })

  test('GES legend rows (B12): named like the takeoff, never the dash pattern', () => {
    const { circuitColor } = require('./circuit-colors') as typeof import('./circuit-colors')
    const wire = (sourceId: string, label: string, z: number) =>
      member({
        system: 'electrical',
        role: 'wire-run',
        size: undefined,
        material: 'copper',
        dims: [1.8, 0.014, 0.014],
        label,
        sourceId,
        position: [2, 0.005, z],
      })
    const rod = (i: number, x: number) =>
      member({
        system: 'electrical',
        role: 'ground-rod',
        size: undefined,
        material: 'copper',
        dims: [0.016, 2.4384, 0.016],
        label: `Ground rod ${i}`,
        sourceId: `ges-rod-${i}`,
        position: [x, -0.05 - 2.4384 / 2, 3],
      })
    const members = [
      wire('GES-1', 'GEC 8 AWG Cu — grounding electrode conductor (NEC 250.66) — grade run to rod 1', 1),
      wire('GES-2', 'Water-pipe bond 8 AWG Cu — metal water service (NEC 250.104(A))', 2),
      rod(1, 1),
      rod(2, 2.83),
      member({
        system: 'electrical',
        role: 'equipment',
        size: undefined,
        material: 'steel',
        dims: [0.1, 0.08, 0.04],
        label: 'Intersystem bonding termination — ≥3 terminals at the service (NEC 250.94)',
        sourceId: 'ges-ibt',
        position: [2, 0.9, 0.1],
      }),
    ]
    const elec = buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Electrical'))
    const svg = elec?.svg ?? ''
    expect(svg).toContain('GEC bare Cu — meter → ground rods (NEC 250.66)')
    expect(svg).toContain('Water-pipe bond — metal water service (NEC 250.104)')
    expect(svg).not.toContain('—A/—AWG · grounding electrode')
    // and both swatches carry the shared 3D/paper family colors (E3)
    expect(svg).toContain(circuitColor('GES-1'))
    expect(svg).toContain(circuitColor('GES-2'))
    // round-3 examiner keys: rods + IBT get SYMBOLS (one GR bubble per
    // rod, one IB bubble) + legend rows (whose swatch repeats the tag) —
    // they printed as unkeyed dots
    expect(svg.match(/>GR<\/text>/g)?.length).toBe(3) // 2 plan bubbles + legend
    expect(svg.match(/>IB<\/text>/g)?.length).toBe(2) // 1 plan bubble + legend
    expect(svg).toContain('ground rod — driven electrode (NEC 250.52)')
    expect(svg).toContain('intersystem bonding termination (NEC 250.94)')
  })

  test('characteristics notes line WRAPS at the column width — the tail never clips', () => {
    const characteristics: BuildingCharacteristics = {
      floorAreaM2: 40,
      volumeM3: 108,
      envelopeAreaM2: 61.4,
      windowCount: 1,
      windowAreaM2: 1.8,
      doorCount: 1,
      insulation: {
        climateZone: '7',
        wallR: 21,
        // long citation pushes the notes line past 100 chars — pre-fix it
        // was clip()ed and the disclaimers fell off the sheet
        citation: '2021 IECC Table R402.1.3 as amended by the state energy conservation construction code',
      },
      uaWPerK: 30.1,
      designHeatLossW: 662,
      coolingTonsEstimate: 0.9,
      notes: [],
    }
    const sched = buildPlanSet([member({})], [], { characteristics }).find((s) =>
      s.title.startsWith('Schedules'),
    )
    const svg = sched?.svg ?? ''
    expect(svg).toContain('BUILDING CHARACTERISTICS')
    // head AND tail of the wrapped notes line both print
    expect(svg).toContain('2021 IECC Table R402.1.3 as amended')
    expect(svg).toContain('not a Manual J')
  })
})

describe('blueprint round-3 — poché, cut mark, legends, wrap, coverage, dowels', () => {
  const stud = (x: number, z: number): Member =>
    member({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.04, 2.4, 0.09],
      position: [x, 1.2, z],
      rotation: [0, 0, 0],
    })

  test('section poché: members the plane slices ACROSS get a filled cut rect, beyond stays light at 0.6', () => {
    // the plate runs along X — the plane slices across it (poché rect at the
    // plane∩member slice); studs are vertical (axis parallel to the plane)
    // so they only ever print as beyond-work; far studs fall outside the
    // band entirely
    const members = [
      member({
        system: 'wall-framing',
        role: 'bottom-plate',
        size: '2x4',
        dims: [4, 0.04, 0.09],
        position: [2, 0.02, 1],
        rotation: [0, 0, 0],
      }),
      stud(3.3, 3),
      stud(1.9, 2),
      stud(5.8, 4),
    ]
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Section A-A'))?.svg ?? ''
    // exactly ONE dark cut rect (the plate); its full length prints as
    // beyond-linework — never a whole-member dark line
    expect([...svg.matchAll(/<rect [^>]*fill="#222"/g)]).toHaveLength(1)
    expect(svg).not.toMatch(/<line [^>]*stroke="#222" stroke-width="[\d.]+" stroke-linecap="butt"\/>/)
    const beyond = [
      ...svg.matchAll(/<line [^>]*stroke="#caa06a" stroke-width="[\d.]+" stroke-linecap="butt" opacity="0.6"\/>/g),
    ]
    // out-of-band studs are not drawn: the cut plate + 1 in-band stud
    expect(beyond).toHaveLength(2)
    expect([...svg.matchAll(/stroke-linecap="butt"/g)]).toHaveLength(2)
  })

  test('A-A cut mark prints on the wall framing plan only, bubbled at both ends', () => {
    const members = [stud(0, 0), stud(2, 1), stud(4, 2), member({})]
    const sheets = buildPlanSet(members, [], {})
    const wall = sheets.find((s) => s.title === 'Wall framing plan')?.svg ?? ''
    expect(wall).toContain('stroke-dasharray="9 4"')
    expect([...wall.matchAll(/>A<\/text>/g)]).toHaveLength(2)
    const floor = sheets.find((s) => s.title === 'Floor framing plan')?.svg ?? ''
    expect(floor).not.toContain('stroke-dasharray="9 4"')
  })

  test('cover/elevations/section carry stroke legends for the systems each draws', () => {
    const members = [
      stud(4.8, 0),
      stud(5, 1),
      stud(5.2, 2),
      stud(0, 3),
      member({
        system: 'roof-framing',
        role: 'rafter',
        dims: [3, 0.14, 0.04],
        position: [5, 2.8, 1],
        rotation: [0, 0, 0.4],
      }),
      // vertical pipe OUT of the cut band (x=10; cutX stays 5)
      member({
        system: 'plumbing',
        role: 'pipe-run',
        size: undefined,
        material: 'pvc',
        dims: [0.05, 2, 0.05],
        position: [10, 1, 1],
      }),
    ]
    const sheets = buildPlanSet(members, [], {})
    const south = sheets.find((s) => s.title.startsWith('South elevation'))?.svg ?? ''
    expect(south).toContain('>wall framing</text>')
    expect(south).toContain('>roof framing</text>')
    expect(south).toContain('>plumbing</text>')
    expect(south).toContain('fill="#6f8fa8"')
    // the section legend lists only the systems inside the cut band
    const section = sheets.find((s) => s.title.startsWith('Section A-A'))?.svg ?? ''
    expect(section).toContain('>wall framing</text>')
    expect(section).not.toContain('>plumbing</text>')
    expect(sheets[0]?.svg ?? '').toContain('>wall framing</text>') // cover
  })

  test('long takeoff rows wrap at a word boundary — never a mid-word ellipsis', () => {
    const bolts: Member[] = []
    for (let i = 0; i < 12; i++) {
      bolts.push(
        member({
          system: 'foundation',
          role: 'anchor-bolt',
          size: undefined,
          material: 'steel',
          dims: [0.016, 0.23, 0.016],
          length: 0.23,
          position: [i * 0.8, -0.05, 0],
        }),
      )
    }
    const svg =
      buildPlanSet(bolts, [], {}).find((s) => s.title.startsWith('Schedules'))?.svg ?? ''
    // the R403.1.6 citation survives intact on the wrapped second line
    expect(svg).toContain('(R403.1.6))')
    expect(svg).not.toMatch(/R40[^)<]*…/)
    // continuation line is indented 14px into the column
    expect(svg).toContain('<text x="62"')
  })

  test('roof plan flags grid-coverage gaps; full rafter coverage stays clean', () => {
    const shell = [stud(0, 0), stud(10, 0), stud(10, 8), stud(0, 8)]
    const rafter = (dims: [number, number, number], x: number, z: number, rz = 0): Member =>
      member({ system: 'roof-framing', role: 'rafter', dims, position: [x, 2.6, z], rotation: [0, 0, rz] })
    const sheets = buildPlanSet(
      [...shell, rafter([2, 0.14, 0.04], 1, 0.5, 0.3), rafter([2, 0.14, 0.04], 1, 1.5, 0.3)],
      [],
      {},
    )
    const roof = sheets.find((s) => s.title === 'Roof framing plan')?.svg ?? ''
    expect(roof).toContain('no roof members')
    expect(roof).toContain('check roof coverage')
    // the warning also joins the schedules flag block (opts.warnings path)
    const sched = sheets.find((s) => s.title.startsWith('Schedules'))?.svg ?? ''
    expect(sched).toContain('part of the plan has no roof members')
    // rafters every 0.8 m across the whole footprint → every ~1m grid cell
    // sees roof, no warning
    const full: Member[] = []
    for (let z = 0; z <= 8.01; z += 0.8) full.push(rafter([10.2, 0.14, 0.04], 5, z))
    const clean = buildPlanSet([...shell, ...full], [], {})
    expect(clean.find((s) => s.title === 'Roof framing plan')?.svg ?? '').not.toContain(
      'check roof coverage',
    )
  })

  test('C1 gate: unroofed wing INSIDE the roofed body extents fires; roofing the wing silences it', () => {
    // synthetic reproduction of the demo shape: main rect x 0..14 / z 0..9
    // fully roofed, attached wing x -8..0 / z 0..5 unroofed. The old
    // bbox-AREA proxy scores 128/200 = 0.64 ≥ 0.6 and passed silently
    // (demo scored 0.72) — the ~1m grid sees the naked wing cells.
    const shell = [
      stud(-8, 0),
      stud(-8, 5),
      stud(0, 5),
      stud(0, 0),
      stud(14, 0),
      stud(14, 9),
      stud(0, 9),
    ]
    const rafter = (dims: [number, number, number], x: number, z: number): Member =>
      member({ system: 'roof-framing', role: 'rafter', dims, position: [x, 2.6, z], rotation: [0, 0, 0] })
    const mainRoof: Member[] = []
    for (let z = 0; z <= 9.01; z += 0.75) mainRoof.push(rafter([14.2, 0.14, 0.04], 7, z))
    const sheets = buildPlanSet([...shell, ...mainRoof], [], {})
    expect(sheets.find((s) => s.title === 'Roof framing plan')?.svg ?? '').toContain(
      'check roof coverage',
    )
    expect(sheets.find((s) => s.title.startsWith('Schedules'))?.svg ?? '').toContain(
      'part of the plan has no roof members',
    )
    // roof the wing too → silent
    const wingRoof: Member[] = []
    for (let z = 0; z <= 5.01; z += 0.75) wingRoof.push(rafter([8.2, 0.14, 0.04], -4, z))
    const covered = buildPlanSet([...shell, ...mainRoof, ...wingRoof], [], {})
    expect(covered.find((s) => s.title === 'Roof framing plan')?.svg ?? '').not.toContain(
      'check roof coverage',
    )
  })

  test('foundation plan: OPEN circles for rebar dowels, FILLED dots for bolts', () => {
    const steel = (role: Member['role'], dims: [number, number, number], x: number): Member =>
      member({
        system: 'foundation',
        role,
        size: undefined,
        material: 'steel',
        dims,
        length: Math.max(...dims),
        position: [x, -0.2, 0],
      })
    const members = [
      member({ system: 'foundation', role: 'footing', size: undefined, material: 'concrete', dims: [4, 0.2, 0.4], position: [2, -0.3, 0] }),
      steel('anchor-bolt', [0.016, 0.23, 0.016], 1),
      steel('anchor-bolt', [0.016, 0.23, 0.016], 3),
      steel('rebar', [0.013, 0.55, 0.013], 1.5),
      steel('rebar', [0.013, 0.55, 0.013], 2.5),
      // horizontal continuous bar keeps its rect — only VERTICAL dowels circle
      steel('rebar', [4, 0.013, 0.013], 2),
    ]
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title === 'Foundation plan')?.svg ?? ''
    // 2 dowels drawn open + 1 legend swatch
    expect([...svg.matchAll(/r="2\.6" fill="none"/g)]).toHaveLength(3)
    // 2 bolts drawn filled + 1 legend swatch
    expect([...svg.matchAll(/r="2\.2" fill="#444"/g)]).toHaveLength(3)
    expect(svg).toContain('vertical rebar dowels — 2 pcs')
  })
})

describe('round-3 scorecard fix batch — N3 poché granularity, P4 label nudge, N2 butt caps', () => {
  const stud = (x: number, z: number): Member =>
    member({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.04, 2.4, 0.09],
      position: [x, 1.2, z],
      rotation: [0, 0, 0],
    })

  test('N3 gate: a wall ALONG the cut plane never renders dark; the plane slides clear; a joist crossing it pochés', () => {
    const zStud = (z: number): Member =>
      member({
        system: 'wall-framing',
        role: 'stud',
        dims: [0.04, 2.4, 0.09],
        position: [2, 1.2, z],
        rotation: [0, Math.PI / 2, 0],
      })
    const members = [
      // wall running along Z at x=2 — plate + studs, every axis parallel
      // to the would-be midpoint plane (the gabled spine-wall regression)
      member({
        system: 'wall-framing',
        role: 'bottom-plate',
        dims: [4, 0.04, 0.09],
        position: [2, 0.02, 2],
        rotation: [0, Math.PI / 2, 0],
      }),
      zStud(1),
      zStud(3),
      // floor joist along X crossing the whole extent
      member({}),
    ]
    const sheets = buildPlanSet(members, [], {})
    const section = sheets.find((s) => s.title.startsWith('Section A-A'))?.svg ?? ''
    // exactly ONE dark poché RECT — the joist the plane slices across; the
    // wall members print as 0.6-opacity beyond work, never solid
    expect([...section.matchAll(/<rect [^>]*fill="#222"/g)]).toHaveLength(1)
    expect(section).not.toMatch(/<line [^>]*stroke="#222" stroke-width="[\d.]+" stroke-linecap="butt"\/>/)
    const beyond = [
      ...section.matchAll(/stroke="#caa06a" stroke-width="[\d.]+" stroke-linecap="butt" opacity="0.6"/g),
    ]
    expect(beyond).toHaveLength(3)
    // the cut joist's remaining length joins the beyond line work too
    // (floor-framing stroke at 0.6 — never a whole-member dark bar)
    expect(section).toMatch(/stroke="#b98d55" stroke-width="[\d.]+" stroke-linecap="butt" opacity="0.6"/)
    // the shared cutX helper slid the plane OFF the wall's axis — the A-A
    // mark on the wall plan no longer sits at the wall's x
    const wallSheet = sheets.find((s) => s.title === 'Wall framing plan')?.svg ?? ''
    const markX = Number(/<line x1="([\d.]+)" [^>]*stroke-dasharray="9 4"/.exec(wallSheet)?.[1])
    const wallX = Number(/translate\(([\d.]+) /.exec(wallSheet)?.[1])
    expect(Number.isFinite(markX)).toBe(true)
    expect(Number.isFinite(wallX)).toBe(true)
    expect(Math.abs(markX - wallX)).toBeGreaterThan(5)
  })

  test('N2 gate: elevation/section member strokes use butt caps; below-grade stays dashed', () => {
    const members = [
      stud(1, 0),
      stud(3, 2),
      member({
        system: 'foundation',
        role: 'stemwall',
        size: undefined,
        material: 'concrete',
        dims: [4, 0.6, 0.2],
        position: [2, -0.45, 1],
      }),
    ]
    const sheets = buildPlanSet(members, [], {})
    for (const s of sheets) {
      expect(s.svg).not.toContain('stroke-linecap="round"')
    }
    const south = sheets.find((s) => s.title.startsWith('South elevation'))?.svg ?? ''
    expect(south).toContain('stroke-linecap="butt" stroke-dasharray="5 3"')
  })

  const wire = (id: string, dz: number): Member =>
    member({
      system: 'electrical',
      role: 'wire-run',
      size: undefined,
      material: 'copper',
      dims: [3, 0.013, 0.013],
      length: 3,
      position: [5, 0.5, 3 + dz],
      sourceId: id,
      label: `NM-B 14/2 w/G — ${id}`,
    })

  test('P4 gate: stacked circuit run labels de-collide as RECTS — pairwise separation ≥ label width', () => {
    // four circuits share the homerun spine → coincident anchors (the demo
    // printed LTG-3/LTG-4/GEN-3/GEN-4 at one coordinate as 'LTGGEN-3'; the
    // round-3 fixCheck: a 16px point nudge is narrower than a ~30px label)
    const ids = ['LTG-3', 'LTG-4', 'GEN-3', 'GEN-4']
    const members = ids.map((id, i) => wire(id, i * 0.001))
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Electrical'))?.svg ?? ''
    const labels = [
      ...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="8" font-weight="bold"[^>]*>([^<]+)<\/text>/g),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] as string }))
    // every circuit with a run ≥40px gets exactly ONE label
    expect(labels.map((l) => l.text).sort()).toEqual([...ids].sort())
    // no two label RECTS overlap: estimated width chars×6.5 @ 8px bold,
    // glyph box ~10px tall — separation must clear one axis
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i] as { x: number; y: number; text: string }
        const b = labels[j] as { x: number; y: number; text: string }
        const halfWidths = ((a.text.length + b.text.length) * 6.5) / 2
        const clearX = Math.abs(a.x - b.x) >= halfWidths
        const clearY = Math.abs(a.y - b.y) >= 10
        expect(clearX || clearY).toBe(true)
      }
    }
  })

  test('P4 gate: a bubble-parked anchor NUDGES the label clear — printed, never dropped or overprinted', () => {
    // round-3 fixCheck: bubble-skip silently dropped gabled GEN-2's label —
    // the circuit kept legend-color-only traceability
    const members = [wire('GEN-2', 0)]
    const fixtures = [fixture({ kind: 'receptacle', position: [5, 0.38, 3] })]
    const svg =
      buildPlanSet(members, fixtures, {}).find((s) => s.title.startsWith('Electrical'))?.svg ?? ''
    expect(svg).toContain('>GEN-2</text>')
    const label = /<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="8" font-weight="bold"/.exec(svg)
    const bubble = /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><circle r="7"/.exec(svg)
    expect(label).not.toBeNull()
    expect(bubble).not.toBeNull()
    // the label RECT (~32.5×10) clears the r=7 bubble on at least one axis
    const dx = Math.abs(Number(label?.[1]) - Number(bubble?.[1]))
    const dy = Math.abs(Number(label?.[2]) - Number(bubble?.[2]))
    expect(dx >= 32.5 / 2 + 7 || dy >= 5 + 7).toBe(true)
    // the circuit legend still carries the id for traceability
    expect(svg).toContain('GEN-2 —')
  })
})

describe('round-3 fixCheck — filled-rect cut poché + full flag list', () => {
  const stud = (x: number, z: number): Member =>
    member({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.04, 2.4, 0.09],
      position: [x, 1.2, z],
      rotation: [0, 0, 0],
    })

  test('N3 gate: an end-on CMU wall cut draws a FILLED rect — no more invisible zero-length butt caps', () => {
    // CMU courses run along X (pointing at the viewer): the old dark line
    // projected to a zero-length butt-capped segment → rsvg drew NO pixels
    const course = (y: number): Member =>
      member({
        system: 'wall-framing',
        role: 'block',
        size: undefined,
        material: 'concrete',
        dims: [4, 0.2, 0.2],
        position: [2, y, 1],
        rotation: [0, 0, 0],
      })
    const members = [
      course(0.1),
      course(0.3),
      stud(1.5, 3),
      // end-on frost footing below grade — the dash convention moves to the
      // rect OUTLINE, the fill stays dark
      member({
        system: 'foundation',
        role: 'footing',
        size: undefined,
        material: 'concrete',
        dims: [4, 0.3, 0.5],
        position: [2, -0.5, 1],
        rotation: [0, 0, 0],
      }),
    ]
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Section A-A'))?.svg ?? ''
    const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#222"/g)]
    // 2 courses + 1 footing, every one VISIBLE (≥1.5px both axes)
    expect(rects).toHaveLength(3)
    for (const r of rects) {
      expect(Number(r[3])).toBeGreaterThanOrEqual(1.5)
      expect(Number(r[4])).toBeGreaterThanOrEqual(1.5)
    }
    // below-grade cut keeps the dashed convention on the outline
    expect(svg).toMatch(/fill="#222" stroke="#222" stroke-width="0\.9" stroke-dasharray="5 3"/)
  })

  test('N3 gate: an OBLIQUE plate pochés only its plane∩OBB slice (≤0.7m), never the whole-member bar', () => {
    // plate 8m long, yawed 20° off the plane normal (the gabled p_roofR
    // case: ~1.9m whole-member black bar vs a true ~0.5m slice)
    const members = [
      member({
        system: 'wall-framing',
        role: 'top-plate',
        size: '2x6',
        dims: [8, 0.04, 0.14],
        position: [2, 2.4, 2],
        rotation: [0, 0.35, 0],
      }),
      // two studs 5m apart in view-x (world z) = the scale ruler
      stud(2, 0),
      stud(2, 5),
    ]
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Section A-A'))?.svg ?? ''
    // recover px/m from the two vertical stud lines (z=0 vs z=5)
    const vlines = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="#caa06a"/g)]
      .filter((m) => m[1] === m[3])
      .map((m) => Number(m[1]))
    expect(vlines).toHaveLength(2)
    const scale = Math.abs((vlines[0] as number) - (vlines[1] as number)) / 5
    const rect = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#222"/.exec(svg)
    expect(rect).not.toBeNull()
    const darkWidthM = Number(rect?.[3]) / scale
    expect(darkWidthM).toBeLessThanOrEqual(0.7)
    expect(darkWidthM).toBeGreaterThan(0) // …but it exists
    // the plate's full length still prints — as light beyond work, dark only
    // at the slice (whole-member plan extent here is ~2.7m of view width)
    expect(svg).toMatch(/stroke="#caa06a" stroke-width="[\d.]+" stroke-linecap="butt" opacity="0.6"/)
  })

  test('C5 gate: 7 flags ALL print on the schedules sheets — the reserve grows, nothing truncates', () => {
    const flags = [
      'ENGINEERED BEAM REQUIRED — exceeds prescriptive header span',
      'part of the plan has no roof members — check roof coverage',
      'connector too long — braided supply exceeds 0.6 m',
      'no floor slabs found — floor framing skipped',
      'panel working clearance intrudes into a rough opening (NEC 110.26)',
      'duplicate service point (water-heater) — extra node ignored',
      'DWV slope below 1/4 in/ft on the main drain (P3005.3)',
    ]
    const members = [member({ flag: flags[0] })]
    const sheets = buildPlanSet(members, [], { warnings: flags.slice(1) }).filter((s) =>
      s.title.startsWith('Schedules'),
    )
    expect(sheets.length).toBeGreaterThanOrEqual(1)
    const all = sheets.map((s) => s.svg).join('')
    for (const f of flags) expect(all).toContain(f)
    expect(all).not.toContain('more flags')
  })

  test('C5 gate: the characteristics block stacks ABOVE a 7-flag list — its anchor tracks the grown reserve', () => {
    const flags = [
      'flag one — alpha',
      'flag two — bravo',
      'flag three — charlie',
      'flag four — delta',
      'flag five — echo',
      'flag six — foxtrot',
      'flag seven — golf',
    ]
    const characteristics: BuildingCharacteristics = {
      floorAreaM2: 40,
      volumeM3: 108,
      envelopeAreaM2: 61.4,
      windowCount: 1,
      windowAreaM2: 1.8,
      doorCount: 1,
      insulation: { climateZone: '2A', wallR: 13, citation: '2021 IECC Table R402.1.3' },
      uaWPerK: 30.1,
      designHeatLossW: 662,
      coolingTonsEstimate: 0.9,
      notes: [],
    }
    const sheets = buildPlanSet([member({})], [], { warnings: flags, characteristics }).filter(
      (s) => s.title.startsWith('Schedules'),
    )
    const svg = sheets[sheets.length - 1]?.svg ?? ''
    for (const f of flags) expect(svg).toContain(f)
    const yOf = (needle: string): number => {
      const at = svg.indexOf(needle)
      const m = /y="([\d.]+)"/.exec(svg.slice(svg.lastIndexOf('<text', at), at))
      return m ? Number(m[1]) : Number.NaN
    }
    // block's lowest line sits above the TOPMOST flag (the 7th from the
    // bottom) — the old Math.min(…, 6) anchor would overprint flag one
    expect(yOf('2021 IECC Table R402.1.3')).toBeLessThan(yOf('flag one — alpha'))
    // and the takeoff row never runs under the grown reserve
    expect(yOf('2x10')).toBeLessThan(yOf('2021 IECC Table R402.1.3'))
  })
})

describe('round-3 carried cosmetics — P1 pagination balance, vertical centering, N2 datums, C4 rafter note', () => {
  const stud = (x: number, z: number): Member =>
    member({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.04, 2.4, 0.09],
      position: [x, 1.2, z],
      rotation: [0, 0, 0],
    })

  /** Small gabled house: studs + plates to 2.42, rafters, ridge at 4.4. */
  const house = (rafterSpacingM = 0.6096, rafterCount = 16): Member[] => {
    const members: Member[] = []
    for (let x = 0; x <= 10.01; x += 2) for (const z of [0, 8]) members.push(stud(x, z))
    members.push(member({ system: 'wall-framing', role: 'top-plate', dims: [10, 0.04, 0.09], position: [5, 2.42, 0] }))
    members.push(member({ system: 'wall-framing', role: 'top-plate', dims: [10, 0.04, 0.09], position: [5, 2.42, 8] }))
    for (let i = 0; i < rafterCount; i++) {
      members.push(
        member({
          system: 'roof-framing',
          role: 'rafter',
          dims: [4.6, 0.14, 0.04],
          position: [0.3 + i * rafterSpacingM, 3.4, 2],
          rotation: [0, Math.PI / 2, 0.42],
        }),
      )
    }
    members.push(member({ system: 'roof-framing', role: 'ridge', dims: [10, 0.19, 0.04], position: [5, 4.4, 4] }))
    return members
  }

  const characteristics: BuildingCharacteristics = {
    floorAreaM2: 40,
    volumeM3: 108,
    envelopeAreaM2: 61.4,
    windowCount: 1,
    windowAreaM2: 1.8,
    doorCount: 1,
    insulation: { climateZone: '2A', wallR: 13, citation: '2021 IECC Table R402.1.3' },
    uaWPerK: 30.1,
    designHeatLossW: 662,
    coolingTonsEstimate: 0.9,
    notes: [],
  }
  const flags = ['flag A — alpha', 'flag B — bravo', 'part of the roof — charlie']

  /** Deterministic takeoff generator (same triple-aggregation as the engine). */
  const manyMembers = (n: number): Member[] => {
    const systems = ['floor-framing', 'wall-framing', 'roof-framing'] as const
    const many: Member[] = []
    for (let i = 0; i < n; i++) {
      const len = 0.5 + (i % 80) * 0.09
      many.push(
        member({
          system: systems[i % 3],
          role: i % 2 === 0 ? 'joist' : 'stud',
          size: (['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '4x6', '4x8'] as const)[i % 8],
          length: len,
          dims: [len, 0.235, 0.038],
          position: [i * 0.1, 0, 1],
        }),
      )
    }
    return many
  }

  const takeoffLineCount = (svg: string): number =>
    [...svg.matchAll(/font-size="10" font-family="Helvetica, Arial, sans-serif" fill="#222"/g)].length

  test('P1 gate: the reserve consumes the SECOND column — a takeoff past the old both-columns-shrunk cap stays on ONE sheet', () => {
    // 68 takeoff lines + 3 flags + characteristics: the old cap was
    // 2×(41−10−1) = 60 → TWO ~half-empty sheets; the reworked cap is
    // 40 (full first column) + 30 (reserved second) = 70 → one sheet.
    const sheets = buildPlanSet(manyMembers(40), [], { characteristics, warnings: flags }).filter(
      (s) => s.title.startsWith('Schedules'),
    )
    expect(sheets).toHaveLength(1)
    const svg = sheets[0]?.svg ?? ''
    expect(takeoffLineCount(svg)).toBeGreaterThan(60) // pins: past the OLD cap
    // the blocks live in the second column (x = MARGIN + colW = 528)…
    expect(svg).toContain('<text x="528" y')
    expect(svg).toMatch(/<text x="528" [^>]*>BUILDING CHARACTERISTICS<\/text>/)
    for (const f of flags) expect(svg).toContain(f)
    // …and no second-column row runs under the characteristics block
    let maxCol1RowY = 0
    for (const m of svg.matchAll(/<text x="(\d+)" y="(\d+)" font-size="10" font-family="Helvetica, Arial, sans-serif" fill="#222"/g)) {
      if (Number(m[1]) >= 528) maxCol1RowY = Math.max(maxCol1RowY, Number(m[2]))
    }
    const charTop = Number(/<text x="528" y="(\d+)" font-size="10" font-weight="bold"/.exec(svg)?.[1])
    expect(Number.isFinite(charTop)).toBe(true)
    expect(maxCol1RowY).toBeLessThan(charTop)
  })

  test('P1 gate: no schedules page under 30% fill — pagination distributes evenly (no ~2/3-empty sheets)', () => {
    const sheets = buildPlanSet(manyMembers(400), [], { characteristics, warnings: flags }).filter(
      (s) => s.title.startsWith('Schedules'),
    )
    expect(sheets.length).toBeGreaterThan(1)
    // perSheetLines = 2×(41−1) = 80; the <30% fill signature never ships
    for (const s of sheets) {
      expect(takeoffLineCount(s.svg)).toBeGreaterThanOrEqual(0.3 * 80)
    }
  })

  test('vertical centering gate: the elevation band centers in the free field, not parked in the upper half', () => {
    const south =
      buildPlanSet(house(), [], {}).find((s) => s.title.startsWith('South elevation'))?.svg ?? ''
    const STROKES = ['#8b8f96', '#caa06a', '#b98d55', '#a97e48', '#c2803d', '#6f8fa8', '#8fa8a0']
    const ys: number[] = []
    for (const m of south.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="(#[0-9a-f]{6})"/g)) {
      if (STROKES.includes(m[5] as string)) ys.push(Number(m[2]), Number(m[4]))
    }
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    // free field: top margin 48 → title-block top minus breathing = 720;
    // the band's gaps balance (the old oy centered in a 614px reserve and
    // parked the drawing high — round-3 P1 'band in the upper half')
    const gapTop = top - 48
    const gapBottom = 720 - bottom
    expect(Math.abs(gapTop - gapBottom)).toBeLessThanOrEqual(8)
    expect((top + bottom) / 2).toBeGreaterThan(370) // never top-parked at ~355
  })

  test('N2 gate: right-edge datum tags with leader ticks — GRADE 0.00m, T.O. PLATE, RIDGE at the segs’ y extents', () => {
    const south =
      buildPlanSet(house(), [], {}).find((s) => s.title.startsWith('South elevation'))?.svg ?? ''
    expect(south).toContain('>GRADE 0.00m</text>')
    expect(south).toContain('>T.O. PLATE +2.42m</text>')
    expect(south).toContain('>RIDGE +4.40m</text>')
    // three leader ticks at the field's right edge (x = 764)
    expect([...south.matchAll(/<line x1="764" /g)]).toHaveLength(3)
    // stacked in elevation order on screen: ridge above plate above grade
    const yOf = (label: string): number => {
      const at = south.indexOf(label)
      const m = /y="([\d.]+)"/.exec(south.slice(south.lastIndexOf('<text', at), at))
      return m ? Number(m[1]) : Number.NaN
    }
    expect(yOf('RIDGE +4.40m')).toBeLessThan(yOf('T.O. PLATE +2.42m'))
    expect(yOf('T.O. PLATE +2.42m')).toBeLessThan(yOf('GRADE 0.00m'))
    // every elevation carries the datums
    for (const dir of ['North', 'East', 'West']) {
      const sheet = buildPlanSet(house(), [], {}).find((s) => s.title.startsWith(`${dir} elevation`))
      expect(sheet?.svg).toContain('>GRADE 0.00m</text>')
      expect(sheet?.svg).toContain('T.O. PLATE +2.42m')
    }
  })

  test('N2 gate: degenerate datums skip — walls-only has no RIDGE, no wall framing has no T.O. PLATE', () => {
    // walls only: member top == wall top → RIDGE would duplicate the plate
    const wallsOnly = [stud(0, 0), stud(2, 0), stud(4, 0)]
    const southWalls =
      buildPlanSet(wallsOnly, [], {}).find((s) => s.title.startsWith('South elevation'))?.svg ?? ''
    expect(southWalls).toContain('>GRADE 0.00m</text>')
    expect(southWalls).toContain('T.O. PLATE +2.40m')
    expect(southWalls).not.toContain('RIDGE')
    // floor framing only (below grade): no wall segs → no plate tag; nothing
    // above grade → no ridge tag; grade still prints
    const southFloor =
      buildPlanSet([member({})], [], {}).find((s) => s.title.startsWith('South elevation'))?.svg ??
      ''
    expect(southFloor).toContain('>GRADE 0.00m</text>')
    expect(southFloor).not.toContain('T.O. PLATE')
    expect(southFloor).not.toContain('RIDGE')
  })

  test('C4 gate: RAFTERS @ 24" O.C. prints on the roof plan legend when the dominant gap derives it', () => {
    const roof =
      buildPlanSet(house(0.6096), [], {}).find((s) => s.title === 'Roof framing plan')?.svg ?? ''
    expect(roof).toContain('RAFTERS @ 24&quot; O.C.')
    expect(roof).not.toContain('VERIFY')
    // 16" o.c. layout derives 16
    const roof16 =
      buildPlanSet(house(0.4064), [], {}).find((s) => s.title === 'Roof framing plan')?.svg ?? ''
    expect(roof16).toContain('RAFTERS @ 16&quot; O.C.')
    expect(roof16).not.toContain('VERIFY')
  })

  test('C4 gate: irregular rafter gaps fall back to the spec stud spacing with VERIFY; no rafters → no note', () => {
    const base = house(0.6096, 0).filter((m) => m.role !== 'rafter')
    const irregular = [...base]
    for (const off of [0.3, 0.9, 1.3, 2.4, 2.9]) {
      irregular.push(
        member({
          system: 'roof-framing',
          role: 'rafter',
          dims: [4.6, 0.14, 0.04],
          position: [off, 3.4, 2],
          rotation: [0, Math.PI / 2, 0.42],
        }),
      )
    }
    const roof =
      buildPlanSet(irregular, [], { studSpacingIn: 16 }).find((s) => s.title === 'Roof framing plan')
        ?.svg ?? ''
    expect(roof).toContain('RAFTERS @ 16&quot; O.C. — VERIFY')
    // spec spacing follows the option
    const roof24 =
      buildPlanSet(irregular, [], { studSpacingIn: 24 }).find((s) => s.title === 'Roof framing plan')
        ?.svg ?? ''
    expect(roof24).toContain('RAFTERS @ 24&quot; O.C. — VERIFY')
    // ridge only, no rafters → no note at all
    const noRafters =
      buildPlanSet(base, [], {}).find((s) => s.title === 'Roof framing plan')?.svg ?? ''
    expect(noRafters).not.toContain('RAFTERS')
  })
})

describe('elevation orientation + section membership (blueprint round-2)', () => {
  test('east elevation puts north (−z) on screen-right; west mirrors it', () => {
    // two studs on an east wall: zNear=1, zFar=7 — standing EAST, the z=7
    // (south) stud must print LEFT of the z=1 stud
    const members = [
      member({ system: 'wall-framing', role: 'stud', dims: [0.04, 2.4, 0.09], position: [8, 1.2, 1], rotation: [0, 0, 0] }),
      member({ system: 'wall-framing', role: 'stud', dims: [0.04, 2.4, 0.09], position: [8, 1.2, 7], rotation: [0, 0, 0] }),
    ]
    const sheets = buildPlanSet(members, [], {})
    const east = sheets.find((s) => s.title.startsWith('East elevation'))
    const xs = [...(east?.svg.matchAll(/<line x1="([\d.]+)"/g) ?? [])].map((m2) => Number(m2[1]))
    expect(xs.length).toBeGreaterThanOrEqual(2)
    // both studs are vertical lines; the SECOND member (z=7) must be left
    expect(xs[1]).toBeLessThan(xs[0] as number)
  })

  test('section includes walls whose extent crosses the cut band', () => {
    // long wall plate centered away from the cut midpoint but crossing it
    const members = [
      member({ system: 'wall-framing', role: 'bottom-plate', dims: [10, 0.04, 0.09], position: [5, 0.02, 0], rotation: [0, 0, 0] }),
      member({ system: 'wall-framing', role: 'stud', dims: [0.04, 2.4, 0.09], position: [0.2, 1.2, 4], rotation: [0, 0, 0] }),
    ]
    const sheets = buildPlanSet(members, [], {})
    const section = sheets.find((s) => s.title.startsWith('Section A-A'))
    // the plate's extent crosses cutX=~2.6 even though its center (5,0) is
    // outside the band — it must be drawn (>=1 line beyond the grade line)
    const lines = [...(section?.svg.matchAll(/<line /g) ?? [])]
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })
})

describe('examiner round-5 — floor sheet legibility + legend box geometry', () => {
  test('subfloor deck prints FIRST and translucent — joists stay legible on top', () => {
    // Long-first ordering alone painted the deck LAST (bay width is the
    // smallest dims[0] on the sheet): 23 opaque rects over every joist,
    // girder and stair header — the floor sheet was washed out.
    const members = [
      member({ role: 'joist', size: '2x10', dims: [4, 0.235, 0.038] }),
      member({
        role: 'subfloor',
        size: undefined,
        material: 'engineered',
        dims: [0.41, 0.019, 4],
        length: 4,
        position: [2, -0.1, 1],
        label: 'Subfloor 3/4" T&G — glued + ring-shank fastened (R503.2.3)',
      }),
    ]
    const svg =
      buildPlanSet(members, [], {
        projectName: 'p',
        levelName: 'l',
        jurisdiction: 'FL',
        date: 'd',
      }).find((s) => s.title === 'Floor framing plan')?.svg ?? ''
    const deckIdx = svg.indexOf('fill-opacity="0.35"')
    const joistIdx = svg.indexOf('stroke="#444" stroke-width="0.6"')
    expect(deckIdx).toBeGreaterThan(-1)
    expect(joistIdx).toBeGreaterThan(-1)
    expect(deckIdx).toBeLessThan(joistIdx) // deck is the UNDER-layer
  })

  test('legend backing rect covers the second circuit column, no double-counted height', () => {
    // 26 circuits wrap into a second column at x = MARGIN + 230; the old
    // hard-coded 250px rect left that column on bare linework, and the
    // height counted every wrapped row a second time.
    const members = Array.from({ length: 26 }, (_, i) =>
      member({
        system: 'electrical',
        role: 'wire-run',
        size: undefined,
        material: 'copper',
        dims: [2, 0.013, 0.013],
        sourceId: `SA-${i + 1}`,
        position: [1 + 0.1 * i, 0.3, 0],
      }),
    )
    const fixtures = [fixture({ meta: { circuit: 'SA-1', breakerA: 20, gaugeAwg: 12 } })]
    const svg =
      buildPlanSet(members, fixtures, {
        projectName: 'p',
        levelName: 'l',
        jurisdiction: 'FL',
        date: 'd',
      }).find((s) => s.title === 'Electrical rough-in plan')?.svg ?? ''
    const rect =
      /<rect x="[\d.-]+" y="[\d.-]+" width="(\d+)" height="(\d+)" fill="#ffffff" fill-opacity="0.92"/.exec(
        svg,
      )
    expect(rect).not.toBeNull()
    expect(Number(rect?.[1])).toBe(2 * 230 + 24) // widened for column 2
    // height covers col-1's rows (pre-circuit lines + 22 circuit rows) but
    // NOT the naive all-lines count that over-shot the box (pre + 26)
    const h = Number(rect?.[2])
    expect(h).toBeGreaterThanOrEqual((0 + 22) * 14 + 14)
    expect(h).toBeLessThan((4 + 22) * 14 + 14)
  })
})

describe('B17 — foundation sheet: slab field is the translucent UNDER-layer', () => {
  const foundationMembers = () => [
    member({
      system: 'foundation',
      role: 'footing',
      size: undefined,
      material: 'concrete',
      dims: [6, 0.2, 0.4],
      position: [3, -0.2, 0],
      label: 'Footing 16"×8"',
    }),
    member({
      system: 'foundation',
      role: 'stemwall',
      size: undefined,
      material: 'concrete',
      dims: [6, 0.1, 0.2],
      position: [3, -0.05, 0],
      label: 'Stemwall 8"',
    }),
    member({
      system: 'foundation',
      role: 'anchor-bolt',
      size: undefined,
      material: 'steel',
      dims: [0.016, 0.254, 0.016],
      position: [1, -0.05, 0],
      label: '5/8" anchor bolt',
    }),
    member({
      system: 'foundation',
      role: 'slab',
      size: undefined,
      material: 'concrete',
      dims: [5.8, 0.0889, 1.1],
      position: [3, -0.044, 1],
      label: 'Slab-on-grade 3-1/2" (R506.1)',
    }),
    member({
      system: 'foundation',
      role: 'vapor-retarder',
      size: undefined,
      material: 'pvc',
      dims: [5.8, 0.00015, 1.1],
      position: [3, -0.089, 1],
      label: '6-mil vapor retarder under slab (R506.2.3)',
    }),
  ]
  const sheet = () =>
    buildPlanSet(foundationMembers(), [], {
      projectName: 'p',
      levelName: 'l',
      jurisdiction: 'FL',
      date: 'd',
    }).find((s) => s.title === 'Foundation plan')?.svg ?? ''

  test('the slab strip prints FIRST and translucent — footing/stemwall linework stays on top', () => {
    const svg = sheet()
    const slabIdx = svg.indexOf('fill-opacity="0.35"')
    // the mitered footing/stemwall runs are stroke paths…
    const strokeIdx = svg.indexOf('stroke-linejoin="miter"')
    // …and the bolt prints as a filled hardware dot
    const boltIdx = svg.indexOf('<circle')
    expect(slabIdx).toBeGreaterThan(-1)
    expect(strokeIdx).toBeGreaterThan(-1)
    expect(boltIdx).toBeGreaterThan(-1)
    expect(slabIdx).toBeLessThan(strokeIdx) // slab is the UNDER-layer (deck pattern)
    expect(slabIdx).toBeLessThan(boltIdx)
  })

  test('the vapor retarder never overprints the slab — it rides the legend instead', () => {
    const svg = sheet()
    // exactly ONE translucent field rect (the membrane is coincident under
    // the slab; drawing both would double the opacity to no information)
    expect([...svg.matchAll(/fill-opacity="0\.35"/g)]).toHaveLength(1)
    expect(svg).toContain('slab-on-grade, drawn translucent')
    expect(svg).toContain('base course')
    expect(svg).toContain('vapor retarder under slab (R506.2.3)')
  })
})

describe('B17 round 2 — plate-like members stroke at their TRUE thickness on side views', () => {
  // Examiner round-1 FAIL: slab strips parallel to the section cut printed
  // as dashed bands stroke-width = PLAN width (up to 1.20 m at 1:75, ~13×
  // the 3-1/2" pour), straddling grade into the stud bottoms, with the
  // coincident vapor retarder printing an identical twin band 2.3 px lower;
  // same ribbons on all four elevations + the cover iso. Root: memberAxis
  // took the second-largest dim — right for sticks, wrong for plate-like
  // horizontals whose vertical dim is the smallest.
  const PPM = 96 / 0.0254
  const SLAB_T = 0.0889
  const parallelStrip = () =>
    member({
      system: 'foundation',
      role: 'slab',
      size: undefined,
      material: 'concrete',
      dims: [1.1, SLAB_T, 5.8], // long axis along Z — parallel to the cut plane
      position: [3, -SLAB_T / 2, 2.5],
      label: 'Slab-on-grade 3-1/2" (R506.1)',
    })
  const crossingStrip = () =>
    member({
      system: 'foundation',
      role: 'slab',
      size: undefined,
      material: 'concrete',
      dims: [5.8, SLAB_T, 1.1], // long axis along X — CROSSES the cut plane
      position: [3, -SLAB_T / 2, 1],
      label: 'Slab-on-grade 3-1/2" (R506.1)',
    })
  const membrane = () =>
    member({
      system: 'foundation',
      role: 'vapor-retarder',
      size: undefined,
      material: 'pvc',
      dims: [5.8, 0.00015, 1.1],
      position: [3, -SLAB_T - 0.000075, 1],
      label: '6-mil vapor retarder under slab (R506.2.3)',
    })
  const sheets = () =>
    buildPlanSet([parallelStrip(), crossingStrip(), membrane()], [], {
      projectName: 'p',
      levelName: 'l',
      jurisdiction: 'FL',
      date: 'd',
    })
  const ratioOf = (svg: string): number => Number(/scale 1:(\d+)/.exec(svg)?.[1] ?? 0)
  const foundationStrokes = (svg: string): number[] =>
    [...svg.matchAll(/stroke="#8b8f96" stroke-width="([\d.]+)"/g)].map((m2) => Number(m2[1]))

  test('section: a slab strip PARALLEL to the cut strokes at 0.0889 m × scale, not its plan width', () => {
    const svg = sheets().find((s) => s.title.startsWith('Section'))?.svg ?? ''
    const ratio = ratioOf(svg)
    expect(ratio).toBeGreaterThan(0)
    const scale = PPM / ratio
    const expected = Number(Math.max(0.7, SLAB_T * scale).toFixed(1))
    const strokes = foundationStrokes(svg)
    expect(strokes.length).toBeGreaterThan(0)
    // every foundation LINE is either the true 3-1/2" band or the clamped
    // membrane hairline — the old plan-width class (≥ 1.1 m × scale) is dead
    for (const w of strokes) {
      expect([expected, 0.7]).toContain(w)
      expect(w).toBeLessThan(1.1 * scale - 1)
    }
    expect(strokes).toContain(expected) // non-vacuous: the thin band prints
  })

  test('section: the CROSSING strip still cuts as a dark rect — true width × true 3-1/2" height (unchanged)', () => {
    const svg = sheets().find((s) => s.title.startsWith('Section'))?.svg ?? ''
    const scale = PPM / ratioOf(svg)
    const rects = [...svg.matchAll(/<rect x="[\d.-]+" y="[\d.-]+" width="([\d.]+)" height="([\d.]+)" fill="#222"/g)]
    expect(rects.length).toBeGreaterThanOrEqual(1)
    const slabRect = rects.find(
      (r) => Math.abs(Number(r[1]) - 1.1 * scale) < 2 && Math.abs(Number(r[2]) - SLAB_T * scale) < 2,
    )
    expect(slabRect).toBeDefined()
  })

  test('elevations + cover iso: no ribbon bands — every foundation stroke ≤ the true thickness', () => {
    const all = sheets()
    for (const title of ['South elevation', 'East elevation']) {
      const svg = all.find((s) => s.title.startsWith(title))?.svg ?? ''
      const ratio = ratioOf(svg)
      expect(ratio).toBeGreaterThan(0)
      const scale = PPM / ratio
      const strokes = foundationStrokes(svg)
      expect(strokes.length).toBeGreaterThan(0) // non-vacuous
      for (const w of strokes) expect(w).toBeLessThanOrEqual(SLAB_T * scale + 0.1)
    }
    // The cover iso prints no scale ratio — pin it on the FIXTURE: the old
    // plan-width class drew these strips as ≥ 20 px gray ribbons (examiner
    // measured 45.2/25.0/20.5 px); the true 3-1/2" thickness lands well
    // under 10 px at any ratio the 5.8 m fixture can fit at.
    const coverSvg = all.find((s) => s.title === 'Cover')?.svg ?? ''
    const strokes = foundationStrokes(coverSvg)
    expect(strokes.length).toBeGreaterThan(0)
    for (const w of strokes) expect(w).toBeLessThan(10)
    // the membrane is the deliberate 0.7 px min-clamp hairline (stated in
    // memberSegs): visually distinct from the pour, never a twin band
    expect(strokes).toContain(0.7)
  })
})

describe('round-6 — flags print VERBATIM (no ellipsis), cross-level lift is a DELTA', () => {
  test('a 297-char composed flag and the S10 span flag print whole; no … anywhere', () => {
    const flags = [
      'ENGINEERED BEAM REQUIRED — exceeds prescriptive header span | header 4x12 does not fit between the RO and the plates (1.5" of 11.3") — RO head lowered 5.2cm — raise the wall, lower the opening, or use an engineered flat header | RO shifted 153.3cm to fit the framed run — verify the drawn position',
      'flat roof joists 2x8 @ 16" o.c. span 10.7 m exceeds the R802.4.1 allowable 4.1 m — purlin + 2x4 struts to bearing or engineered member required (R802.5.1)',
    ]
    const sheets = buildPlanSet([member({})], [], {
      projectName: 'p',
      levelName: 'l',
      jurisdiction: 'FL',
      date: 'd',
      warnings: flags,
    })
    const svg = sheets.find((s) => s.title.startsWith('Schedules'))?.svg ?? ''
    // wrapRow cuts at spaces — single tokens survive wrapping intact, so
    // the previously-ellipsized TAILS are the assertion targets
    expect(svg).toContain('153.3cm') // third composed component (was silently dropped)
    expect(svg).toContain('drawn')
    expect(svg).toContain('(R802.5.1)') // S10 remedy cite (was ellipsized)
    expect(svg).not.toContain('…')
  })

  test('relativeLevelBaseY: lifts are deltas from the OWNER level', () => {
    const levels = [
      { id: 'lvl0', baseY: 0 },
      { id: 'lvl1', baseY: 2.7 },
      { id: 'lvlroof', baseY: 5.4 },
    ]
    // upper-storey owner: its own lift is 0, the roof sits ONE storey up
    expect(relativeLevelBaseY(levels, 'lvl1')).toEqual({ lvl0: -2.7, lvl1: 0, lvlroof: 2.7 })
    // ground owner: identity (absolute == relative)
    expect(relativeLevelBaseY(levels, 'lvl0')).toEqual({ lvl0: 0, lvl1: 2.7, lvlroof: 5.4 })
    // unknown owner falls back to absolute (no shift)
    expect(relativeLevelBaseY(levels, null)).toEqual({ lvl0: 0, lvl1: 2.7, lvlroof: 5.4 })
  })

  test('size-less roles get legend rows — the deck and hangers are named', () => {
    const members = [
      member({ role: 'joist', size: '2x10', dims: [4, 0.235, 0.038] }),
      member({
        role: 'subfloor',
        size: undefined,
        material: 'engineered',
        dims: [0.41, 0.019, 4],
        length: 4,
        position: [2, -0.1, 1],
      }),
      member({
        role: 'hanger',
        size: undefined,
        material: 'steel',
        dims: [0.05, 0.15, 0.05],
        length: 0.05,
        position: [1, -0.2, 0],
      }),
    ]
    const svg =
      buildPlanSet(members, [], {
        projectName: 'p',
        levelName: 'l',
        jurisdiction: 'FL',
        date: 'd',
      }).find((s) => s.title === 'Floor framing plan')?.svg ?? ''
    expect(svg).toContain('T&amp;G deck (drawn translucent)')
    expect(svg).toContain('joist hanger')
  })
})

describe('wave-2 paper honesty — flag pagination, derived bolt legend, LOD stamp', () => {
  test('a 50-flag set spills to "Flags (continued)" sheets — nothing invisible, nothing negative-y', () => {
    const flags = Array.from(
      { length: 50 },
      (_, i) => `synthetic warning number ${i} — some remedy text citing R000.${i} for realism`,
    )
    const sheets = buildPlanSet([member({})], [], {
      projectName: 'p',
      levelName: 'l',
      jurisdiction: 'FL',
      date: 'd',
      warnings: flags,
    })
    const sched = sheets.filter((s) => s.title.startsWith('Schedules'))
    const cont = sheets.filter((s) => s.title.startsWith('Flags (continued'))
    expect(cont.length).toBeGreaterThan(0)
    const schedSvg = sched.map((s) => s.svg).join('')
    expect(schedSvg).toMatch(/\+ \d+ more flag/) // pointer line on the schedules sheet
    // no text element above the top margin (the old bottom-anchored growth
    // went negative-y and printed silently invisible flags)
    for (const s of [...sched, ...cont]) {
      for (const m of s.svg.matchAll(/<text[^>]* y="(-?[\d.]+)"/g)) {
        expect(Number(m[1])).toBeGreaterThan(0)
      }
    }
    // EVERY flag prints somewhere across the set
    const all = sheets.map((s) => s.svg).join('')
    for (const fl of flags) expect(all).toContain(`R000.${flags.indexOf(fl)}`)
  })

  test('foundation legend derives bolt diameter + spacing from members', () => {
    const bolt = (x: number): Member =>
      member({
        system: 'foundation',
        role: 'anchor-bolt',
        size: undefined,
        material: 'steel',
        dims: [0.016, 0.25, 0.016],
        length: 0.25,
        position: [x, -0.1, 0],
        label: '5/8" anchor bolt',
        sourceId: 'wall_a',
      })
    const svg =
      buildPlanSet([bolt(0.3), bolt(0.3 + feet(6)), bolt(0.3 + 2 * feet(6))], [], {
        projectName: 'p',
        levelName: 'l',
        jurisdiction: 'FL',
        date: 'd',
      }).find((s) => s.title === 'Foundation plan')?.svg ?? ''
    expect(svg).toContain('5/8')
    expect(svg).toContain('o.c. max — 3 pcs')
    expect(svg).not.toContain('1/2&quot; anchor bolts') // the old hardcoded text
  })

  test('the title-block stamp says what was composed, not always LOD 400', () => {
    const opts = { projectName: 'p', levelName: 'l', jurisdiction: 'FL', date: 'd' }
    const s200 = buildPlanSet([member({})], [], { ...opts, detail: '200' as const })
    expect(s200.every((s) => s.svg.includes('LOD 200'))).toBe(true)
    expect(s200.some((s) => s.svg.includes('LOD 400'))).toBe(false)
    const sDefault = buildPlanSet([member({})], [], opts)
    expect(sDefault.every((s) => s.svg.includes('LOD 400'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Examiner round 3 (P1/P2): the sleeve story must reach PAPER, and the
// sewer marker must respect the sheet edge and the device bubbles. These
// gates compose REAL engine scenes (frost spec — the sleeves exist).
// ---------------------------------------------------------------------------

describe('sleeve crossings + sewer marker on composed scenes (examiner round 3)', () => {
  const xwall = (id: string, s: [number, number], e: [number, number]): WallSlice => {
    const dx = e[0] - s[0]
    const dz = e[1] - s[1]
    const length = Math.hypot(dx, dz)
    return {
      id,
      start: s,
      end: e,
      length,
      dir: [dx / length, dz / length],
      thickness: 0.114,
      height: 2.5,
      exterior: true,
      openings: [],
      curved: false,
    }
  }
  const room = (
    id: string,
    category: RoomSlice['category'],
    polygon: [number, number][],
    boundaryWallIds: string[],
  ): RoomSlice => ({ id, name: category, category, polygon, boundaryWallIds, ceilingHeight: 2.5 })
  const slab = (polygon: [number, number][]): SlabSlice => ({
    id: 'slab_paper',
    polygon,
    holes: [],
    elevation: 0.05,
    thickness: 0.05,
  })
  const specFrost = { ...DEFAULT_SPEC, detail: '400' as const, footingDepth: inches(60) }
  const TICK = /M-2\.5 -6 L-2\.5 6 M2\.5 -6 L2\.5 6/g

  test('P1: corner powder room — the w_w crossing prints tick + cite', () => {
    const shell = [
      xwall('w_s', [0, 0], [10, 0]),
      xwall('w_e', [10, 0], [10, 8]),
      xwall('w_n', [10, 8], [0, 8]),
      xwall('w_w', [0, 8], [0, 0]),
    ]
    const powder = [room('r_pow', 'bathroom', [[0, 0], [1, 0], [1, 2], [0, 2]], ['w_s'])]
    const p = layoutPlumbing(shell, powder, specFrost, [], {
      sewerExit: { position: [-0.8, 0, 0.9] },
    })
    const f = buildFoundation(shell, [slab([[0, 0], [10, 0], [10, 8], [0, 8]])], specFrost)
    const mep = buildPlanSet([...p.members, ...f], p.fixtures, {}).find((s) =>
      s.title.startsWith('Plumbing'),
    )
    const svg = mep?.svg ?? ''
    // exactly ONE sleeved crossing exists in this scene (main X-leg × w_w)
    expect((svg.match(TICK) ?? []).length).toBe(1)
    expect((svg.match(/SLEEVE \(P2603\.4\)/g) ?? []).length).toBeGreaterThanOrEqual(1)
  })

  const courtyardCompose = () => {
    const uWalls = [
      xwall('u_s', [0, 0], [12, 0]),
      xwall('u_e', [12, 0], [12, 8]),
      xwall('u_n', [12, 8], [0, 8]),
      xwall('u_w', [0, 8], [0, 0]),
      xwall('u_c1', [5, 2], [5, 6]),
      xwall('u_c2', [7, 2], [7, 6]),
    ]
    const uRooms = [
      room('r_ubath', 'bathroom', [[8, 2], [11, 2], [11, 6], [8, 6]], ['u_e']),
      room('r_ukitchen', 'kitchen', [[1, 2], [4, 2], [4, 6], [1, 6]], ['u_w']),
    ]
    const p = layoutPlumbing(uWalls, uRooms, specFrost)
    const f = buildFoundation(uWalls, [slab([[0, 0], [12, 0], [12, 8], [0, 8]])], specFrost)
    const mep = buildPlanSet([...p.members, ...f], p.fixtures, {}).find((s) =>
      s.title.startsWith('Plumbing'),
    )
    return mep?.svg ?? ''
  }

  test('P1: courtyard — BOTH courtyard stemwall crossings marked (+ the exit one)', () => {
    const svg = courtyardCompose()
    // kitchen branch × u_c1 + × u_c2, main × u_e
    expect((svg.match(TICK) ?? []).length).toBe(3)
    expect((svg.match(/SLEEVE \(P2603\.4\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  test('P2: east exit — sewer text fully inside the viewBox, glyph clear of bubbles', () => {
    const svg = courtyardCompose()
    const txt = svg.match(
      /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>SEWER\/SEPTIC/,
    )
    expect(txt).not.toBeNull()
    const tx = Number(txt?.[1])
    const anchor = txt?.[3]
    const wTxt = 'SEWER/SEPTIC (P3005.4)'.length * 6
    const left = anchor === 'start' ? tx : anchor === 'end' ? tx - wTxt : tx - wTxt / 2
    // the pre-fix marker anchored 'start' at ~1015 and ran ~40 px off the
    // 1056 viewBox — the text must now fit with margin on both sides
    expect(left).toBeGreaterThan(48)
    expect(left + wTxt).toBeLessThan(1056 - 48)
    // and the glyph keeps the arrows' bubble clearance
    const glyph = svg.match(
      /M-5 -4 L6 0 L-5 4 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/,
    )
    expect(glyph).not.toBeNull()
    const gx = Number(glyph?.[1])
    const gy = Number(glyph?.[2])
    const bubbles = [...svg.matchAll(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><circle r="7"/g)]
    expect(bubbles.length).toBeGreaterThan(0)
    for (const b of bubbles) {
      expect(Math.hypot(Number(b[1]) - gx, Number(b[2]) - gy)).toBeGreaterThanOrEqual(12)
    }
  })
})

// ---------------------------------------------------------------------------
// Post-merge seam round: the glyph layer (sleeve ticks, flow arrows, sewer
// marker) must de-collide against PIPE RECTS as well as bubbles. Confirmed
// seams: a sleeve tick printed ACROSS the F1 line-set pair rails (both
// features share the wall centerline ±2.5 px); the marker's last-resort
// cite lay ALONG the pipe corridor erasing the main + both rails; ticks
// struck through cleanout bubbles that sit at the crossing by construction.
// ---------------------------------------------------------------------------

describe('glyph layer vs pipe rects (post-merge seam round)', () => {
  const swall = (id: string, s: [number, number], e: [number, number], ext = true): WallSlice => {
    const dx = e[0] - s[0]
    const dz = e[1] - s[1]
    const length = Math.hypot(dx, dz)
    return {
      id,
      start: s,
      end: e,
      length,
      dir: [dx / length, dz / length],
      thickness: 0.114,
      height: 2.5,
      exterior: ext,
      openings: [],
      curved: false,
    }
  }
  const sroom = (
    id: string,
    category: RoomSlice['category'],
    polygon: [number, number][],
    boundaryWallIds: string[],
  ): RoomSlice => ({ id, name: category, category, polygon, boundaryWallIds, ceilingHeight: 2.5 })
  const sslab = (polygon: [number, number][]): SlabSlice => ({
    id: 'slab_seam',
    polygon,
    holes: [],
    elevation: 0.05,
    thickness: 0.05,
  })
  const specFrost = { ...DEFAULT_SPEC, detail: '400' as const, footingDepth: inches(60) }
  const PIPE_FILLS = ['#8fb0c4', '#4a7dbf', '#c0504d', '#35b8c9', '#d98134']
  type SvgRect = { w: number; h: number; fill: string; x: number; y: number; rot: number }
  const svgRects = (svg: string, fills: string[]): SvgRect[] =>
    [...svg.matchAll(
      /<rect x="[^"]*" y="[^"]*" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9a-f]{6})"[^/]*translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+)\)/g,
    )]
      .filter((m) => fills.includes(m[3] as string))
      .map((m) => ({
        w: Number(m[1]),
        h: Number(m[2]),
        fill: m[3] as string,
        x: Number(m[4]),
        y: Number(m[5]),
        rot: Number(m[6]),
      }))
  /** Distance from a point to a drawn rect's boundary (0 inside). */
  const rectDist = (px: number, py: number, r: SvgRect): number => {
    const a = (-r.rot * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const dx = px - r.x
    const dy = py - r.y
    const lx = Math.abs(dx * c + dy * s) - r.w / 2
    const ly = Math.abs(-dx * s + dy * c) - r.h / 2
    return lx <= 0 && ly <= 0 ? 0 : Math.hypot(Math.max(lx, 0), Math.max(ly, 0))
  }
  /** Axis-aligned text rect vs a drawn rect — 2D SAT. */
  const textHits = (cx: number, cy: number, hw: number, hh: number, r: SvgRect): boolean => {
    const a = (-r.rot * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const dx = r.x - cx
    const dy = r.y - cy
    const rhl = r.w / 2
    const rhw = r.h / 2
    if (Math.abs(dx) > hw + Math.abs(c) * rhl + Math.abs(s) * rhw) return false
    if (Math.abs(dy) > hh + Math.abs(s) * rhl + Math.abs(c) * rhw) return false
    if (Math.abs(dx * c + dy * s) > rhl + Math.abs(c) * hw + Math.abs(s) * hh) return false
    if (Math.abs(-dx * s + dy * c) > rhw + Math.abs(s) * hw + Math.abs(c) * hh) return false
    return true
  }
  const parseBubbles = (svg: string): [number, number][] =>
    [...svg.matchAll(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><circle r="7"/g)].map(
      (m) => [Number(m[1]), Number(m[2])],
    )
  const parseTicks = (svg: string): { x: number; y: number; rot: number }[] =>
    [...svg.matchAll(
      /M-2\.5 -6 L-2\.5 6 M2\.5 -6 L2\.5 6" stroke="#41637a"[^/]*translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+)\)/g,
    )].map((m) => ({ x: Number(m[1]), y: Number(m[2]), rot: Number(m[3]) }))
  /** The tick's 4 bar-tip endpoints (bars at ±2.5 along, spanning ±6). */
  const tickTips = (t: { x: number; y: number; rot: number }): [number, number][] => {
    const a = (t.rot * Math.PI) / 180
    const ax = Math.cos(a)
    const ay = Math.sin(a)
    const tips: [number, number][] = []
    for (const s1 of [-1, 1]) {
      for (const s2 of [-1, 1]) {
        tips.push([t.x + s1 * 2.5 * ax - s2 * 6 * ay, t.y + s1 * 2.5 * ay + s2 * 6 * ax])
      }
    }
    return tips
  }
  /** Round-2 tick invariants on every tick of a compose: bar tips >= 4 px
   * from foreign-class pipe rects AND the bar span intersects a pipe of
   * its OWN class (dwv slate) — a sleeve tick must tick ITS pipe. */
  const assertTickInvariants = (svg: string): void => {
    const ticks = parseTicks(svg)
    expect(ticks.length).toBeGreaterThan(0)
    const foreign = svgRects(svg, ['#35b8c9', '#d98134', '#4a7dbf', '#c0504d', '#b5aa97'])
    const own = svgRects(svg, ['#8fb0c4'])
    const bubbles = parseBubbles(svg)
    for (const t of ticks) {
      for (const r of foreign) {
        for (const [qx, qy] of tickTips(t)) {
          expect(rectDist(qx, qy, r)).toBeGreaterThanOrEqual(4)
        }
      }
      for (const [bx, by] of bubbles) {
        expect(Math.hypot(bx - t.x, by - t.y)).toBeGreaterThanOrEqual(12)
      }
      const a = (t.rot * Math.PI) / 180
      const crossesOwn = own.some((r) => {
        const a2 = (-r.rot * Math.PI) / 180
        const c = Math.cos(a2)
        const s2 = Math.sin(a2)
        const dx = t.x - r.x
        const dy = t.y - r.y
        return (
          Math.abs(dx * c + dy * s2) <= r.w / 2 && Math.abs(-dx * s2 + dy * c) <= 6 + r.h / 2 - 1
        )
      })
      expect({ at: [t.x, t.y, a], crossesOwn }.crossesOwn).toBe(true)
    }
  }

  // Frost MEP compose: the condenser forced onto the exit wall so the
  // line-set pair runs the SAME wall the sleeved building drain crosses —
  // the confirmed tick-across-rails seam (pre-fix: tick center 1.9 px from
  // BOTH rails, 5.4 px from a bubble).
  const frostMep = () => {
    const walls = [
      swall('w_s', [0, 0], [10, 0]),
      swall('w_e', [10, 0], [10, 8]),
      swall('w_n', [10, 8], [0, 8]),
      swall('w_w', [0, 8], [0, 0]),
      swall('w_mid', [5, 0], [5, 8], false),
    ]
    const rooms = [
      sroom('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]], ['w_s']),
      sroom('r_kitchen', 'kitchen', [[0, 0], [5, 0], [5, 4], [0, 4]], ['w_s']),
      sroom('r_laundry', 'laundry', [[0, 4], [5, 4], [5, 8], [0, 8]], ['w_w']),
    ]
    const p = layoutPlumbing(walls, rooms, specFrost)
    const h = layoutHvac(walls, rooms, specFrost, { heatPump: { position: [9.5, 0, -0.5] } })
    const f = buildFoundation(walls, [sslab([[0, 0], [10, 0], [10, 8], [0, 8]])], specFrost)
    const members = [...p.members, ...h.members, ...f]
    const mep = buildPlanSet(members, [...p.fixtures, ...h.fixtures], {}).find((s) =>
      s.title.startsWith('Plumbing'),
    )
    return { svg: mep?.svg ?? '', members }
  }
  const frostMepSvg = () => frostMep().svg
  /** Eligible flow-arrow runs, recomputed from the members + sheet scale. */
  const eligibleArrows = (members: Member[], svg: string): number => {
    const ratio = Number(svg.match(/scale 1:(\d+)/)?.[1] ?? 0)
    expect(ratio).toBeGreaterThan(0)
    const scale = 96 / 0.0254 / ratio
    return members.filter((m) => {
      if (m.system !== 'plumbing' || m.role !== 'pipe-run') return false
      if (!m.sourceId.startsWith('dwv-') || m.sourceId.startsWith('dwv-vent')) return false
      if (Math.abs(m.rotation[2]) <= 1e-6) return false
      const [rx, ry, rz] = m.rotation
      const ax = Math.cos(ry) * Math.cos(rz)
      const az = Math.sin(rx) * Math.sin(rz) - Math.cos(rx) * Math.sin(ry) * Math.cos(rz)
      const pf = Math.hypot(ax, az)
      return pf > 0.5 && Math.max(0.02, m.dims[0] * pf) * scale > 18
    }).length
  }
  const arrowDrops = (svg: string): number =>
    (svg.match(/<!-- dwv-arrow dropped \(crowded\): [^>]+ -->/g) ?? []).length

  test('ALL ticks: bar tips >= 4px from foreign pipes, >= 12px from bubbles, span crosses OWN pipe', () => {
    const svg = frostMepSvg()
    expect(parseTicks(svg).length).toBe(1) // one sleeved crossing in this scene
    expect(svgRects(svg, ['#35b8c9', '#d98134']).length).toBeGreaterThanOrEqual(4) // pair present
    assertTickInvariants(svg)
  })

  test('arrows regression: census stable and bubble-clean on the seam compose', () => {
    const svg = frostMepSvg()
    const arrows = [...svg.matchAll(
      /M-3\.5 -3 L4\.5 0 L-3\.5 3 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g,
    )].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
    expect(arrows.length).toBeGreaterThanOrEqual(5) // pre-seam census: 5
    const bubbles = parseBubbles(svg)
    // FAIL-2 gate: no arrow center within 4 px of any FOREIGN-class pipe
    // rect (the demo arrow reproduced the pre-fix elbow coordinate ON the
    // suction riser — arrows now get the ticks' perpendicular escape)
    const foreign = svgRects(svg, ['#35b8c9', '#d98134', '#4a7dbf', '#c0504d', '#b5aa97'])
    expect(foreign.length).toBeGreaterThan(0)
    for (const [ax, ay] of arrows) {
      for (const [bx, by] of bubbles) {
        expect(Math.hypot(bx - ax, by - ay)).toBeGreaterThanOrEqual(12)
      }
      for (const r of foreign) {
        expect(rectDist(ax, ay, r)).toBeGreaterThanOrEqual(4)
      }
    }
  })

  test('coaxial pair: a short arrow run shadowed by the line-set escapes perpendicular (FAIL 2)', () => {
    // The round-8 demo repro: run half ~14 px, slide budget t in {0, ±10},
    // the pair riser coaxial with the WHOLE run — every 1D spot sits ON a
    // rail and the round-1 bubbles-only fallback reprinted the pre-fix
    // elbow coordinate. One perpendicular step clears it.
    const mk = (over: Partial<Member>): Member => ({
      system: 'plumbing',
      role: 'pipe-run',
      dims: [0.7, 0.0762, 0.0762],
      length: 0.7,
      position: [2, -0.5, 1],
      rotation: [0, 0, Math.atan(1 / 48)],
      material: 'pvc',
      sourceId: 'dwv-branch-x',
      ...over,
    })
    const members = [
      mk({}),
      // the pair, coaxial with the drain's whole plan run
      mk({
        system: 'hvac',
        dims: [2.4, 0.019, 0.019],
        length: 2.4,
        position: [2, 0.4, 1],
        rotation: [0, 0, 0],
        material: 'copper',
        sourceId: 'lineset-suction-1',
      }),
      mk({
        system: 'hvac',
        dims: [2.4, 0.0095, 0.0095],
        length: 2.4,
        position: [2, 0.4, 1],
        rotation: [0, 0, 0],
        material: 'copper',
        sourceId: 'lineset-liquid-1',
      }),
    ]
    const mep = buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Plumbing'))
    const svg = mep?.svg ?? ''
    const arrows = [...svg.matchAll(
      /M-3\.5 -3 L4\.5 0 L-3\.5 3 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g,
    )].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
    expect(arrows.length).toBe(1) // census: the shadowed run still prints
    const rails = svgRects(svg, ['#35b8c9', '#d98134'])
    expect(rails.length).toBe(2)
    for (const r of rails) {
      expect(rectDist(arrows[0]?.[0] ?? 0, arrows[0]?.[1] ?? 0, r)).toBeGreaterThanOrEqual(4)
    }
  })

  test('cite census: every tick keeps its cite (own-tick/own-run exemption, seam round 2)', () => {
    // Round-1 cites had NO own exemptions: the tick itself (placed[] 14 px
    // away) and the cite's own pipe run killed the near ring — frost went
    // 2 crossings → 1 cite. Census must be 1:1 with ticks.
    const frost = frostMepSvg()
    expect((frost.match(/SLEEVE \(P2603\.4\)/g) ?? []).length).toBe(parseTicks(frost).length)
    const court = courtyardSvg()
    const courtTicks = parseTicks(court).length
    expect(courtTicks).toBe(3)
    expect((court.match(/SLEEVE \(P2603\.4\)/g) ?? []).length).toBe(3)
  })

  test('courtyard ticks hold the round-2 invariants too (fallback-path ticks)', () => {
    assertTickInvariants(courtyardSvg())
  })

  test('R1: two-sided shadow — the demo elbow class DROPS its arrow instead of lying', () => {
    // Third round on this exhibit: run half 14 px kills the along budget,
    // the pair shadows one perpendicular side (n=-5 between the rails,
    // n=-10 by the liquid) and the elbow's other leg (equipment here)
    // shadows n=+5/+10 — the old bubbles-only tier reprinted the pre-fix
    // coordinate every round. Now: no honest spot -> NO arrow, recorded.
    const mk = (over: Partial<Member>): Member => ({
      system: 'plumbing',
      role: 'pipe-run',
      dims: [0.7, 0.0762, 0.0762],
      length: 0.7,
      position: [2, -0.5, 1],
      rotation: [0, 0, Math.atan(1 / 48)],
      material: 'pvc',
      sourceId: 'dwv-branch-x',
      ...over,
    })
    const scale = 96 / 0.0254 / 20 // ratio pinned by the assertion below
    const members = [
      mk({}),
      mk({
        system: 'hvac',
        dims: [2.4, 0.019, 0.019],
        length: 2.4,
        position: [2, 0.4, 1 + 5 / scale],
        rotation: [0, 0, 0],
        material: 'copper',
        sourceId: 'lineset-suction-1',
      }),
      mk({
        system: 'hvac',
        dims: [2.4, 0.0095, 0.0095],
        length: 2.4,
        position: [2, 0.4, 1 + 5 / scale],
        rotation: [0, 0, 0],
        material: 'copper',
        sourceId: 'lineset-liquid-1',
      }),
      mk({
        system: 'hvac',
        role: 'equipment',
        dims: [2.4, 0.6, 22 / scale],
        length: 2.4,
        position: [2, 0.3, 1 - 14 / scale],
        rotation: [0, 0, 0],
        material: 'steel',
        sourceId: 'ahu-x',
      }),
    ]
    const svg = buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Plumbing'))?.svg ?? ''
    expect(svg).toContain('scale 1:20') // offsets above assume this ratio
    // the elbow coordinate is DEAD: zero arrows anywhere near a foreign rect
    const arrows = [...svg.matchAll(
      /M-3\.5 -3 L4\.5 0 L-3\.5 3 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g,
    )]
    expect(arrows.length).toBe(0)
    expect(arrowDrops(svg)).toBe(1)
    expect(svg).toContain('dwv-arrow dropped (crowded): dwv-branch-x')
    // census accounting: eligible = printed + explicitly-crowded
    expect(eligibleArrows(members, svg)).toBe(1)
  })

  test('R1: frost census accounts drops explicitly (eligible = printed + crowded)', () => {
    const { svg, members } = frostMep()
    const printed = (svg.match(/M-3\.5 -3 L4\.5 0 L-3\.5 3 Z/g) ?? []).length
    expect(printed + arrowDrops(svg)).toBe(eligibleArrows(members, svg))
    // and every PRINTED arrow honors the 4 px foreign margin (no tier-3 lies)
    const foreign = svgRects(svg, ['#35b8c9', '#d98134', '#4a7dbf', '#c0504d', '#b5aa97'])
    const pts = [...svg.matchAll(
      /M-3\.5 -3 L4\.5 0 L-3\.5 3 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g,
    )].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
    for (const [ax, ay] of pts) {
      for (const r of foreign) expect(rectDist(ax, ay, r)).toBeGreaterThanOrEqual(4)
    }
  })

  test('R2: cites never overlap their own tick bars (rect separation >= 2px)', () => {
    // minimal VERTICAL-leg scene: with empty surroundings the ring-14
    // perpendicular candidate is FIRST and (pre-fix) CONTAINED the tick
    // (|dx|=14 < width/2, dy=0 — ghost notches under both frost cites in
    // the examiner's round-8 exhibit); horizontal legs were immune.
    const vertical: Member[] = [
      {
        system: 'plumbing',
        role: 'pipe-run',
        dims: [1.5, 0.0762, 0.0762],
        length: 1.5,
        position: [2, -0.6, 1],
        rotation: [0, -Math.PI / 2, Math.atan(1 / 48)],
        material: 'pvc',
        sourceId: 'dwv-main',
        label: '3" building drain — sleeved through foundation (P2603.4)',
      },
      {
        system: 'foundation',
        role: 'stemwall',
        dims: [3, 1.3, 0.2],
        length: 3,
        position: [2, -0.65, 1],
        rotation: [0, 0, 0],
        material: 'concrete',
        sourceId: 'w_x',
      },
    ]
    const verticalSvg =
      buildPlanSet(vertical, [], {}).find((s) => s.title.startsWith('Plumbing'))?.svg ?? ''
    for (const svg of [verticalSvg, frostMepSvg(), courtyardSvg()]) {
      const ticks = parseTicks(svg)
      const cites = [...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>SLEEVE/g)].map(
        (m) => [Number(m[1]), Number(m[2]) - 3] as [number, number],
      )
      expect(cites.length).toBe(ticks.length) // census intact
      const cw = ('SLEEVE (P2603.4)'.length * 6) / 2
      for (const [cx, cy] of cites) {
        const t = ticks.reduce((b, k) =>
          Math.hypot(k.x - cx, k.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? k : b,
        )
        // the tick as a drawn rect (bars ±2.5 along, span ±6) + 2 px pad
        const tickRect = { w: 7, h: 13.6, fill: '', x: t.x, y: t.y, rot: t.rot }
        expect(textHits(cx, cy, cw + 2, 5 + 2, tickRect)).toBe(false)
      }
    }
  })

  // the condenser parked ON the exit: rails + CU bubble crowd the
  // crossing — the examiner's under-clearing exhibit (tips 2.9/bubble 8)
  const squeezedCourtyardSvg = () => courtyardAt(4.2).svg

  test('MANDATE: every glyph invariant on all three round-8 composes', () => {
    // The examiner's exhibits, rebuilt from the round notes (frost MEP
    // with the condenser forced onto the exit wall; courtyard east-exit;
    // the squeezed variant). Every glyph family asserts on each compose.
    const composes: { name: string; svg: string; members: Member[] }[] = [
      { name: 'frost-mep', ...frostMep() },
      { name: 'courtyard', ...courtyardAt(5.5) },
      { name: 'squeezed', ...courtyardAt(4.2) },
    ]
    const citeW = ('SLEEVE (P2603.4)'.length * 6) / 2
    for (const { name, svg, members } of composes) {
      const foreign = svgRects(svg, ['#35b8c9', '#d98134', '#4a7dbf', '#c0504d', '#b5aa97'])
      const bubbles = parseBubbles(svg)
      const ticks = parseTicks(svg)
      const cites = [...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>SLEEVE/g)].map(
        (m) => [Number(m[1]), Number(m[2]) - 3] as [number, number],
      )
      // --- ticks: 4/12 or a recorded, provenance-carrying exhaustion ---
      expect(ticks.length).toBeGreaterThan(0)
      const crowdedTicks = (svg.match(/<!-- sleeve-tick crowded:/g) ?? []).length
      for (const t of ticks) {
        const tipOk = foreign.every((r) => tickTips(t).every(([qx, qy]) => rectDist(qx, qy, r) >= 4))
        const bubOk = bubbles.every(([bx, by]) => Math.hypot(bx - t.x, by - t.y) >= 12)
        if (!(tipOk && bubOk)) {
          expect({ name, at: [t.x, t.y], crowdedTicks }.crowdedTicks).toBeGreaterThan(0)
        }
      }
      // --- cites: census 1:1 (joint pass) or recorded drops; never on own tick ---
      const citeDrops = (svg.match(/<!-- sleeve-cite dropped/g) ?? []).length
      expect({ name, n: cites.length + citeDrops }.n).toBe(ticks.length)
      expect({ name, citeDrops }.citeDrops).toBe(0) // all three composes place every cite
      for (const [cx, cy] of cites) {
        const t = ticks.reduce((b, k) =>
          Math.hypot(k.x - cx, k.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? k : b,
        )
        expect(textHits(cx, cy, citeW + 2, 5 + 2, { w: 7, h: 13.6, fill: '', x: t.x, y: t.y, rot: t.rot })).toBe(false)
      }
      // --- arrows: census accounts drops; printed ones clear pipes,
      // bubbles AND text rects (round-4 F1: an arrow printed INSIDE the
      // kitchen cite on both courtyards) ---
      const arrows = [...svg.matchAll(
        /M-3\.5 -3 L4\.5 0 L-3\.5 3 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g,
      )].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
      expect({ name, n: arrows.length + arrowDrops(svg) }.n).toBe(eligibleArrows(members, svg))
      for (const [ax, ay] of arrows) {
        for (const r of foreign) expect(rectDist(ax, ay, r)).toBeGreaterThanOrEqual(4)
        for (const [bx, by] of bubbles) {
          expect(Math.hypot(bx - ax, by - ay)).toBeGreaterThanOrEqual(12)
        }
        for (const [cx, cy] of cites) {
          const inCite = Math.abs(cx - ax) < citeW + 6 && Math.abs(cy - ay) < 5 + 6
          expect({ name, at: [ax, ay], inCite }.inCite).toBe(false)
        }
      }
      // --- marker: present, on-sheet, off pipes/equipment, clear of cites ---
      const txt = svg.match(
        /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>SEWER\/SEPTIC/,
      )
      expect(txt).not.toBeNull()
      const wTxt = 'SEWER/SEPTIC (P3005.4)'.length * 6
      const anchor2 = txt?.[3]
      const tx0 = Number(txt?.[1])
      const ty0 = Number(txt?.[2]) - 3
      const left = anchor2 === 'start' ? tx0 : anchor2 === 'end' ? tx0 - wTxt : tx0 - wTxt / 2
      expect(left).toBeGreaterThan(48)
      expect(left + wTxt).toBeLessThan(1056 - 48)
      const cxT = left + wTxt / 2
      const pipeHits = [...foreign, ...svgRects(svg, ['#8fb0c4'])].filter((r) =>
        textHits(cxT, ty0, wTxt / 2, 5, r),
      )
      expect({ name, pipeHits: pipeHits.length }.pipeHits).toBe(0)
      for (const [cx, cy] of cites) {
        expect(Math.hypot(cx - cxT, cy - ty0)).toBeGreaterThanOrEqual(12)
      }
      // --- legend: the standing tick row prints whenever ticks do (an
      // uncited bar stays self-describing), equipment row when bodies do ---
      expect(svg).toContain('TICKS = SLEEVED CROSSING (P2603.4)')
      if (members.some((m) => m.role === 'equipment')) {
        expect(svg).toContain('equipment body (AHU / CU)')
      }
    }
    // …and a tick-less sheet carries NO tick row (the row keys off ticks)
    const bare = buildPlanSet(
      [
        {
          system: 'plumbing',
          role: 'pipe-run',
          dims: [3, 0.02, 0.02],
          length: 3,
          position: [2, 0.28, 1],
          rotation: [0, 0, 0],
          material: 'copper',
          sourceId: 'cold-lav',
        },
      ],
      [],
      {},
    ).find((s) => s.title.startsWith('Plumbing'))
    expect(bare?.svg ?? '').not.toContain('TICKS = SLEEVED CROSSING')
  })

  test('R3: squeezed exit — every tick meets 4/12 OR is provably score-max over the widened budget', () => {
    const svg = squeezedCourtyardSvg()
    const ticks = parseTicks(svg)
    expect(ticks.length).toBe(3)
    const foreign = svgRects(svg, ['#35b8c9', '#d98134', '#4a7dbf', '#c0504d', '#b5aa97'])
    const own = svgRects(svg, ['#8fb0c4'])
    const bubbles = parseBubbles(svg)
    // crowded provenance comments sit immediately before their tick path
    const crowded = [...svg.matchAll(
      /<!-- sleeve-tick crowded: (\S+) t=(-?\d+) n=(-?\d+) score=(-?[\d.]+) -->\s*<path d="M-2\.5 -6 L-2\.5 6 M2\.5 -6 L2\.5 6" stroke="#41637a"[^/]*translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+)\)/g,
    )].map((m) => ({
      t: Number(m[2]),
      n: Number(m[3]),
      x: Number(m[5]),
      y: Number(m[6]),
      rot: Number(m[7]),
    }))
    const T_GRID = [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10, 12, -12, 14, -14, 16, -16, 20, -20, 24, -24, 28, -28, 32, -32, 36, -36, 40, -40, 44, -44]
    const N_GRID = [0, 3, -3, 5, -5, 8, -8]
    let sawCrowded = 0
    for (const t of ticks) {
      const tipOk = foreign.every((r) => tickTips(t).every(([qx, qy]) => rectDist(qx, qy, r) >= 4))
      const bubOk = bubbles.every(([bx, by]) => Math.hypot(bx - t.x, by - t.y) >= 12)
      if (tipOk && bubOk) continue
      // under-clearing is only legal with recorded exhaustion…
      const c = crowded.find((k) => Math.abs(k.x - t.x) < 0.2 && Math.abs(k.y - t.y) < 0.2)
      expect(c).toBeDefined()
      if (!c) continue
      sawCrowded++
      // …AND the chosen spot must be score-max over the widened budget
      // (re-scored from outside under one consistent metric: foreign-fill
      // rects for tips, bubbles + other ticks for the 12 px radius).
      const a = (c.rot * Math.PI) / 180
      const ax = Math.cos(a)
      const ay = Math.sin(a)
      const ox = c.x - (ax * c.t - ay * c.n)
      const oy = c.y - (ay * c.t + ax * c.n)
      const obstacles: [number, number][] = [
        ...bubbles,
        ...ticks.filter((o) => o !== t).map((o) => [o.x, o.y] as [number, number]),
      ]
      const scoreAt = (px: number, py: number): number => {
        const probe = { x: px, y: py, rot: c.rot }
        const tip = foreign.reduce(
          (m2, r) => Math.min(m2, ...tickTips(probe).map(([qx, qy]) => rectDist(qx, qy, r))),
          Number.POSITIVE_INFINITY,
        )
        const bub = obstacles.reduce(
          (m2, [bx, by]) => Math.min(m2, Math.hypot(bx - px, by - py)),
          Number.POSITIVE_INFINITY,
        )
        return Math.min(tip - 5, bub - 13)
      }
      const crossesOwn = (px: number, py: number): boolean =>
        own.some((r) => {
          const a2 = (-r.rot * Math.PI) / 180
          const cc = Math.cos(a2)
          const ss = Math.sin(a2)
          const dx = px - r.x
          const dy = py - r.y
          return Math.abs(dx * cc + dy * ss) <= r.w / 2 && Math.abs(-dx * ss + dy * cc) <= 6 + r.h / 2 - 2
        })
      const chosen = scoreAt(t.x, t.y)
      let bestAlt = Number.NEGATIVE_INFINITY
      for (const tt of T_GRID) {
        for (const nn of N_GRID) {
          const px = ox + ax * tt - ay * nn
          const py = oy + ay * tt + ax * nn
          if (!crossesOwn(px, py)) continue
          bestAlt = Math.max(bestAlt, scoreAt(px, py))
        }
      }
      // slack: the engine also sees equipment boxes + same-color dwv legs
      // the fill-based re-score cannot attribute
      expect(bestAlt).toBeLessThanOrEqual(chosen + 3)
    }
    expect(sawCrowded).toBeGreaterThanOrEqual(1) // the exhibit really is squeezed
  })

  const courtyardAt = (hpZ: number) => {
    const uWalls = [
      swall('u_s', [0, 0], [12, 0]),
      swall('u_e', [12, 0], [12, 8]),
      swall('u_n', [12, 8], [0, 8]),
      swall('u_w', [0, 8], [0, 0]),
      swall('u_c1', [5, 2], [5, 6]),
      swall('u_c2', [7, 2], [7, 6]),
    ]
    const uRooms = [
      sroom('r_ubath', 'bathroom', [[8, 2], [11, 2], [11, 6], [8, 6]], ['u_e']),
      sroom('r_ukitchen', 'kitchen', [[1, 2], [4, 2], [4, 6], [1, 6]], ['u_w']),
    ]
    const p = layoutPlumbing(uWalls, uRooms, specFrost)
    const h = layoutHvac(uWalls, uRooms, specFrost, { heatPump: { position: [12.5, 0, hpZ] } })
    const f = buildFoundation(uWalls, [sslab([[0, 0], [12, 0], [12, 8], [0, 8]])], specFrost)
    const members = [...p.members, ...h.members, ...f]
    const mep = buildPlanSet(members, [...p.fixtures, ...h.fixtures], {}).find((s) =>
      s.title.startsWith('Plumbing'),
    )
    return { svg: mep?.svg ?? '', members }
  }
  const courtyardSvg = () => courtyardAt(5.5).svg

  test('courtyard east exit: marker text clears pipes, bubbles, CITES, equipment + the viewBox', () => {
    const svg = courtyardSvg()
    const txt = svg.match(
      /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>SEWER\/SEPTIC/,
    )
    expect(txt).not.toBeNull()
    const wTxt = 'SEWER/SEPTIC (P3005.4)'.length * 6
    const anchor = txt?.[3]
    const tx = Number(txt?.[1])
    const ty = Number(txt?.[2]) - 3 // baseline → center
    const left = anchor === 'start' ? tx : anchor === 'end' ? tx - wTxt : tx - wTxt / 2
    // in the viewBox with margin
    expect(left).toBeGreaterThan(48)
    expect(left + wTxt).toBeLessThan(1056 - 48)
    // the bold cite never lies on a pipe (the old last resort erased the
    // main + both rails over ~130 px)
    const pipes = svgRects(svg, PIPE_FILLS)
    expect(pipes.length).toBeGreaterThan(4) // non-vacuous
    const hits = pipes.filter((r) => textHits(left + wTxt / 2, ty, wTxt / 2, 5, r))
    expect(hits).toEqual([])
    // and clears the bubbles
    const bubbles = parseBubbles(svg)
    const cxT = left + wTxt / 2
    for (const [bx, by] of bubbles) {
      const clash = Math.abs(bx - cxT) < wTxt / 2 + 7 && Math.abs(by - ty) < 12
      expect(clash).toBe(false)
    }
    // the glyph keeps its bubble clearance too
    const glyph = svg.match(
      /M-5 -4 L6 0 L-5 4 Z" fill="#41637a" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/,
    )
    expect(glyph).not.toBeNull()
    for (const [bx, by] of bubbles) {
      expect(
        Math.hypot(bx - Number(glyph?.[1]), by - Number(glyph?.[2])),
      ).toBeGreaterThanOrEqual(12)
    }
    // FAIL-1 gates: the marker text never overprints a SLEEVE cite (the
    // round-1 tier 2 laid it 11.6 px from the exit cite) …
    const cites = [...svg.matchAll(
      /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>SLEEVE \(P2603\.4\)/g,
    )].map((m) => [Number(m[1]), Number(m[2]) - 3] as [number, number])
    expect(cites.length).toBeGreaterThan(0)
    const citeW = 'SLEEVE (P2603.4)'.length * 6
    for (const [cx, cy] of cites) {
      expect(Math.hypot(cx - cxT, cy - ty)).toBeGreaterThanOrEqual(12)
      // and the rects themselves separate (axis test, 4 px pad)
      const apart =
        Math.abs(cx - cxT) >= citeW / 2 + wTxt / 2 + 4 || Math.abs(cy - ty) >= 14
      expect(apart).toBe(true)
    }
    // … and never crosses the water-heater equipment box (unregistered in
    // round 1 — the cite ran straight through it)
    const whBoxes = svgRects(svg, ['#b5aa97'])
    for (const r of whBoxes) {
      expect(textHits(cxT, ty, wTxt / 2, 5, r)).toBe(false)
    }
  })
})

describe('MEP sheet — WH T&P discharge tone (B20 closing round)', () => {
  test('a placed-path WH sheet never resurrects the generic LOD-200 pipe row', () => {
    // Pre-fix plumbingPipeColor('wh-tp-…') was null → the 'supply / DWV
    // pipe' fallback legend row printed on every water-heater sheet.
    const pipe = (sourceId: string, z: number): Member =>
      member({
        system: 'plumbing',
        role: 'pipe-run',
        size: undefined,
        material: 'copper',
        dims: [2, 0.02, 0.02],
        position: [2, 0.4, z],
        sourceId,
      })
    const members = [pipe('cold-lav', 0.5), pipe('wh-tp-discharge', 1.0)]
    const mep = buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Plumbing'))
    expect(mep).toBeDefined()
    const svg = mep?.svg ?? ''
    expect(svg).not.toContain('supply / DWV pipe')
    // the discharge reads as the hot family — and the row is in the legend
    expect(svg).toContain('supply — hot water')
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B21d: door + window SCHEDULE — openings were framed to fabrication
// level but never tabulated (no schedule sheet anywhere in the set, no
// out-of-scope label). Gates: schedule census == openings in the scene,
// marks unique + deterministic (wall order + u), RO/header cells byte-match
// the FRAMED members, engineered rows say by-supplier, flags print verbatim,
// wall-plan mark bubbles present + de-collided (placed[] registry incl. the
// A-A bubbles), a 40-opening scene paginates with contiguous numbering, an
// opening-less scene emits no sheet, and paper without the option stays
// byte-equal to pre-B21d.
// ---------------------------------------------------------------------------

describe('door + window schedule (LOD-400 B21d)', () => {
  const spec400 = { ...DEFAULT_SPEC, detail: '400' as const }
  const opening = (
    id: string,
    kind: OpeningSlice['kind'],
    u: number,
    width: number,
    height: number,
    sillHeight: number,
    roughWidth: number,
    roughHeight: number,
  ): OpeningSlice => ({ id, kind, u, width, height, sillHeight, roughWidth, roughHeight })
  const bwall = (
    id: string,
    s: [number, number],
    e: [number, number],
    openings: OpeningSlice[],
    thickness = 0.114,
  ): WallSlice => {
    const dx = e[0] - s[0]
    const dz = e[1] - s[1]
    const length = Math.hypot(dx, dz)
    return {
      id,
      start: s,
      end: e,
      length,
      dir: [dx / length, dz / length],
      thickness,
      height: 2.5,
      exterior: true,
      openings,
      curved: false,
    }
  }
  /** The composed exhibit: 4-wall shell + a floating tall-door wall. */
  const scene = (): { walls: WallSlice[]; members: Member[] } => {
    const walls = [
      bwall('w_s', [0, 0], [8, 0], [
        opening('d1', 'door', 2, 0.914, 2.032, 0, 0.965, 2.083),
        opening('n1', 'window', 5, 1.219, 1.219, 0.914, 1.27, 1.27),
      ]),
      bwall('w_e', [8, 0], [8, 6], [opening('n2', 'window', 3, 0.61, 0.61, 1.2, 0.66, 0.66)]),
      // 16-ft garage door — past the prescriptive header span (engineered)
      bwall('w_n', [8, 6], [0, 6], [opening('d2', 'door', 4, 4.877, 2.134, 0, 4.928, 2.185)]),
      bwall('w_w', [0, 6], [0, 0], []),
      // tall door crowds the plates → the composed header-depth flag fires
      bwall('w_t', [0, 9], [8, 9], [opening('d3', 'door', 4, 0.914, 2.38, 0, 0.965, 2.43)]),
    ]
    return { walls, members: frameWalls(walls, spec400) }
  }
  const unesc = (t: string): string =>
    t
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')
  /** Mark cells: bold #222 at the MARK column (x=48). */
  const parseMarks = (svg: string): { mark: string; y: number }[] =>
    [...svg.matchAll(
      /<text x="48" y="(\d+)" font-size="10" font-weight="bold"[^>]*fill="#222">([DW]\d+)<\/text>/g,
    )].map((m) => ({ mark: m[2] as string, y: Number(m[1]) }))
  /** Read one non-bold cell at (x, y). */
  const cellAt = (svg: string, x: number, y: number): string | null => {
    const m = svg.match(
      new RegExp(`<text x="${x}" y="${y}" font-size="10" font-family[^>]*>([^<]*)</text>`),
    )
    return m ? unesc(m[1] as string) : null
  }
  /** All rendered text contents, joined (flag verbatim-print checks). */
  const allText = (svg: string): string =>
    [...svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => unesc(m[1] as string)).join(' ')
  const schedSheetsOf = (sheets: { title: string; svg: string }[]) =>
    sheets.filter((s) => s.title.startsWith('Door + window schedule'))
  /** The sheet carrying the schedule TABLE — folded or dedicated (page 1). */
  const tableSvgOf = (sheets: { title: string; svg: string }[]): string =>
    sheets.find((s) => s.svg.includes('>MARK</text>'))?.svg ?? ''
  /** Wall-plan mark bubbles (r=8 white circles with the mark text). */
  const parseBubbles = (svg: string): { x: number; y: number; mark: string }[] =>
    [...svg.matchAll(
      /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><circle r="8"[^/]*\/><text[^>]*>([DW]\d+)<\/text>/g,
    )].map((m) => ({ x: Number(m[1]), y: Number(m[2]), mark: m[3] as string }))
  const memberUOn = (m: Member, wall: WallSlice): number =>
    (m.position[0] - wall.start[0]) * wall.dir[0] + (m.position[2] - wall.start[1]) * wall.dir[1]

  test('census: one row per opening, marks by wall order + u, cells byte-match the framed members', () => {
    const { walls, members } = scene()
    const sheets = buildPlanSet(members, [], { walls })
    // the 5-opening exhibit table is small → FOLDED into the schedules
    // sheet (examiner round-1 judgment); the fold test below pins that
    const svg = tableSvgOf(sheets)
    expect(svg).not.toBe('')
    const rows = parseMarks(svg)
    // census == openings in the scene; deterministic traversal order
    // (walls by length desc + id asc: w_n, w_s, w_t at 8 m, then w_e)
    expect(rows.map((r) => r.mark)).toEqual(['D1', 'D2', 'W1', 'D3', 'W2'])
    expect(new Set(rows.map((r) => r.mark)).size).toBe(5)
    const rowY = new Map(rows.map((r) => [r.mark, r.y]))
    // D1: the 16-ft garage door on w_n framed an ENGINEERED header — the
    // row says by-supplier, never the drawn placeholder stick
    const yD1 = rowY.get('D1') as number
    const d1Header = members.find(
      (m) => m.role === 'header' && m.sourceId === 'w_n',
    ) as Member
    expect(d1Header.material).toBe('engineered')
    expect(cellAt(svg, 92, yD1)).toBe('door')
    expect(cellAt(svg, 302, yD1)).toBe(`${formatFtIn(4.928)} × ${formatFtIn(2.185)}`)
    expect(cellAt(svg, 522, yD1)).toBe('ENGINEERED (by supplier)')
    expect(cellAt(svg, 700, yD1)).toBe('w_n')
    // D2: w_s door — nominal + RO cells are the OpeningSlice values
    // verbatim, the header cell reads the FRAMED member back
    const yD2 = rowY.get('D2') as number
    expect(cellAt(svg, 92, yD2)).toBe('door')
    expect(cellAt(svg, 152, yD2)).toBe(`${formatFtIn(0.914)} × ${formatFtIn(2.032)}`)
    expect(cellAt(svg, 302, yD2)).toBe(`${formatFtIn(0.965)} × ${formatFtIn(2.083)}`)
    expect(cellAt(svg, 452, yD2)).toBe('—') // doors carry no sill
    expect(cellAt(svg, 700, yD2)).toBe('w_s')
    const wS = walls[0] as WallSlice
    const d2Header = members.find(
      (m) => m.role === 'header' && m.sourceId === 'w_s' && Math.abs(memberUOn(m, wS) - 2) < 0.5,
    ) as Member
    expect(d2Header).toBeDefined()
    expect(cellAt(svg, 522, yD2)).toBe(d2Header.size as string)
    // W1: window row — sill AFF prints; header byte-matches its member too
    const yW1 = rowY.get('W1') as number
    expect(cellAt(svg, 92, yW1)).toBe('window')
    expect(cellAt(svg, 452, yW1)).toBe(formatFtIn(0.914))
    const w1Header = members.find(
      (m) => m.role === 'header' && m.sourceId === 'w_s' && Math.abs(memberUOn(m, wS) - 5) < 0.5,
    ) as Member
    expect(cellAt(svg, 522, yW1)).toBe(w1Header.size as string)
    // D3: the tall door's composed header flag prints VERBATIM (P4) — the
    // member's own flag string, wrap-reassembled from the sheet text
    const d3Header = members.find(
      (m) => m.role === 'header' && m.sourceId === 'w_t',
    ) as Member
    expect(d3Header.flag).toBeDefined()
    expect(d3Header.flag).toContain('does not fit between the RO and the plates')
    expect(allText(svg)).toContain(d3Header.flag as string)
  })

  test('marks + schedule deterministic across recomputes', () => {
    const a = scene()
    const b = scene()
    expect(assignOpeningMarks(a.walls).map((m) => [m.mark, m.opening.id])).toEqual(
      assignOpeningMarks(b.walls).map((m) => [m.mark, m.opening.id]),
    )
    const sa = buildPlanSet(a.members, [], { walls: a.walls })
    const sb = buildPlanSet(b.members, [], { walls: b.walls })
    expect(sa.map((s) => s.svg)).toEqual(sb.map((s) => s.svg))
  })

  test('F1: an RO-clamp slide never steals a neighbor header (skeptic exhibit)', () => {
    // 16-ft garage door drawn at u=0.5: the frame slides its header to
    // u≈2.578 — PAST the u=1.0 window. The old greedy nearest-in-mark-order
    // join gave D1 the window's stick, W1 '—', and dropped all three
    // composed ENGINEERED flags from paper.
    const wx = bwall('w_x', [0, 0], [8, 0], [
      opening('gd', 'door', 0.5, 4.877, 2.134, 0, 4.928, 2.185),
      opening('wn', 'window', 1.0, 0.61, 0.61, 1.2, 0.66, 0.66),
    ])
    const members = frameWalls([wx], spec400)
    const heads = members.filter((m) => m.role === 'header')
    expect(heads.length).toBe(2)
    const eng = heads.find((m) => m.material === 'engineered') as Member
    const winHead = heads.find((m) => m.material !== 'engineered') as Member
    // the exhibit premise: the clamp slid the engineered header past the window
    expect(memberUOn(eng, wx)).toBeGreaterThan(memberUOn(winHead, wx))
    expect(eng.flag).toContain('ENGINEERED BEAM REQUIRED')
    expect(eng.flag).toContain('RO shifted')
    const svg = tableSvgOf(buildPlanSet(members, [], { walls: [wx] }))
    const rows = parseMarks(svg)
    expect(rows.map((r) => r.mark)).toEqual(['D1', 'W1'])
    const rowY = new Map(rows.map((r) => [r.mark, r.y]))
    // D1 owns the engineered header; W1 keeps its OWN stick — never '—'
    expect(cellAt(svg, 522, rowY.get('D1') as number)).toBe('ENGINEERED (by supplier)')
    expect(cellAt(svg, 522, rowY.get('W1') as number)).toBe(winHead.size as string)
    // every composed flag part prints verbatim
    expect(allText(svg)).toContain(eng.flag as string)
  })

  test('F2: equal-length walls tie-break by wall id — marks immune to caller order', () => {
    const pair = (): WallSlice[] => [
      bwall('wa', [0, 0], [6, 0], [opening('oa', 'door', 2, 0.914, 2.032, 0, 0.965, 2.083)]),
      bwall('wb', [0, 3], [6, 3], [opening('ob', 'door', 2, 0.914, 2.032, 0, 0.965, 2.083)]),
    ]
    const fwd = assignOpeningMarks(pair())
    const rev = assignOpeningMarks(pair().reverse())
    expect(fwd.map((m) => [m.mark, m.opening.id])).toEqual(rev.map((m) => [m.mark, m.opening.id]))
    expect(fwd.map((m) => [m.mark, m.wall.id])).toEqual([
      ['D1', 'wa'],
      ['D2', 'wb'],
    ])
  })

  test('F4: CMU openings through computeLevel — precast lintel + bond-beam-as-lintel cells', () => {
    const { computeLevel } = require('../framing/compute') as typeof import('../framing/compute')
    const { FramingNode } = require('../framing/schema') as typeof import('../framing/schema')
    const nodesFor = (doorHeight: number): Record<string, Record<string, unknown>> => ({
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.7 },
      wall_cmu: {
        id: 'wall_cmu',
        type: 'wall',
        parentId: 'level_1',
        start: [0, 0],
        end: [6, 0],
        thickness: 0.2,
        height: 2.5,
        frontSide: 'exterior',
        backSide: 'interior',
        children: ['door_1'],
      },
      door_1: {
        id: 'door_1',
        type: 'door',
        position: [2, doorHeight / 2, 0],
        width: 0.9,
        height: doorHeight,
      },
    })
    const config = {
      ...FramingNode.parse({ jurisdiction: 'INTL', wallOverrides: { wall_cmu: 'cmu' } }),
      parentId: 'level_1',
    } as Parameters<typeof computeLevel>[1]
    // (a) head well below the bond beam → the precast lintel frames and
    // the schedule cell reads it back (ComputeResult.walls plumb-through)
    const r1 = computeLevel(nodesFor(2.1), config)
    expect(r1.walls.some((w2) => w2.id === 'wall_cmu' && w2.openings.length === 1)).toBe(true)
    expect(r1.members.some((m) => m.role === 'lintel')).toBe(true)
    const s1 = tableSvgOf(buildPlanSet(r1.members, r1.fixtures, { walls: r1.walls }))
    const rows1 = parseMarks(s1)
    expect(rows1.map((r) => r.mark)).toEqual(['D1'])
    expect(cellAt(s1, 522, (rows1[0] as { y: number }).y)).toBe('precast lintel')
    // (b) head within a course of the top → cmu emits NO lintel by design
    // (the bond beam doubles as the lintel, the FL tie-beam detail) — the
    // cell says so instead of a dishonest '—'
    const r2 = computeLevel(nodesFor(2.2), config)
    expect(r2.members.some((m) => m.role === 'lintel')).toBe(false)
    expect(r2.members.some((m) => m.role === 'bond-beam')).toBe(true)
    const s2 = tableSvgOf(buildPlanSet(r2.members, r2.fixtures, { walls: r2.walls }))
    const rows2 = parseMarks(s2)
    expect(rows2.map((r) => r.mark)).toEqual(['D1'])
    expect(cellAt(s2, 522, (rows2[0] as { y: number }).y)).toBe('bond beam as lintel')
  })

  test('wall-scoped flags print prefixed — never read opening-scoped', () => {
    // a 0.15 m wall defaults to 2x6 → cavity-fit compression: the S7
    // aggregate flag rides EVERY member incl. this window's header, but it
    // describes the WALL, not the opening
    const wc = bwall(
      'w_c',
      [0, 0],
      [8, 0],
      [opening('ow', 'window', 4, 1.219, 1.219, 0.914, 1.27, 1.27)],
      0.15,
    )
    const members = frameWalls([wc], spec400)
    const head = members.find((m) => m.role === 'header') as Member
    expect(head.flag).toContain('compressed')
    // the same string rides non-opening members (that's what makes it wall-scoped)
    expect(members.some((m) => m.role === 'stud' && m.flag === head.flag)).toBe(true)
    const svg = tableSvgOf(buildPlanSet(members, [], { walls: [wc] }))
    expect(allText(svg)).toContain(`wall w_c: ${head.flag}`)
  })

  test('fold judgment: small tables fold into Schedules + takeoff; big ones keep dedicated sheets', () => {
    // SMALL: the 5-opening exhibit folds — no dedicated sheet, table on the
    // schedules sheet, cover index without a schedule entry, sheet census
    // identical to the no-walls set (folding adds no sheet)
    const { walls, members } = scene()
    const folded = buildPlanSet(members, [], { walls })
    expect(folded.map((s) => s.title)).not.toContain('Door + window schedule')
    const schedSvg = folded.find((s) => s.title === 'Schedules + takeoff')?.svg ?? ''
    expect(schedSvg).toContain('>MARK</text>')
    expect(schedSvg).toContain('Door + window schedule (3 doors / 2 windows) · Material takeoff')
    expect(parseMarks(schedSvg).length).toBe(5)
    expect(folded[0]?.svg ?? '').not.toContain('Door + window schedule')
    expect(folded.length).toBe(buildPlanSet(members, [], {}).length)
    // takeoff rows flow BELOW the folded table — no overprint: the topmost
    // takeoff row starts under the lowest table line (marks + red flags)
    const tableYs = [
      ...parseMarks(schedSvg).map((r) => r.y),
      ...[...schedSvg.matchAll(/<text x="7[26]" y="(\d+)"[^>]*fill="#a03015"/g)].map((m) =>
        Number(m[1]),
      ),
    ]
    const takeoffYs = [
      ...schedSvg.matchAll(/<text x="48" y="(\d+)" font-size="10" font-family[^>]*fill="#222">/g),
    ].map((m) => Number(m[1]))
    expect(takeoffYs.length).toBeGreaterThan(0)
    expect(Math.min(...takeoffYs)).toBeGreaterThan(Math.max(...tableYs))
    // BIG: the 40-opening stress scene keeps its dedicated sheets (pinned in
    // the stress test) and the cover indexes them
    const wallsBig: WallSlice[] = []
    for (let i = 0; i < 5; i++) {
      const os: OpeningSlice[] = []
      for (let k = 0; k < 8; k++) {
        os.push(opening(`o${i}_${k}`, 'window', 2 + k * 5, 1.219, 1.219, 0.9, 1.27, 1.27))
      }
      wallsBig.push(bwall(`w${i}`, [0, i * 3], [40, i * 3], os))
    }
    const big = buildPlanSet(frameWalls(wallsBig, spec400), [], { walls: wallsBig })
    expect(big.some((s) => s.title.startsWith('Door + window schedule ('))).toBe(true)
    expect(big[0]?.svg ?? '').toContain('Door + window schedule (1/')
    // dedicated sheets sit after the drawings, before the takeoff
    const bigTitles = big.map((s) => s.title)
    const firstSched = bigTitles.findIndex((t) => t.startsWith('Door + window schedule'))
    expect(firstSched).toBeGreaterThan(bigTitles.indexOf('Section A-A (transverse)'))
    expect(firstSched).toBeLessThan(bigTitles.findIndex((t) => t.startsWith('Schedules + takeoff')))
  })

  test('wall framing plan prints one de-collided mark bubble per opening', () => {
    const { walls, members } = scene()
    const sheets = buildPlanSet(members, [], { walls })
    const svg = sheets.find((s) => s.title === 'Wall framing plan')?.svg ?? ''
    const bubbles = parseBubbles(svg)
    expect(new Set(bubbles.map((b) => b.mark))).toEqual(new Set(['D1', 'D2', 'D3', 'W1', 'W2']))
    expect(bubbles.length).toBe(5)
    // clearances like the glyph gates: bubbles pairwise apart…
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const bi = bubbles[i] as { x: number; y: number }
        const bj = bubbles[j] as { x: number; y: number }
        expect(Math.hypot(bi.x - bj.x, bi.y - bj.y)).toBeGreaterThanOrEqual(15)
      }
    }
    // …and clear of the A-A section bubbles (registered in placed[])
    const aBubbles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="10"/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as [number, number],
    )
    expect(aBubbles.length).toBe(2)
    for (const b of bubbles) {
      for (const [ax, ay] of aBubbles) {
        expect(Math.hypot(b.x - ax, b.y - ay)).toBeGreaterThanOrEqual(15)
      }
    }
    // no crowded fallback fired on this scene
    expect(svg).not.toContain('opening-mark crowded')
    // the symbol is keyed in the sheet legend (P2)
    expect(svg).toContain('opening mark — see door + window schedule')
  })

  test('40-opening stress scene splits sheets cleanly, numbering contiguous', () => {
    const walls: WallSlice[] = []
    for (let i = 0; i < 5; i++) {
      const os: OpeningSlice[] = []
      for (let k = 0; k < 8; k++) {
        os.push(opening(`o${i}_${k}`, 'window', 2 + k * 5, 1.219, 1.219, 0.9, 1.27, 1.27))
      }
      walls.push(bwall(`w${i}`, [0, i * 3], [40, i * 3], os))
    }
    const members = frameWalls(walls, spec400)
    const sheets = buildPlanSet(members, [], { walls })
    const sched = schedSheetsOf(sheets)
    expect(sched.length).toBeGreaterThanOrEqual(2)
    // page titles carry (p/N) and the global SHEET numbers run consecutive
    for (const [p, s] of sched.entries()) {
      expect(s.title).toBe(`Door + window schedule (${p + 1}/${sched.length})`)
    }
    const sheetNos = sched.map((s) => Number(s.svg.match(/SHEET (\d+)\//)?.[1]))
    for (let i = 1; i < sheetNos.length; i++) {
      expect(sheetNos[i]).toBe((sheetNos[i - 1] as number) + 1)
    }
    // every mark W1…W40 exactly once across the pages; each page repeats the
    // column header and keeps rows above the title block
    const all = sched.map((s) => s.svg).join('')
    for (let i = 1; i <= 40; i++) {
      expect([...all.matchAll(new RegExp(`>W${i}</text>`, 'g'))].length).toBe(1)
    }
    for (const s of sched) {
      expect(s.svg).toContain('>MARK</text>')
      for (const { y } of parseMarks(s.svg)) {
        expect(y).toBeLessThan(816 - 76 - 8)
      }
    }
    // census on paper == openings in the scene
    expect(sched.reduce((n, s) => n + parseMarks(s.svg).length, 0)).toBe(40)
    // the wall plan carries all 40 bubbles, pairwise de-collided
    const wallSvg = sheets.find((s) => s.title === 'Wall framing plan')?.svg ?? ''
    const bubbles = parseBubbles(wallSvg)
    expect(bubbles.length).toBe(40)
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const bi = bubbles[i] as { x: number; y: number }
        const bj = bubbles[j] as { x: number; y: number }
        expect(Math.hypot(bi.x - bj.x, bi.y - bj.y)).toBeGreaterThanOrEqual(15)
      }
    }
  })

  test('opening-less scene emits no schedule sheet; paper without the option stays byte-equal', () => {
    const bare = [bwall('w_a', [0, 0], [6, 0], []), bwall('w_b', [0, 3], [6, 3], [])]
    const members = frameWalls(bare, spec400)
    const withWalls = buildPlanSet(members, [], { walls: bare })
    const without = buildPlanSet(members, [], {})
    expect(withWalls.map((s) => s.title)).not.toContain('Door + window schedule')
    // zero openings → the option is inert: sheets byte-equal
    expect(withWalls.map((s) => s.svg)).toEqual(without.map((s) => s.svg))
    // and a scene WITH openings but WITHOUT the option = pre-B21d paper:
    // no schedule sheet, no bubbles (old callers unchanged)
    const { members: m2 } = scene()
    const legacy = buildPlanSet(m2, [], {})
    expect(legacy.map((s) => s.title)).not.toContain('Door + window schedule')
    expect(parseBubbles(legacy.find((s) => s.title === 'Wall framing plan')?.svg ?? '')).toEqual([])
  })

  // ---- closing round: fold × flags (the quality-round-3 overprint class).
  // The row capacities were page-indexed but the flag BUDGET was not: with
  // a one-page takeoff the fold and the bottom-anchored blocks share page 0
  // and the flag block climbed INTO the fold table while the 4-row floor
  // clamped takeoff rows into the flag band. ----

  /** 3 walls × 5 windows = a 17-line foldable table, flag-free rows. */
  const foldScene = (): { walls: WallSlice[]; members: Member[] } => {
    const walls: WallSlice[] = []
    for (let i = 0; i < 3; i++) {
      const os: OpeningSlice[] = []
      for (let k = 0; k < 5; k++) {
        os.push(opening(`f${i}_${k}`, 'window', 2 + k * 3, 1.219, 1.219, 0.9, 1.27, 1.27))
      }
      walls.push(bwall(`wf${i}`, [0, i * 4], [16, i * 4], os))
    }
    return { walls, members: frameWalls(walls, spec400) }
  }
  const warns45 = (): string[] =>
    Array.from({ length: 45 }, (_, i) => `advisory w${i + 1} — verify`)
  /** Kept-flag lines on a schedules sheet (second column, red). */
  const flagYsOf = (svg: string): number[] =>
    [...svg.matchAll(/<text x="(?:528|540)" y="([\d.]+)"[^>]*fill="#a03015"/g)].map((m) =>
      Number(m[1]),
    )
  /** Takeoff/table body texts (non-bold #222 10px) with their column x. */
  const bodyTextsOf = (svg: string): { x: number; y: number }[] =>
    [...svg.matchAll(/<text x="(\d+)" y="(\d+)" font-size="10" font-family[^>]*fill="#222">/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
    )

  test('closing round: fold + one-page takeoff + 45 warnings — flag budget is fold-indexed, zero overprint', () => {
    const { walls, members } = foldScene()
    const sheets = buildPlanSet(members, [], { walls, warnings: warns45() })
    // the corrected budget fits (41 − foldTop 18 − reserve 18 = 5): fold retained
    expect(sheets.map((s) => s.title)).not.toContain('Door + window schedule')
    const schedSheets = sheets.filter((s) => s.title.startsWith('Schedules + takeoff'))
    expect(schedSheets.length).toBe(1) // the defect's premise: ONE takeoff page
    const svg = (schedSheets[0] as { svg: string }).svg
    expect(svg).toContain('>MARK</text>')
    const markYs = parseMarks(svg).map((r) => r.y)
    expect(markYs.length).toBe(15)
    const tableBottom = Math.max(...markYs)
    const flagYs = flagYsOf(svg)
    expect(flagYs.length).toBeGreaterThan(0)
    const flagTop = Math.min(...flagYs)
    // THE DEFECT: the block climbed to y≈258 across table rows at 102..312.
    // Now the flag top sits BELOW the fold bottom with a clear band…
    expect(flagTop).toBeGreaterThan(tableBottom + 10)
    // …takeoff rows sit between the two, and the second column NEVER runs
    // into the flag band (the old 4-row-floor clamp put 3 rows inside it)
    const rows = bodyTextsOf(svg).filter((t) => t.y > tableBottom)
    expect(rows.length).toBeGreaterThan(0)
    for (const t of rows) {
      if (t.x >= 500) expect(t.y).toBeLessThan(flagTop - 10)
    }
    // every one of the 45 warnings still prints exactly once — kept block +
    // pointer + continuation sheets (P4: nothing truncates, nothing hides)
    expect(svg).toContain('more flag')
    expect(sheets.some((s) => s.title.startsWith('Flags (continued'))).toBe(true)
    const all = sheets.map((s) => s.svg).join('')
    for (let i = 1; i <= 45; i++) {
      expect([...all.matchAll(new RegExp(`advisory w${i} — verify`, 'g'))].length).toBe(1)
    }
  })

  test('closing round: fold + MULTI-page takeoff + 45 warnings stays green — flags land on the last page, budget untouched', () => {
    const { walls, members } = foldScene()
    // bulk floor framing drives the takeoff past one page: 10 sizes ×
    // 7 stock-length buckets of joists (+ bd-ft rows) ≈ 80+ rows
    const sizes = ['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '4x6', '4x8', '4x10', '4x12'] as const
    const bulk: Member[] = []
    for (const size of sizes) {
      for (const L of [2, 2.6, 3.2, 3.9, 4.5, 5.2, 5.8]) {
        bulk.push(
          member({
            role: 'joist',
            size,
            dims: [L, 0.235, 0.038],
            length: L,
            sourceId: `bulk_${size}_${L}`,
          }),
        )
      }
    }
    const sheets = buildPlanSet([...members, ...bulk], [], { walls, warnings: warns45() })
    expect(sheets.map((s) => s.title)).not.toContain('Door + window schedule')
    const schedSheets = sheets.filter((s) => s.title.startsWith('Schedules + takeoff'))
    expect(schedSheets.length).toBeGreaterThanOrEqual(2) // the stack's premise
    // fold on page 0 ONLY, census intact, takeoff rows below the table
    const first = (schedSheets[0] as { svg: string }).svg
    expect(first).toContain('>MARK</text>')
    const markYSet = new Set(parseMarks(first).map((r) => r.y))
    expect(markYSet.size).toBe(15)
    const tableBottom = Math.max(...markYSet)
    for (const t of bodyTextsOf(first)) {
      expect(markYSet.has(t.y) || t.y > tableBottom).toBe(true)
    }
    // flags never print on the fold page — they bottom-anchor on the LAST
    // page, where no fold lives, so the UNCORRECTED budget still applies
    // (34 kept + pointer = 35 lines) and the second column stays clear
    expect(first).not.toContain('#a03015')
    const last = (schedSheets[schedSheets.length - 1] as { svg: string }).svg
    expect(last).not.toContain('>MARK</text>')
    const lastFlagYs = flagYsOf(last)
    expect(lastFlagYs.length).toBe(35)
    const lastFlagTop = Math.min(...lastFlagYs)
    for (const t of bodyTextsOf(last)) {
      if (t.x >= 500) expect(t.y).toBeLessThan(lastFlagTop - 10)
    }
    // all 45 warnings print exactly once across the set
    const all = sheets.map((s) => s.svg).join('')
    for (let i = 1; i <= 45; i++) {
      expect([...all.matchAll(new RegExp(`advisory w${i} — verify`, 'g'))].length).toBe(1)
    }
  })

  test('closing round: a page 0 that cannot host fold + blocks REJECTS the fold — dedicated fallback, never overprint', () => {
    // characteristics add ~6 reserve lines: corrected reserve 19 →
    // 41 − foldTop 18 − 19 = 4 < 5 (the 4-row floor would clamp takeoff
    // rows into the flag band) → the escape hatch fires
    const chars: BuildingCharacteristics = {
      floorAreaM2: 40,
      volumeM3: 108,
      envelopeAreaM2: 61.4,
      windowCount: 15,
      windowAreaM2: 22.3,
      doorCount: 0,
      insulation: { climateZone: '2A', wallR: 13, citation: '2021 IECC Table R402.1.3' },
      uaWPerK: 30.1,
      designHeatLossW: 662,
      coolingTonsEstimate: 0.9,
      notes: [],
    }
    const { walls, members } = foldScene()
    const sheets = buildPlanSet(members, [], {
      walls,
      warnings: warns45(),
      characteristics: chars,
    })
    // the schedule falls back to its DEDICATED sheet (never vanishes)…
    expect(sheets.map((s) => s.title)).toContain('Door + window schedule')
    expect(parseMarks(tableSvgOf(sheets)).length).toBe(15)
    // …and the schedules sheet keeps NO fold — blocks own the bottom
    const sched = sheets.find((s) => s.title.startsWith('Schedules + takeoff'))
    expect(sched?.svg ?? '').not.toContain('>MARK</text>')
    expect(sched?.svg ?? '').toContain('BUILDING CHARACTERISTICS')
    // every warning still prints exactly once
    const all = sheets.map((s) => s.svg).join('')
    for (let i = 1; i <= 45; i++) {
      expect([...all.matchAll(new RegExp(`advisory w${i} — verify`, 'g'))].length).toBe(1)
    }
  })

  test('B11: the schedule prints the SNOW-DEEPENED header size — and only in deepened states', () => {
    // one 56\"-RO window: the 70-psf column's 4x8 cap (53\") bites — VT
    // frames a 4x10 where INTL frames a 4x8; the HEADER cell reads the
    // member back, so paper moves EXACTLY where the members do (and the
    // B11 assumption LABEL never leaks into the cell — size verbatim).
    const w56 = bwall('w_hdr', [0, 0], [6, 0], [
      opening('nb', 'window', 3, inches(56) - inches(1.5), 1.0, 0.9, inches(56), 1.0 + inches(1.5)),
    ])
    const composeAt = (
      code: string,
    ): { svg: string; cover: string; sheets: { title: string; svg: string }[]; header: Member } => {
      const spec = applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor(code))
      const members = frameWalls([w56], spec)
      const header = members.find((m) => m.role === 'header') as Member
      expect(header).toBeDefined()
      const sheets = buildPlanSet(members, [], {
        walls: [w56],
        // the panel passes result.spec.headerAssumption (round-2 examiner)
        headerAssumption: spec.headerAssumption,
      })
      const cover = sheets.find((s) => s.title === 'Cover')?.svg ?? ''
      return { svg: tableSvgOf(sheets), cover, sheets, header }
    }
    const vt = composeAt('VT')
    const intl = composeAt('INTL')
    const cellOf = (c: { svg: string; header: Member }): string | null => {
      const y = parseMarks(c.svg)[0]?.y as number
      return cellAt(c.svg, 522, y)
    }
    expect(vt.header.size).toBe('4x10')
    expect(vt.header.label).toContain('Table R602.7(1)')
    expect(cellOf(vt)).toBe('4x10') // the size verbatim — no label leak
    expect(intl.header.size).toBe('4x8')
    expect(cellOf(intl)).toBe('4x8')
    // low-snow paper is byte-equal: TX prints the same sheet as INTL
    const tx = composeAt('TX')
    expect(tx.svg).toBe(intl.svg)
  })

  test('B11 round 2 (examiner): the width assumption reaches PAPER — a cover DESIGN CRITERIA line, deepened states only', () => {
    // Round 1 left the honesty device on member labels alone: nothing on
    // the 18-sheet set said the header sizing assumes ≤ 24 ft building
    // width — exactly what a builder of a wider footprint must read.
    const w56 = bwall('w_hdr', [0, 0], [6, 0], [
      opening('nb', 'window', 3, inches(56) - inches(1.5), 1.0, 0.9, inches(56), 1.0 + inches(1.5)),
    ])
    const sheetsAt = (code: string): { title: string; svg: string }[] => {
      const spec = applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor(code))
      return buildPlanSet(frameWalls([w56], spec), [], {
        walls: [w56],
        headerAssumption: spec.headerAssumption,
      })
    }
    const coverOf = (sheets: { title: string; svg: string }[]): string =>
      sheets.find((s) => s.title === 'Cover')?.svg ?? ''
    const vtCover = coverOf(sheetsAt('VT'))
    expect(vtCover).toContain('DESIGN CRITERIA — headers sized per Table R602.7(1) @ 70 psf ground snow')
    expect(vtCover).toContain('≤ 24 ft building width, roof-and-ceiling loading assumed')
    const mnCover = coverOf(sheetsAt('MN'))
    expect(mnCover).toContain('@ 50 psf ground snow')
    // low-snow covers carry NO line, and the whole low-snow sheet set is
    // byte-equal to one built without the option at all (the pre-round-2
    // paper) — the line prints ONLY when a band applies
    const intlSheets = sheetsAt('INTL')
    expect(coverOf(intlSheets)).not.toContain('DESIGN CRITERIA')
    const spec400 = applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor('INTL'))
    const withoutOption = buildPlanSet(frameWalls([w56], spec400), [], { walls: [w56] })
    expect(intlSheets.map((s) => s.svg)).toEqual(withoutOption.map((s) => s.svg))
  })
})

// ---------------------------------------------------------------------------
// B18 examiner round (paper): honest bolt-spacing legend across door ROs,
// cut-rebar contrast in the section poché, pad-footing legend row.
// ---------------------------------------------------------------------------

describe('B18 paper round — anchorage on paper', () => {
  const garageWall = (): WallSlice => ({
    id: 'w_garage',
    start: [0, 0],
    end: [9, 0],
    dir: [1, 0],
    length: 9,
    thickness: 0.15,
    height: 2.5,
    exterior: true,
    curved: false,
    openings: [
      {
        id: 'gd',
        kind: 'door',
        u: 4.5,
        width: 4.839,
        roughWidth: 4.877,
        height: 2.1,
        roughHeight: 2.15,
        sillHeight: 0,
      },
    ],
  })

  test('FAIL fix: the garage-CA legend prints the per-SECTION max — never the jamb-to-jamb hop across the RO', () => {
    const spec = applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor('CA'))
    const wall = garageWall()
    const members = buildFoundation([wall], [], spec)
    const bolts = members
      .filter((m) => m.role === 'anchor-bolt')
      .map((m) => m.position[0])
      .sort((a, b) => a - b)
    expect(bolts.length).toBeGreaterThan(3)
    // ground truth from the members: the largest gap WITHIN a plate
    // section vs the hop ACROSS the door RO
    const roLo = 4.5 - 4.877 / 2
    const roHi = 4.5 + 4.877 / 2
    let within = 0
    let hop = 0
    for (let i = 1; i < bolts.length; i++) {
      const a = bolts[i - 1] as number
      const b = bolts[i] as number
      if (a <= roLo + 1e-9 && b >= roHi - 1e-9) hop = b - a
      else within = Math.max(within, b - a)
    }
    expect(hop).toBeGreaterThan(spec.anchorBoltSpacing) // the decoy is real
    expect(within).toBeLessThanOrEqual(spec.anchorBoltSpacing + 1e-9) // R403.1.6 honest
    const svg =
      buildPlanSet(members, [], { walls: [wall] }).find((s) => s.title === 'Foundation plan')
        ?.svg ?? ''
    const escQ = (s: string): string => s.replaceAll('"', '&quot;')
    expect(svg).toContain(escQ(`@ ${formatFtIn(within)} o.c. max`))
    expect(svg).not.toContain(escQ(formatFtIn(hop))) // the RO hop never prints
  })

  test('the legacy no-walls path keeps the raw neighbor max (openings unknowable)', () => {
    const spec = applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor('CA'))
    const wall = garageWall()
    const members = buildFoundation([wall], [], spec)
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title === 'Foundation plan')?.svg ?? ''
    expect(svg).toContain('anchor bolts @') // row still prints, underived hop and all
  })

  test('flag 1: cut rebar prints OPEN (white fill, dark stroke) against the concrete poché', () => {
    // A stemwall + the B18c top bar, both crossing the section plane: the
    // bar used to print #222-on-#222 — invisible inside the stemwall rect.
    const members = [
      member({
        system: 'foundation',
        role: 'stemwall',
        size: undefined,
        material: 'concrete',
        dims: [4, 0.6, 0.2],
        position: [2, -0.3, 1],
        rotation: [0, 0, 0],
        label: 'Stemwall 8"',
      }),
      member({
        system: 'foundation',
        role: 'rebar',
        size: undefined,
        material: 'steel',
        dims: [4, 0.0127, 0.0127],
        position: [2, -0.063, 1],
        rotation: [0, 0, 0],
        label: '#4 horizontal — top of stemwall (R403.1.3.1)',
      }),
    ]
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Section A-A'))?.svg ?? ''
    const open = [
      ...svg.matchAll(
        /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#fff" stroke="#222" stroke-width="1.1"\/>/g,
      ),
    ]
    expect(open).toHaveLength(1) // the cut bar — visibly OPEN
    expect(Number(open[0]?.[3])).toBeGreaterThanOrEqual(2.5)
    expect(Number(open[0]?.[4])).toBeGreaterThanOrEqual(2.5)
    // the concrete keeps the dark cut convention beside it
    expect(svg).toMatch(/<rect [^>]*fill="#222"/)
    // …and the symbol is keyed on the sheet (P2)
    expect(svg).toContain('open rects = cut rebar')
  })

  test('flag 2: pad footings key a derived legend row — size + cite + count', () => {
    const pad = (x: number): Member =>
      member({
        system: 'foundation',
        role: 'footing',
        size: undefined,
        material: 'concrete',
        dims: [0.6096, 0.3048, 0.6096],
        length: 0.6096,
        position: [x, -0.1524, 2],
        rotation: [0, 0, 0],
        label: 'Pad footing 24"×24"×12" — girder post (R403.1/R407.3)',
        sourceId: 'slab_up',
      })
    const svg =
      buildPlanSet([pad(2), pad(4.5)], [], {}).find((s) => s.title === 'Foundation plan')?.svg ??
      ''
    expect(svg).toContain('post pad 24&quot;×24&quot;×12&quot; — under girder posts (R403.1/R407.3) — 2 pcs')
    // a CLIPPED pad (F3) books its own row at its true size
    const clipped = member({
      system: 'foundation',
      role: 'footing',
      size: undefined,
      material: 'concrete',
      dims: [0.5842, 0.3048, 0.5842],
      length: 0.5842,
      position: [6, -0.1524, 2],
      rotation: [0, 0, 0],
      label: 'Pad footing 23"×23"×12" — girder post (R403.1/R407.3)',
      sourceId: 'slab_up',
    })
    const svg2 =
      buildPlanSet([pad(2), clipped], [], {}).find((s) => s.title === 'Foundation plan')?.svg ??
      ''
    expect(svg2).toContain('post pad 23&quot;×23&quot;×12&quot;')
    expect(svg2).toContain('post pad 24&quot;×24&quot;×12&quot;')
  })
})

describe('B14 device tags — counter/basin/outdoor boxes read distinctly on paper (examiner round 2)', () => {
  const wire = member({
    system: 'electrical',
    role: 'wire-run',
    size: undefined,
    material: 'copper',
    dims: [2, 0.013, 0.013],
    label: 'NM-B 12/2 w/G — SA-1',
    sourceId: 'SA-1',
  })

  test('GC (44") / GB (40") / WR bubbles print with their own legend rows — never plain G', () => {
    const fixtures = [
      fixture({ kind: 'receptacle-gfci', position: [1, 1.12, 0], meta: { counter: true } }),
      fixture({ kind: 'receptacle-gfci', position: [3, 1.02, 0], meta: { basin: true } }),
      fixture({ kind: 'receptacle-wr-gfci', position: [5, 0.38, 0], meta: { wr: true } }),
      fixture({ kind: 'receptacle-gfci', position: [7, 0.38, 0] }), // 15" wall-line GFCI
    ]
    const elec =
      buildPlanSet([wire], fixtures, {}).find((s) => s.title.startsWith('Electrical'))?.svg ?? ''
    expect(elec).toContain('>GC</text>')
    expect(elec).toContain('>GB</text>')
    expect(elec).toContain('>WR</text>')
    expect(elec).toContain('>G</text>') // the wall-line box keeps plain G
    // legend rows name the heights so the rough-in reads right
    expect(elec).toContain('44&quot; AFF (210.52(C))')
    expect(elec).toContain('40&quot; AFF (210.52(D))')
    expect(elec).toContain('in-use cover (406.9(B))')
  })

  test('a counter box plan-stacked over a wall-line box keeps BOTH bubbles (tag-keyed dedupe)', () => {
    const fixtures = [
      fixture({ kind: 'receptacle-gfci', position: [1, 0.38, 0] }),
      fixture({ kind: 'receptacle-gfci', position: [1, 1.12, 0], meta: { counter: true } }),
    ]
    const elec =
      buildPlanSet([wire], fixtures, {}).find((s) => s.title.startsWith('Electrical'))?.svg ?? ''
    expect(elec).toContain('>G</text>')
    expect(elec).toContain('>GC</text>')
  })

  test('EXT-1 legend row prints the family hint and the non-copper swatch (E3)', () => {
    const extWire = member({
      system: 'electrical',
      role: 'wire-run',
      size: undefined,
      material: 'copper',
      dims: [2, 0.013, 0.013],
      label: 'NM-B 12/2 w/G — EXT-1',
      sourceId: 'EXT-1',
    })
    const fixtures = [
      fixture({
        kind: 'receptacle-wr-gfci',
        meta: { circuit: 'EXT-1', breakerA: 20, gaugeAwg: 12, wr: true },
      }),
    ]
    const elec =
      buildPlanSet([extWire], fixtures, {}).find((s) => s.title.startsWith('Electrical'))?.svg ?? ''
    const { circuitColor } = require('./circuit-colors') as typeof import('./circuit-colors')
    expect(elec).toContain('outdoor receptacles (WR GFCI, 210.52(E))')
    expect(elec).not.toContain('ext-1')
    expect(elec).toContain(circuitColor('EXT-1'))
    expect(circuitColor('EXT-1')).not.toBe('#b0723d')
  })
})

// ---------------------------------------------------------------------------
// B6 fix F1 — roll-aware plan projection + bounds; deck paper treatment
// ---------------------------------------------------------------------------

import { frameRoofs, type RoofSegmentSlice } from '../engines/roof-framing'

describe('B6 fix F1 — rolled plates foreshorten on plan; deck is layer-0 translucent; roof legend rows', () => {
  const at400 = { ...DEFAULT_SPEC, detail: '400' as const }
  const roofSeg = (over: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice => ({
    id: 'roofseg_f1',
    roofType: 'gable',
    position: [4, 2.5, 3],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...over,
  })
  const roofMembers = frameRoofs([roofSeg()], [], at400)
  const roofSvg = (members: Member[]): string =>
    buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Roof'))?.svg ?? ''

  test('printed deck extent == the TRUE plan band, foreshortened by cos(roll) — no eave spill, no ridge overlap', () => {
    const svg = roofSvg(roofMembers)
    // the deck rects are the only translucent shapes on the roof sheet
    const deckRects = [...svg.matchAll(
      /<rect x="[^"]*" y="[^"]*" width="([\d.]+)" height="([\d.]+)"[^>]*fill-opacity="0\.35"[^>]*translate\(([\d.-]+) ([\d.-]+)\)/g,
    )]
    expect(deckRects).toHaveLength(2) // one per slope — the membrane is NOT drawn
    // recover the shared scale from the ridge rect (unrolled, known length)
    const ridge = roofMembers.find((m) => m.role === 'ridge') as Member
    const ridgeM = svg.match(
      /<rect x="[^"]*" y="[^"]*" width="([\d.]+)" height="[\d.]+"[^>]*fill="#b98d4f"[^>]*translate\(([\d.-]+) ([\d.-]+)\)/,
    )
    expect(ridgeM).not.toBeNull()
    const scale = Number(ridgeM?.[1]) / ridge.dims[0]
    const ridgeTz = Number(ridgeM?.[3])
    const theta = (40 * Math.PI) / 180
    for (const r of deckRects) {
      const hPx = Number(r[2])
      const tz = Number(r[4])
      const deck = roofMembers
        .filter((m) => m.role === 'sheathing')
        .find((m) => Math.sign(m.position[2] - 3) === Math.sign(tz - ridgeTz)) as Member
      // height == slope width FORESHORTENED (was drawn raw: 0.53 m past the
      // eave + 1.06 m of ridge overlap on this exact geometry)
      expect(hPx).toBeCloseTo(deck.dims[2] * Math.cos(theta) * scale, 0)
      // the band's plan center is the member's plan position
      expect((tz - ridgeTz) / scale).toBeCloseTo(deck.position[2] - 3, 1)
      // no ridge overlap: the uphill edge stays on its own side of the ridge
      expect(Math.abs(tz - ridgeTz) - hPx / 2).toBeGreaterThan(-0.101) // ≥ 0 at 0.1px rounding
      // no eave spill: downhill edge stays inside the rafter tip line
      const tip = 3 + 0.3 * Math.cos(theta) // run + overhang·cosθ
      expect((Math.abs(tz - ridgeTz) + hPx / 2) / scale).toBeLessThanOrEqual(tip + 0.01)
    }
  })

  test('deck strips draw FIRST (layer 0): every structural stroke paints over them', () => {
    const svg = roofSvg(roofMembers)
    const lastDeck = svg.lastIndexOf('fill-opacity="0.35"')
    // every structural member rect strokes '#444' (the deck's hairline is
    // '#cfc4a6') — ALL of them must paint after the last deck strip
    const firstStructural = svg.indexOf('stroke="#444"')
    expect(lastDeck).toBeGreaterThan(-1)
    expect(firstStructural).toBeGreaterThan(lastDeck)
  })

  test('the SHARED sheet transform is byte-stable when the roof package lands (F1b)', () => {
    // wall + roof compose: adding deck/underlayment/drip must not move any
    // OTHER sheet by a single 0.1 px — the round-1 examiner measured a
    // uniform 16.1 px shift on foundation/electrical from the roll-blind
    // bounds.
    const walls = frameWalls(
      [
        {
          id: 'w1',
          start: [0, 0] as [number, number],
          end: [8, 0] as [number, number],
          dir: [1, 0] as [number, number],
          length: 8,
          thickness: 0.15,
          height: 2.5,
          openings: [],
          exterior: true,
        } as unknown as WallSlice,
      ],
      at400,
    )
    // the COMPOSE matters: on a yawed wing the legacy euler arithmetic
    // garbles a rolled panel's extents (±0.37 m on this scene) — a plain
    // gable's deck hides inside the rafters' own legacy over-reach
    const compose = frameRoofs(
      [
        roofSeg({ width: 10, depth: 12 }),
        roofSeg({ id: 'wing_b', width: 4, depth: 4, yaw: Math.PI / 2, position: [5, 2.5, 8] }),
      ],
      [],
      at400,
    )
    const stripped = compose.filter(
      (m) => !(m.role === 'sheathing' || m.role === 'wrb' || m.role === 'drip-edge'),
    )
    // the FOUNDATION sheet is the pure-transform witness (the wall plan
    // also carries the A-A cut mark, whose slide is legitimately
    // content-dependent — sectionCutX dodges parallel members, deck
    // included)
    const footing = member({
      system: 'foundation',
      role: 'footing',
      size: undefined,
      material: 'concrete',
      dims: [4, 0.2, 0.4],
      position: [4, -0.3, 3],
    })
    const fullSheets = buildPlanSet([...walls, footing, ...compose], [], {})
    const strippedSheets = buildPlanSet([...walls, footing, ...stripped], [], {})
    const pick = (sheets: { title: string; svg: string }[], t: string) =>
      sheets.find((s) => s.title.startsWith(t))?.svg
    expect(pick(fullSheets, 'Foundation')).toBeDefined()
    expect(pick(fullSheets, 'Foundation')).toBe(pick(strippedSheets, 'Foundation') as string)
  })

  test('roof legend: deck/underlayment/drip rows print (13-row cap holds on a compose-grade sheet)', () => {
    // gable big enough for the purlin fix + a crossing wing: 9 sized roles
    // + the 3 size-less B6 rows — the old 10-cap dropped what it just added
    const compose = frameRoofs(
      [
        roofSeg({ width: 10, depth: 12 }),
        roofSeg({ id: 'wing_f1', width: 4, depth: 4, yaw: Math.PI / 2, position: [5, 2.5, 8] }),
      ],
      [],
      at400,
    )
    const svg = roofSvg(compose)
    expect(svg).toContain('sheathing — 7/16&quot; WSP roof deck (R803.2), drawn translucent')
    expect(svg).toContain('wrb — roof underlayment under covering (R905.1.1) — not drawn')
    expect(svg).toContain('drip-edge — drip edge — eave/rake metal (R905.2.8.5)')
    // the sized roles the same sheet must keep naming
    for (const role of ['rafter', 'ridge', 'ceiling-joist', 'valley', 'jack-rafter', 'post']) {
      expect(svg).toContain(`${role} — 2x`)
    }
  })

  test('the roof rows never leak onto the WALL sheet legend (role names collide)', () => {
    const wall = member({
      system: 'wall-framing',
      role: 'sheathing',
      size: undefined,
      dims: [3, 2.4, 0.011],
      length: 3,
      material: 'lumber',
    })
    const svg =
      buildPlanSet([wall, member({ system: 'wall-framing', role: 'stud', size: '2x4' })], [], {}).find(
        (s) => s.title.startsWith('Wall'),
      )?.svg ?? ''
    expect(svg).not.toContain('WSP roof deck')
  })
})

describe('B6 fix F5 — the section cuts a rolled plate as its TRUE sloped band, never a horizontal chord', () => {
  const at400 = { ...DEFAULT_SPEC, detail: '400' as const }
  const roofSeg = (over: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice => ({
    id: 'roofseg_f5',
    roofType: 'gable',
    position: [4, 2.5, 3],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...over,
  })

  test('deck poché rects rotate with the roll; no wide UN-rotated dark chord survives', () => {
    const members = frameRoofs([roofSeg()], [], at400)
    const svg =
      buildPlanSet(members, [], {}).find((s) => s.title.startsWith('Section'))?.svg ?? ''
    // the two slope panels cut as ±40°-rotated thin bands
    const rotated = [...svg.matchAll(/<rect [^>]*fill="#222"[^>]*rotate\((-?40\.00)\)"\/>/g)]
    expect(rotated.length).toBeGreaterThanOrEqual(2)
    expect(new Set(rotated.map((r) => r[1])).size).toBe(2) // both slopes, both signs
    // …and every plain axis-aligned dark rect stays a plausible stick
    // cross-section: the pre-fix chord printed the FULL slope width
    // (dims[2] ≈ 4.2 m) as one horizontal bar — nothing axis-aligned may
    // come near that class. Bound: half the rotated band's length.
    const bandPx = Math.max(
      ...rotated.map((r) => Number((r[0].match(/width="([\d.]+)"/) ?? [])[1])),
    )
    for (const m of svg.matchAll(/<rect x="[^"]*" y="[^"]*" width="([\d.]+)"[^>]*fill="#222"(?![^>]*rotate)/g)) {
      expect(Number(m[1])).toBeLessThan(bandPx / 2)
    }
  })
})

// ---------------------------------------------------------------------------
// NIGHT-10 — plan-set legend grammar for surface-steel hardware (the paper
// debt B9/B10/B12 examiners each flagged: unkeyed hardware ink) + the C5
// LOD-200 areas-fallback takeoff rows.
// ---------------------------------------------------------------------------

describe('NIGHT-10 — keyed hardware glyphs + derived legend rows (B9/B10 debt)', () => {
  // Exact glyph markup pins (content-addressed: the legend swatch must key
  // the SAME symbol the plan draws — P2. A drift in either side fails here.)
  const GLYPH = {
    strap: '<path d="M0 -3 L3 0 L0 3 L-3 0 Z" fill="#444"/>',
    'uplift-strap':
      '<path d="M0 -3.4 L3.4 0 L0 3.4 L-3.4 0 Z" fill="none" stroke="#444" stroke-width="0.9"/>',
    'uplift-connector':
      '<path d="M0 -3.6 L3.2 2.6 L-3.2 2.6 Z" fill="none" stroke="#444" stroke-width="0.9"/>',
    'foundation-strap': '<path d="M0 3.4 L3 -2.4 L-3 -2.4 Z" fill="#444"/>',
    'hold-down': '<rect x="-2.5" y="-2.5" width="5" height="5" fill="#444"/>',
    'portal-post':
      '<rect x="-3.5" y="-3.5" width="7" height="7" fill="none" stroke="#444" stroke-width="0.9"/>',
  } as const
  /** Plan-area ink only — everything before the chrome border, so the
   * legend swatches (which reuse the exact glyph markup) never inflate a
   * census. */
  const drawingOf = (svg: string): string => svg.slice(0, svg.indexOf('<rect x="8" y="8"'))
  /** Drawn glyph spots of one kind: translate coords in the plan area. */
  const glyphSpots = (svg: string, kind: keyof typeof GLYPH): { x: number; y: number }[] =>
    [
      ...drawingOf(svg).matchAll(
        new RegExp(
          `<g transform="translate\\((-?[\\d.]+) (-?[\\d.]+)\\)">${GLYPH[kind].replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}</g>`,
          'g',
        ),
      ),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
  const wall = (
    id: string,
    start: [number, number],
    end: [number, number],
    openings: WallSlice['openings'] = [],
  ): WallSlice => {
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    return {
      id,
      start,
      end,
      dir: [dx / length, dz / length],
      length,
      thickness: 0.15,
      height: 2.5,
      exterior: true,
      curved: false,
      openings,
    }
  }
  const T2 = 0.038
  /** Garage front: 16-ft door RO centered — both returns take the CS-PF
   * portal set on SDC-D (the B9 exhibit). */
  const garage = (): WallSlice =>
    wall('garage_front', [0, 0], [6.1, 0], [
      {
        id: 'gd',
        kind: 'door',
        u: 3.05,
        width: feet(16) - T2,
        height: 2.13,
        sillHeight: 0,
        roughWidth: feet(16),
        roughHeight: 2.13 + T2,
      },
    ])
  const caSpec = () =>
    applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor('CA'))
  const laSpec = () =>
    applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor('LA'))
  const sheetOf = (sheets: { title: string; svg: string }[], title: string): string =>
    sheets.find((s) => s.title === title)?.svg ?? ''
  const legendTexts = (svg: string): string =>
    [...svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join(' | ')
  /** Independent fit of the ONE shared set transform (P1) from the
   * anchor-bolt dots on the foundation sheet — the dots draw at their
   * TRUE member positions, so min/max extremes pair up under the
   * monotonic map. Lets the gates check glyphs on ANY sheet against
   * member positions without re-implementing planBounds. */
  const fitTransform = (
    fndSvg: string,
    bolts: Member[],
  ): { X: (x: number) => number; Z: (z: number) => number } => {
    const dots = [
      ...drawingOf(fndSvg).matchAll(
        /<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="2\.2" fill="#444"\/>/g,
      ),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    expect(dots).toHaveLength(bolts.length)
    const xs = bolts.map((b) => b.position[0])
    const zs = bolts.map((b) => b.position[2])
    const px = dots.map((d) => d.x)
    const py = dots.map((d) => d.y)
    const scaleX = (Math.max(...px) - Math.min(...px)) / (Math.max(...xs) - Math.min(...xs))
    const scaleZ = (Math.max(...py) - Math.min(...py)) / (Math.max(...zs) - Math.min(...zs))
    const ox = Math.min(...px) - Math.min(...xs) * scaleX
    const oz = Math.min(...py) - Math.min(...zs) * scaleZ
    return { X: (x) => ox + x * scaleX, Z: (z) => oz + z * scaleZ }
  }
  /** Every member of `group` has a drawn glyph within the deterministic
   * dodge budget (ring max 12 px + 0.1 px coordinate rounding + fit
   * slack) of its TRUE projected position — symbols never wander. */
  const anchoredToTruth = (
    spots: { x: number; y: number }[],
    group: Member[],
    t: { X: (x: number) => number; Z: (z: number) => number },
  ): void => {
    for (const m of group) {
      const gx = t.X(m.position[0])
      const gy = t.Z(m.position[2])
      const d = Math.min(...spots.map((s) => Math.hypot(s.x - gx, s.y - gy)))
      expect(d).toBeLessThanOrEqual(12.6)
    }
  }

  test('CA-seismic compose: portal strap + post censuses match; rows derive label + cite; the roleSizes post accident is gone', () => {
    const walls = [garage(), wall('w_side', [0, 0], [0, 5])]
    const members = [
      ...frameWalls(walls, caSpec(), undefined, { slabBearing: true }),
      ...buildFoundation(walls, [], caSpec()),
    ]
    const straps = members.filter((m) => m.role === 'strap')
    const posts = members.filter(
      (m) => m.role === 'post' && (m.label ?? '').includes('R602.10.6.4'),
    )
    expect(straps.length).toBe(2) // the exhibit is real: both returns portal
    expect(posts.length).toBe(4)
    const sheets = buildPlanSet(members, [], { walls })
    const svg = sheetOf(sheets, 'Wall framing plan')
    // symbol census == member census per role (a glyph must ALWAYS print)
    expect(glyphSpots(svg, 'strap')).toHaveLength(straps.length)
    expect(glyphSpots(svg, 'portal-post')).toHaveLength(posts.length)
    // each glyph sits at (or within the deterministic dodge ring of) its
    // member's TRUE plan position — transform fit independently from the
    // foundation sheet's bolt dots (P1: one transform for the whole set)
    const t = fitTransform(
      sheetOf(sheets, 'Foundation plan'),
      members.filter((m) => m.role === 'anchor-bolt'),
    )
    anchoredToTruth(glyphSpots(svg, 'strap'), straps, t)
    anchoredToTruth(glyphSpots(svg, 'portal-post'), posts, t)
    // legend rows: keyed swatch + derived name/cite/count (P2 — pulled
    // from the member labels, never hardcoded)
    expect(svg).toContain(esc2('Portal strap 1000 lb (CS-PF, R602.10.6.4) — 2 pcs'))
    expect(svg).toContain(esc2('Portal hold-down post (doubled 2x6) — R602.10.6.4 — 4 pcs'))
    // the swatch in the legend uses the SAME markup as the plan glyph
    expect(svg.split(GLYPH.strap).length - 1).toBe(straps.length + 1) // plan + 1 key
    expect(svg.split(GLYPH['portal-post']).length - 1).toBe(posts.length + 1)
    // the accidental generic roleSizes row is replaced by the keyed row
    expect(legendTexts(svg)).not.toContain('post — 2x6')
    // posts are real lumber: their rects still draw at the post positions
    // (the open square is a MARKER over the stick, not a replacement)
    for (const p of posts) {
      const rx = t.X(p.position[0])
      const rects = [
        ...drawingOf(svg).matchAll(/<rect [^>]*transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g),
      ].map((m) => Number(m[1]))
      expect(rects.some((x) => Math.abs(x - rx) <= 1.5)).toBe(true)
    }
  })

  test('CA-seismic foundation sheet: HDU squares keyed + de-collided against the bolt-dot registry (crowded sheet)', () => {
    const walls = [garage(), wall('w_side', [0, 0], [0, 5])]
    const members = buildFoundation(walls, [], caSpec())
    const hdus = members.filter((m) => m.role === 'hold-down')
    expect(hdus.length).toBeGreaterThanOrEqual(4)
    const svg = sheetOf(buildPlanSet(members, [], { walls }), 'Foundation plan')
    const spots = glyphSpots(svg, 'hold-down')
    expect(spots).toHaveLength(hdus.length) // census
    expect(svg).toContain(esc2(`HDU hold-down — ${hdus.length} pcs`)) // keyed row
    // de-collision: every HDU glyph clears every anchor-bolt dot and every
    // other glyph (the seismic plate line packs bolts @4 ft + HDUs at both
    // wall ends) — and no crowded fallback was needed
    const dots = [
      ...drawingOf(svg).matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="2\.2" fill="#444"\/>/g),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    expect(dots.length).toBeGreaterThan(4) // the bolt field is really there
    for (const s of spots) {
      for (const q of [...dots, ...spots]) {
        const d = Math.hypot(s.x - q.x, s.y - q.y)
        if (d > 0) expect(d).toBeGreaterThanOrEqual(6.8) // 7 px clear − 0.1 px rounding
      }
    }
    expect(drawingOf(svg)).not.toContain('hardware-glyph crowded')
    // …and each glyph stays within the deterministic dodge ring of its
    // true member position (symbols never wander)
    const t = fitTransform(svg, members.filter((m) => m.role === 'anchor-bolt'))
    anchoredToTruth(spots, hdus, t)
  })

  test('LA-windy compose: all three uplift roles census 1:1, de-collide at plan-coincident spots, and key with WFCM cites', () => {
    const walls = [
      wall('w_s', [0, 0], [8, 0], [
        {
          id: 'd1',
          kind: 'door',
          u: 2,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
          roughWidth: 0.938,
          roughHeight: 2.138,
        },
        {
          id: 'w1',
          kind: 'window',
          u: 5.5,
          width: 1.2,
          height: 1.2,
          sillHeight: 0.9,
          roughWidth: 1.238,
          roughHeight: 1.238,
        },
      ]),
      wall('w_e', [8, 0], [8, 6]),
    ]
    const members = [
      ...frameWalls(walls, laSpec(), undefined, { slabBearing: true }),
      // foundation members join the compose so the bolt dots pin the
      // shared transform (P1) for the truth-anchoring check below
      ...buildFoundation(walls, [], laSpec()),
    ]
    const byRole = (role: string) => members.filter((m) => m.role === role)
    expect(byRole('uplift-strap').length).toBeGreaterThan(0)
    expect(byRole('uplift-connector').length).toBeGreaterThan(20)
    expect(byRole('foundation-strap').length).toBeGreaterThan(5)
    const sheets = buildPlanSet(members, [], { walls })
    const svg = sheetOf(sheets, 'Wall framing plan')
    const spotsByKind = {
      'uplift-strap': glyphSpots(svg, 'uplift-strap'),
      'uplift-connector': glyphSpots(svg, 'uplift-connector'),
      'foundation-strap': glyphSpots(svg, 'foundation-strap'),
    }
    // census per role
    expect(spotsByKind['uplift-strap']).toHaveLength(byRole('uplift-strap').length)
    expect(spotsByKind['uplift-connector']).toHaveLength(byRole('uplift-connector').length)
    expect(spotsByKind['foundation-strap']).toHaveLength(byRole('foundation-strap').length)
    // the coincidence exhibit is REAL: plan projection collapses height, so
    // a stud-top connector and a plate-line foundation strap share a u —
    // at least one pair of members is plan-coincident within a glyph body
    const planCoincident = byRole('uplift-connector').some((c) =>
      byRole('foundation-strap').some(
        (f) => Math.hypot(c.position[0] - f.position[0], c.position[2] - f.position[2]) < 0.02,
      ),
    )
    expect(planCoincident).toBe(true)
    // …and every DRAWN glyph still clears every other by the 7 px budget
    const all = Object.values(spotsByKind).flat()
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i] as { x: number; y: number }
        const b = all[j] as { x: number; y: number }
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(6.8)
      }
    }
    expect(drawingOf(svg)).not.toContain('hardware-glyph crowded')
    // every drawn glyph anchors to its true member spot (dodges ≤ ring)
    const t = fitTransform(
      sheetOf(sheets, 'Foundation plan'),
      members.filter((m) => m.role === 'anchor-bolt'),
    )
    for (const [kind, role] of [
      ['uplift-strap', 'uplift-strap'],
      ['uplift-connector', 'uplift-connector'],
      ['foundation-strap', 'foundation-strap'],
    ] as const) {
      anchoredToTruth(spotsByKind[kind], byRole(role), t)
    }
    // legend rows: per-opening strap variants book separately (the
    // pad-footing per-size precedent), cites pulled from labels
    expect(svg).toContain(esc2('Header uplift strap over door (WFCM)'))
    expect(svg).toContain(esc2('Header uplift strap over window (WFCM)'))
    expect(svg).toContain(esc2('Stud-to-plate connector (R802.11 path / WFCM)'))
    expect(svg).toContain(
      esc2(`Plate-to-foundation uplift strap (WFCM) — ${byRole('foundation-strap').length} pcs`),
    )
  })

  test('hardware-free paper carries ZERO new ink (INTL-class scenes stay byte-equal)', () => {
    // an INTL compose has no straps / HDUs / uplift steel — none of the
    // glyph markup nor any hardware legend row may appear on ANY sheet
    const walls = [garage(), wall('w_side', [0, 0], [0, 5])]
    const spec = applyJurisdiction({ ...DEFAULT_SPEC, detail: '400' as const }, profileFor('INTL'))
    const members = [
      ...frameWalls(walls, spec, undefined, { slabBearing: true }),
      ...buildFoundation(walls, [], spec),
    ]
    expect(
      members.some((m) =>
        ['strap', 'uplift-strap', 'uplift-connector', 'foundation-strap', 'hold-down'].includes(
          m.role,
        ),
      ),
    ).toBe(false)
    for (const sheet of buildPlanSet(members, [], { walls })) {
      for (const markup of Object.values(GLYPH)) {
        expect(sheet.svg).not.toContain(markup)
      }
      expect(sheet.svg).not.toContain('hardware-glyph crowded')
    }
  })
})

describe('NIGHT-10 — LOD-200 paper books the areas-fallback takeoff rows (C5, B21e)', () => {
  const scene = (): Record<string, Record<string, unknown>> => ({
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_a: {
      id: 'w_a',
      type: 'wall',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      thickness: 0.15,
      height: 2.5,
      frontSide: 'exterior',
      children: [],
    },
    w_b: {
      id: 'w_b',
      type: 'wall',
      parentId: 'level_1',
      start: [0, 0],
      end: [0, 4],
      thickness: 0.15,
      height: 2.5,
      frontSide: 'exterior',
      children: [],
    },
  })
  const compute200 = () => {
    const { computeLevel } = require('../framing/compute') as typeof import('../framing/compute')
    const { FramingNode } = require('../framing/schema') as typeof import('../framing/schema')
    const config = {
      ...FramingNode.parse({ jurisdiction: 'INTL', detail: '200' }),
      parentId: 'level_1',
    } as Parameters<typeof computeLevel>[1]
    const r = computeLevel(scene(), config)
    if (!r) throw new Error('computeLevel returned null')
    return r
  }
  const allSchedText = (sheets: { title: string; svg: string }[]): string =>
    sheets
      .filter((s) => s.title.startsWith('Schedules'))
      .flatMap((s) => [...s.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => unesc2(m[1] as string)))
      .join(' ')

  test('the sheet books the SAME rows as the panel call — one source of truth', () => {
    const { computeTakeoff } = require('../engines/takeoff') as typeof import('../engines/takeoff')
    const r = compute200()
    // the fallback is live: LOD-200 frames no wall layers, areas are real
    expect((r.areas.wallSheathingM2 ?? 0)).toBeGreaterThan(0)
    expect(r.members.some((m) => m.role === 'sheathing' && m.system === 'wall-framing')).toBe(false)
    const panelRows = computeTakeoff(r.members, r.fixtures, r.areas)
    const fallback = panelRows.filter((row) => row.section === 'Sheathing')
    expect(fallback.map((row) => row.item)).toContain('Wall sheathing 7/16" WSP')
    expect(fallback.map((row) => row.item)).toContain('Drywall 1/2"')
    const sheets = buildPlanSet(r.members, r.fixtures, { areas: r.areas })
    const text = allSchedText(sheets)
    // EVERY panel row prints — the exact composed row string, wrap-safe
    for (const row of panelRows.filter((row) => row.section !== 'Flags')) {
      const detail = row.detail && row.detail !== 'linear feet' ? ` (${row.detail})` : ''
      expect(text).toContain(`${row.section} · ${row.item} — ${row.quantity} ${row.unit}${detail}`)
    }
  })

  test('without areas the fallback rows stay off paper (pre-NIGHT-10 behavior, callers unchanged)', () => {
    const r = compute200()
    const text = allSchedText(buildPlanSet(r.members, r.fixtures, {}))
    expect(text).not.toContain('Wall sheathing 7/16" WSP')
    expect(text).not.toContain('Drywall 1/2"')
    // …and an EMPTY areas object is byte-equal to the omitted argument
    const a = buildPlanSet(r.members, r.fixtures, { areas: {} })
    const b = buildPlanSet(r.members, r.fixtures, {})
    expect(a.map((s) => s.svg).join()).toBe(b.map((s) => s.svg).join())
  })
})

/** Local escape twins of plan-set's own (tests pin the ESCAPED strings the
 * sheets actually carry). */
function esc2(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
function unesc2(s: string): string {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

describe('LGS steel walls on paper (Phase 1 round-1 P6)', () => {
  const lgsSpec400 = { ...DEFAULT_SPEC, detail: '400' as const }
  const lgsWall = (openings: OpeningSlice[]): WallSlice => ({
    id: 'w_lgs_paper',
    start: [0, 0],
    end: [8, 0],
    length: 8,
    dir: [1, 0],
    thickness: 0.114,
    height: 2.5,
    exterior: true,
    openings,
    curved: false,
  })
  const lgsOpenings: OpeningSlice[] = [
    { id: 'd1', kind: 'door', u: 2, width: 0.9, height: 2.1, sillHeight: 0, roughWidth: 0.95, roughHeight: 2.15 },
    { id: 'n1', kind: 'window', u: 6, width: 1.2, height: 1.2, sillHeight: 0.9, roughWidth: 1.25, roughHeight: 1.25 },
  ]

  for (const detail of ['400', '200'] as const) {
    test(`schedule HEADER cell prints the steel box assembly at LOD ${detail} — never the dishonest '—'`, () => {
      // Round-1 examiner P6: steel headers EXIST (the R603.6 verify flag
      // from that very member printed on the row below) while the cell
      // fell through (head.size ?? '—') — steel members carry no
      // LumberSize; `profile` is the identity (the CMU bond-beam-as-lintel
      // precedent's exact banned class).
      const spec = { ...lgsSpec400, detail }
      const wall = lgsWall(lgsOpenings)
      const { members } = lgsFrameWalls([wall], spec)
      const headers = members.filter((m) => m.role === 'header')
      expect(headers.length).toBe(2)
      const sheets = buildPlanSet(members, [], { walls: [wall] })
      const tableSvg = sheets.find((s) => s.svg.includes('>MARK</text>'))?.svg ?? ''
      expect(tableSvg.length).toBeGreaterThan(0)
      const text = [...tableSvg.matchAll(/>([^<>]+)<\/text>/g)]
        .map((m) => (m[1] as string).replaceAll('&quot;', '"').replaceAll('&amp;', '&'))
        .join(' ')
      for (const h of headers) {
        expect(text).toContain(`2× ${h.profile} box`)
      }
      // no header cell prints '—' on this all-steel scene (the only '—'
      // cells allowed are the door SILL dashes)
      const headerCol = [...tableSvg.matchAll(/<text x="522" y="\d+"[^>]*>([^<]*)<\/text>/g)].map(
        (m) => m[1],
      )
      // non-vacuous: the column parse found the two data rows (+ the
      // 'HEADER' column heading prints bold at a different pattern)
      expect(headerCol.length).toBeGreaterThanOrEqual(2)
      expect(headerCol.filter((c) => c === '—').length).toBe(0)
    })
  }
})

describe('LGS paper identity (Phase 1 round-1 F3)', () => {
  const spec400f3 = { ...DEFAULT_SPEC, detail: '400' as const }
  const mkWall = (id: string, s: [number, number], e: [number, number]): WallSlice => {
    const dx = e[0] - s[0]
    const dz = e[1] - s[1]
    const length = Math.hypot(dx, dz)
    return {
      id,
      start: s,
      end: e,
      length,
      dir: [dx / length, dz / length],
      thickness: 0.114,
      height: 2.5,
      exterior: true,
      openings: [],
      curved: false,
    }
  }
  const wallSheetOf = (sheets: { key?: string; title: string; svg: string }[]) =>
    sheets.find((sh) => sh.title.toLowerCase().includes('wall'))?.svg ?? ''

  test('all-steel wall sheet: legend keys every drawn steel family (role (LGS) — designator (Gr NN))', () => {
    const walls = [mkWall('a', [0, 0], [6, 0]), mkWall('b', [0, 0], [0, 4])]
    const { members } = lgsFrameWalls(walls, spec400f3)
    const svg = wallSheetOf(buildPlanSet(members, [], { walls }))
    expect(svg.length).toBeGreaterThan(0)
    // the sheet draws 100+ steel members — the legend must name the family
    expect(svg).toContain('stud (LGS) — 350S162-68 (Gr 50)')
    expect(svg).toContain('bottom-plate (LGS) — 350T125-68 (Gr 50)')
    // grade prints ON the set now (F3b)
    expect(svg).toContain('(Gr 50)')
  })

  test('MIXED level: lumber AND steel stud families key as DISTINCT legend rows', () => {
    const steelW = mkWall('w_steel', [0, 0], [6, 0])
    const lumberW = mkWall('w_wood', [0, 0], [0, 4])
    const eng = new Map<string, { construction: 'framed' | 'lgs' }>([
      ['w_steel', { construction: 'lgs' }],
      ['w_wood', { construction: 'framed' }],
    ])
    const members = [
      ...frameWalls([lumberW], spec400f3, eng, { hintWalls: [steelW, lumberW] }),
      ...lgsFrameWalls([steelW], spec400f3, eng, { hintWalls: [steelW, lumberW] }).members,
    ]
    const svg = wallSheetOf(buildPlanSet(members, [], { walls: [steelW, lumberW] }))
    // both families keyed — the steel members are never mislabeled lumber
    expect(svg).toContain('stud (LGS) — 350S162-68 (Gr 50)')
    expect(svg).toMatch(/>stud — 2x4</)
  })

  test('round-2 C: the legend NEVER silently drops a drawn family — the 16-row mixed exhibit keys everything', () => {
    // The slice(0,13) cap re-manifested the F3 failure one round later:
    // 9 lumber + 7 steel rows composed 16, so 'stud (LGS)' / 'king-stud
    // (LGS)' / 'cripple (LGS)' silently dropped and 23/28 drawn steel
    // members were unkeyed beside 'stud — 2x6'. Cap removed — this gate
    // pins every drawn family to a row (a restored cap dies here).
    const openings: OpeningSlice[] = [
      { id: 'd', kind: 'door', u: 2, width: 0.9, height: 2.1, sillHeight: 0, roughWidth: 0.9381, roughHeight: 2.1381 },
      { id: 'w', kind: 'window', u: 5.5, width: 1.2, height: 1.2, sillHeight: 0.9, roughWidth: 1.2381, roughHeight: 1.2381 },
    ]
    const lumberW = { ...mkWall('w_wood', [0, 0], [8, 0]), openings }
    const steelW = { ...mkWall('w_steel', [0, 4], [8, 4]), openings }
    const eng = new Map<string, { construction: 'framed' | 'lgs' }>([
      ['w_wood', { construction: 'framed' }],
      ['w_steel', { construction: 'lgs' }],
    ])
    const members = [
      ...frameWalls([lumberW], spec400f3, eng),
      ...lgsFrameWalls([steelW], spec400f3, eng).members,
    ]
    const svg = wallSheetOf(buildPlanSet(members, [], { walls: [lumberW, steelW] }))
    // every DRAWN family keys a legend row — derived from the members, so
    // the gate can never under-ask (P2)
    const steelRoles = new Set(
      members.filter((m) => m.profile !== undefined).map((m) => m.role as string),
    )
    const lumberRoles = new Set(
      members.filter((m) => m.size !== undefined && m.material !== 'steel').map((m) => m.role as string),
    )
    expect(steelRoles.size + lumberRoles.size).toBeGreaterThan(13) // the cap class is non-vacuous
    for (const role of steelRoles) {
      expect(svg).toMatch(new RegExp(`>${role} \\(LGS\\) — `))
    }
    for (const role of lumberRoles) {
      expect(svg).toMatch(new RegExp(`>${role} — \\dx`)) // 2x4 studs, 4x8 header…
    }
    // the three rows the 13-cap dropped, by name
    expect(svg).toContain('stud (LGS) — ')
    expect(svg).toContain('king-stud (LGS) — ')
    expect(svg).toContain('cripple (LGS) — ')
  })

  test('strap-bracing joined the hardware-glyph grammar: keyed glyphs + derived legend row, no flecks', () => {
    const walls = [mkWall('a', [0, 0], [6, 0])]
    const { members } = lgsFrameWalls(walls, spec400f3)
    const straps = members.filter((m) => m.role === 'strap-bracing')
    expect(straps.length).toBe(4) // 2.5 m wall > 8 ft: third points × both faces
    const svg = wallSheetOf(buildPlanSet(members, [], { walls }))
    // the double-bar glyph draws (per strap) and the legend row derives
    // name + cite from the member label with the count
    expect(svg).toContain('M-3.4 -1.3 H3.4 M-3.4 1.3 H3.4')
    expect(svg).toContain('Strap bracing 1-1/2&quot; × 33 mil (R603.3.3) — 4 pcs')
    // and no generic rect fleck is drawn for the strap role (glyph replaces it)
    const glyphCount = (svg.match(/M-3\.4 -1\.3 H3\.4/g) ?? []).length
    expect(glyphCount).toBeGreaterThanOrEqual(straps.length + 1) // per-mark + legend swatch
  })
})
