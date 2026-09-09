/**
 * Typical details (W12): every callout on the details sheet reads the
 * FRAMED model — the stud, header, rafter and joist sizes the engines
 * placed, the layer thicknesses they laid, the footing and stem they
 * poured — so the sheet re-drafts with the framing and never goes stale.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member } from '../core/types'
import { inches } from '../core/units'
import { frameRoofs, type RoofSegmentSlice } from '../engines/roof-framing'
import {
  DETAILS,
  detailsSheetBodies,
  detailVariables,
  parseFtIn,
  renderDetail,
  scaleLabel,
  stationSpacingIn,
  variablesLine,
} from './details'

const m = (over: Partial<Member>): Member => ({
  system: 'wall-framing',
  role: 'stud',
  size: '2x6',
  dims: [0.038, 2.7, 0.14],
  length: 2.7,
  position: [1, 1.35, 0],
  rotation: [0, 0, 0],
  material: 'lumber',
  sourceId: 'wall_1',
  ...over,
})

/** A framed raised house: 2x6 walls with layers, 4x8 headers, 2x8 rafters at 6:12 with ties, footing + stem + mudsill, a deck on a ledger, a porch shed on a roof ledger. */
function framed(): Member[] {
  const pitch = Math.atan(6 / 12)
  return [
    m({}),
    m({}),
    m({ size: '2x4', dims: [0.038, 2.7, 0.089] }),
    m({ role: 'header', size: '4x8', dims: [1.2, 0.184, 0.089] }),
    m({ role: 'header', size: '4x8', dims: [1.2, 0.184, 0.089] }),
    m({ role: 'header', size: '4x6', dims: [0.9, 0.14, 0.089] }),
    m({
      role: 'sheathing',
      size: undefined,
      material: 'engineered',
      dims: [2.4, 2.7, inches(7 / 16)],
    }),
    m({ role: 'cladding', size: undefined, material: 'lumber', dims: [2.4, 2.7, inches(0.75)] }),
    m({
      role: 'drywall',
      size: undefined,
      material: 'gypsum' as Member['material'],
      dims: [2.4, 2.7, inches(0.5)],
    }),
    m({ role: 'wrb', size: undefined, material: 'pvc', dims: [2.4, 2.7, 0.001] }),
    m({
      system: 'roof-framing',
      role: 'rafter',
      size: '2x8',
      dims: [4, 0.184, 0.038],
      rotation: [0, Math.PI / 2, pitch],
      label: 'Rafter 2x8',
    }),
    m({
      system: 'roof-framing',
      role: 'rafter',
      size: '2x8',
      dims: [4, 0.184, 0.038],
      rotation: [0, -Math.PI / 2, pitch],
      label: 'Rafter 2x8',
    }),
    m({
      system: 'roof-framing',
      role: 'ceiling-joist',
      size: '2x6',
      dims: [6, 0.14, 0.038],
      label: 'Ceiling joist 2x6',
    }),
    m({
      system: 'roof-framing',
      role: 'uplift-connector',
      size: undefined,
      material: 'steel',
      dims: [0.04, 0.06, 0.002],
      label: 'hurricane tie — Simpson H2.5A or equal',
    }),
    m({ system: 'roof-framing', role: 'fascia', size: '2x8', dims: [10, 0.184, 0.038] }),
    m({
      system: 'roof-framing',
      role: 'rafter',
      size: '2x6',
      dims: [2.4, 0.14, 0.038],
      rotation: [0, Math.PI / 2, Math.atan(4 / 12)],
      label: 'Rafter 2x6 (shed, on the ledger)',
    }),
    m({
      system: 'roof-framing',
      role: 'ledger',
      size: '2x6',
      dims: [6, 0.14, 0.038],
      label: 'Porch roof ledger 2x6',
    }),
    m({
      system: 'foundation',
      role: 'footing',
      size: undefined,
      material: 'concrete',
      dims: [10, inches(8), inches(16)],
      label: 'Footing 16"×8"',
    }),
    m({
      system: 'foundation',
      role: 'footing',
      size: undefined,
      material: 'concrete',
      dims: [0.6, inches(12), 0.6],
      label: 'Pad footing 24"×24"×12" — girder post',
    }),
    m({
      system: 'foundation',
      role: 'stemwall',
      size: undefined,
      material: 'concrete',
      dims: [10, 0.6, inches(6)],
      label: 'Stemwall 6" — 18" exposed above grade',
    }),
    m({
      system: 'foundation',
      role: 'mudsill',
      size: '2x6',
      dims: [10, 0.038, inches(5.5)],
      material: 'pt-lumber',
      label: 'Mudsill 5.5" PT',
    }),
    m({
      system: 'floor-framing',
      role: 'ledger',
      size: '2x8',
      dims: [4.8, 0.184, 0.038],
      material: 'pt-lumber',
      sourceId: 'deck',
      label: 'Deck ledger 2x8 PT',
    }),
    m({
      system: 'floor-framing',
      role: 'joist',
      size: '2x8',
      dims: [3.6, 0.184, 0.038],
      material: 'pt-lumber',
      sourceId: 'deck',
      label: 'Deck joist 2x8 PT @ 16" o.c. (R507.6)',
    }),
  ]
}

describe('detailVariables — read from the framed model', () => {
  const v = detailVariables(framed(), DEFAULT_SPEC, { type: 'raised', ffAboveGradeIn: 18 })

  test('the wall: the deepest stud in use, the spec spacing, the layer thicknesses laid', () => {
    expect(v.stud.size).toBe('2x6')
    expect(v.stud.depthIn).toBe(5.5)
    expect(v.stud.spacingIn).toBe(16)
    expect(v.stud.batt).toBe('R-21')
    expect(v.layers.sheathingIn).toBeCloseTo(7 / 16, 3)
    expect(v.layers.claddingIn).toBeCloseTo(0.75, 3)
    expect(v.layers.drywallIn).toBeCloseTo(0.5, 3)
    expect(v.layers.wrb).toBe(true)
  })

  test('the header is the most common one framed; the roof reads the rafter, pitch, joist, ties and fascia', () => {
    expect(v.header?.size).toBe('4x8')
    expect(v.roof?.rafter).toBe('2x8')
    expect(v.roof?.pitchRise).toBe(6)
    expect(v.roof?.ceilingJoist).toBe('2x6')
    expect(v.roof?.ties).toBe(true)
    expect(v.roof?.fascia).toBe(true)
    expect(v.roof?.spacingIn).toBe(Math.round(DEFAULT_SPEC.rafterSpacing / 0.0254))
  })

  test('the foundation reads the footing and stem poured, the exposure from the stem label, the record for the floor height', () => {
    const f = v.foundation!
    expect(f.type).toBe('raised')
    expect(f.footingWIn).toBe(16)
    expect(f.footingHIn).toBe(8)
    expect(f.stemWIn).toBe(6)
    expect(f.stemExposedIn).toBe(18)
    expect(f.ffAboveGradeIn).toBe(18)
    expect(f.mudsillWIn).toBe(5.5)
    expect(f.stepped).toBe(false)
  })

  test('the deck and the porch ledger come from their engines', () => {
    expect(v.deck?.joist).toBe('2x8')
    expect(v.porchLedger?.rafter).toBe('2x6')
  })

  test('a slab house with nothing framed falls back to the spec, no roof, no deck', () => {
    const bare = detailVariables([], DEFAULT_SPEC, null)
    expect(bare.stud.size).toBe(DEFAULT_SPEC.exteriorStudSize)
    expect(bare.roof).toBeNull()
    expect(bare.foundation).toBeNull()
    expect(bare.deck).toBeNull()
    expect(bare.header).toBeNull()
    const stepped = detailVariables(
      [
        m({
          system: 'foundation',
          role: 'footing',
          size: undefined,
          material: 'concrete',
          dims: [4, inches(8), inches(16)],
          label: 'Footing 16"×8" — step 1 of 2',
        }),
        m({
          system: 'foundation',
          role: 'footing',
          size: undefined,
          material: 'concrete',
          dims: [0.2, 0.8, inches(16)],
          label: 'Footing step 22" — stepped footing (R403.1.5)',
        }),
      ],
      DEFAULT_SPEC,
      { type: 'slab', ffAboveGradeIn: 8 },
    )
    expect(stepped.foundation?.type).toBe('slab')
    expect(stepped.foundation?.stepped).toBe(true)
    expect(stepped.foundation?.footingWIn).toBe(16)
  })

  test('parseFtIn reads the label formats the engines print', () => {
    expect(parseFtIn('18"')).toBe(18)
    expect(parseFtIn('17.5"')).toBe(17.5)
    expect(parseFtIn(`1'-6"`)).toBe(18)
    expect(parseFtIn(`2'-0"`)).toBe(24)
    expect(parseFtIn('nothing')).toBeNull()
  })
})

describe('the details sheet', () => {
  const v = detailVariables(framed(), DEFAULT_SPEC, { type: 'raised', ffAboveGradeIn: 18 })
  const frame = { x: 48, y: 62, w: 702, h: 620 }

  test('every registered detail applies to the framed house and draws with its variables in the callouts', () => {
    expect(DETAILS.filter((d) => d.applies(v)).map((d) => d.id)).toEqual([
      'wallsection',
      'foundationdetail',
      'eave',
      'openinghead',
      'deckledger',
      'porchledger',
      'deckguard',
      'stairguard',
      'gableend',
      'fireblock',
      'windowjamb',
    ])
    // the callouts, before the column wraps them (the applying details only —
    // the block details draw nothing for a framed house)
    const notes: Record<string, string> = {}
    for (const d of DETAILS.filter((d) => d.applies(v))) {
      notes[d.id] = d
        .draw(v)
        .notes.map((n) => n.t)
        .join(' | ')
    }
    expect(notes.wallsection).toContain('2X6 STUDS @ 16" O.C. + R-21 BATT')
    expect(notes.openinghead).toContain('HDR 4X8 PER PLAN')
    expect(notes.eave).toContain('RAFTER 2X8 @')
    expect(notes.eave).toContain('6:12')
    expect(notes.eave).toContain('H2.5A')
    expect(notes.foundationdetail).toContain('FTG 16"W × 8"D')
    expect(notes.deckledger).toContain('DECK JOIST 2X8 PT')
    expect(notes.porchledger).toContain('RAFTER 2X6 ON SIMPSON LUS')
    const sheets = detailsSheetBodies(v, frame)
    expect(sheets).toHaveLength(2)
    const body = sheets[0]!.body
    expect(body).toContain('2X6')
    expect(body).toContain('H2.5A')
    expect(body).toContain('6:12')
    // numbered captions 1..6 with a fitted scale
    for (let i = 1; i <= 6; i++) expect(body).toContain(`>${i}</text>`)
    expect(body).toMatch(/SCALE: [\d/-]+&quot; = 1'-0&quot;/)
    expect(sheets[0]!.footer).toContain('studs 2X6 @ 16" o.c.')
    expect(sheets[0]!.footer).not.toContain('footings stepped')
  })

  test('a house with a storage water heater prints the platform, pan and strap detail (2026-09-09)', () => {
    const tank = detailVariables(
      [
        m({}),
        m({ system: 'plumbing', role: 'water-heater', size: undefined, material: 'steel', dims: [0.63, 1.35, 0.63], sourceId: 'wh', label: 'Heat-pump water heater — 65 gal hybrid — UEF ≥ 2 (10 CFR 430.32(d)); on its stand in the garage; M1305.1 30×30" service space' }),
        m({ system: 'plumbing', role: 'water-heater', size: undefined, material: 'steel', dims: [0.55, 0.4, 0.55], sourceId: 'wh-head', label: 'Heat-pump water heater — compressor head' }),
        m({ system: 'plumbing', role: 'equipment', size: undefined, material: 'steel', dims: [0.69, 0.457, 0.69], sourceId: 'wh-stand', label: 'Water-heater stand — ignition source 18" above the garage floor (M1307.3)' }),
      ],
      { ...DEFAULT_SPEC, seismicHoldDowns: true },
      { type: 'slab', ffAboveGradeIn: 8 },
    )
    expect(tank.waterHeater).toEqual({ kind: 'heat-pump', gallons: 65, diaIn: 24.8, heightIn: 68.9, inGarage: true, outside: false, seismic: true })
    const ids = DETAILS.filter((d) => d.applies(tank)).map((d) => d.id)
    expect(ids).toContain('waterheater')
    const notes = DETAILS.find((d) => d.id === 'waterheater')!.draw(tank).notes.map((n) => n.t).join(' | ')
    expect(notes).toContain('65 GAL HEAT-PUMP WATER HEATER')
    expect(notes).toContain('PLATFORM 18"')
    expect(notes).toContain('M1307.3')
    expect(notes).toContain('SEISMIC STRAPS — UPPER & LOWER 1/3')
    expect(notes).toContain('P2801.8')
    expect(notes).toContain('DRAIN PAN')
    expect(notes).toContain('T&P RELIEF VALVE')
    expect(notes).toContain('HEAT-PUMP HEAD')
    // outside, no straps asked: the pad and the enclosure, the strap note conditional; a tankless house draws no detail
    const outside = detailVariables(
      [m({ system: 'plumbing', role: 'water-heater', size: undefined, material: 'steel', dims: [0.56, 1.5, 0.56], sourceId: 'wh', label: 'Electric storage water heater — 50 gal — UEF ≥ 0.92; outside, in a weatherproof enclosure on a 4 in pad' })],
      DEFAULT_SPEC,
      { type: 'slab', ffAboveGradeIn: 8 },
    )
    expect(outside.waterHeater?.outside).toBe(true)
    expect(outside.waterHeater?.inGarage).toBe(false)
    const outNotes = DETAILS.find((d) => d.id === 'waterheater')!.draw(outside).notes.map((n) => n.t).join(' | ')
    expect(outNotes).toContain('PAD 4" CONCRETE')
    expect(outNotes).toContain('WEATHERPROOF')
    expect(outNotes).toContain('WHERE THE JURISDICTION ASKS')
    const tankless = detailVariables(
      [m({ system: 'plumbing', role: 'water-heater', size: undefined, material: 'steel', dims: [0.45, 0.6, 0.25], sourceId: 'wh', label: 'Tankless gas water heater (indoor) — 180–199 kBtu/h; wall-mounted 1.2 m AFF' })],
      DEFAULT_SPEC,
    )
    expect(tankless.waterHeater).toBeNull()
    expect(DETAILS.filter((d) => d.applies(tankless)).map((d) => d.id)).not.toContain('waterheater')
  })
  test('a block house prints the CMU wall section and the CMU eave instead of the framed pair (2026-09-09)', () => {
    const block = detailVariables(
      [
        m({ role: 'block', size: undefined, material: 'concrete', dims: [0.396, 0.1937, 0.1937], label: 'block' }),
        m({ role: 'bond-beam', size: undefined, material: 'concrete', dims: [4, 0.3048 - inches(0.375), 0.1937], label: 'tie beam 12" tall' }),
        m({ system: 'roof-framing', role: 'rafter', size: '2x8', dims: [4, inches(7.25), inches(1.5)], rotation: [0, 0, Math.atan(6 / 12)], label: 'Rafter 2x8' }),
        m({ system: 'roof-framing', role: 'fascia', size: '2x6', dims: [4, inches(5.5), inches(1.5)], label: 'Sub-fascia 2x6' }),
      ],
      DEFAULT_SPEC,
      { type: 'slab', ffAboveGradeIn: 8 },
    )
    expect(block.masonry).toEqual({ blockDepthIn: 7.626, tieBeamIn: 12, vertSpacingIn: 48, lintelBearingIn: 8, furringIn: 0.75, stuccoIn: 0.875 })
    const ids = DETAILS.filter((d) => d.applies(block)).map((d) => d.id)
    expect(ids).toContain('cmuwallsection')
    expect(ids).toContain('cmueave')
    expect(ids).not.toContain('wallsection')
    expect(ids).not.toContain('eave')
    const section = DETAILS.find((d) => d.id === 'cmuwallsection')!.draw(block).notes.map((n) => n.t).join(' | ')
    expect(section).toContain('#5 VERT. @ 48" O.C.')
    expect(section).toContain('TIE BEAM 8" x 12" — 3,000 PSI, 2 #5 TOP & BOTTOM')
    expect(section).toContain('PRECAST LINTELS OVER OPENINGS — 8" BEARING')
    const eave = DETAILS.find((d) => d.id === 'cmueave')!.draw(block).notes.map((n) => n.t).join(' | ')
    expect(eave).toContain('HETA20')
    expect(eave).toContain('BEAR ON TIE BEAM')
  })

  test('a slab house without a roof, deck or windows draws only the wall and foundation details, the slab way', () => {
    const slab = detailVariables(
      [
        m({}),
        m({
          system: 'foundation',
          role: 'footing',
          size: undefined,
          material: 'concrete',
          dims: [4, inches(8), inches(16)],
          label: 'Footing 16"×8"',
        }),
        m({
          system: 'foundation',
          role: 'stemwall',
          size: undefined,
          material: 'concrete',
          dims: [4, 0.3, inches(6)],
          label: 'Stemwall 6" — 8" exposed above grade',
        }),
        m({
          system: 'foundation',
          role: 'slab',
          size: undefined,
          material: 'concrete',
          dims: [4, inches(3.5), 1],
          label: 'Slab',
        }),
      ],
      DEFAULT_SPEC,
      { type: 'slab', ffAboveGradeIn: 8 },
    )
    const sheets = detailsSheetBodies(slab, frame)
    expect(sheets).toHaveLength(1)
    expect(sheets[0]!.count).toBe(3)
    const notes = DETAILS.filter((d) => d.applies(slab)).map((d) =>
      d
        .draw(slab)
        .notes.map((n) => n.t)
        .join(' | '),
    )
    expect(notes[1]).toContain('3-1/2" CONC SLAB — TOP 8" ABV GRADE')
    expect(notes[0]).toContain('PT SOLE PLATE')
    expect(notes[1]).not.toContain('MUDSILL + 5/8')
    expect(variablesLine(slab)).toContain('slab on grade')
  })

  test('a single detail renders self-contained SVG inside its panel', () => {
    const svg = renderDetail(DETAILS[0]!, v, { x: 10, y: 10, w: 300, h: 300 }, 3)
    expect(svg).toContain('<rect x="10.0" y="10.0" width="300.0" height="300.0"')
    expect(svg).toContain('TYPICAL EXTERIOR WALL')
    expect(svg).toContain('>3</text>')
    // nothing draws outside the panel horizontally
    const xs = [...svg.matchAll(/ x="(-?[\d.]+)"/g)].map((r) => Number(r[1]))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...xs)).toBeLessThanOrEqual(310)
  })

  test('the scale label reads as a drafting scale', () => {
    expect(scaleLabel(96 / 12)).toBe(`1" = 1'-0"`)
    expect(scaleLabel(96 / 12 / 2)).toBe(`1/2" = 1'-0"`)
    expect(scaleLabel(96 / 12 / 4)).toBe(`1/4" = 1'-0"`)
    expect(scaleLabel(96 / 12 / 8)).toBe(`1/8" = 1'-0"`)
  })
})

describe('W15: the sheet reads the ceiling-joist spacing off the members', () => {
  const seg = (depth: number): RoofSegmentSlice => ({
    id: 'roofseg_w15',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 10,
    depth,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
  })
  const cjs = (members: Member[]) => members.filter((x) => x.role === 'ceiling-joist')

  test('16" by default; 12" once the roof engine tightened a 22-ft wing — the variables follow', () => {
    const at16 = frameRoofs([seg(6.0)], [], DEFAULT_SPEC)
    expect(stationSpacingIn(cjs(at16))).toBe(16)
    const at12 = frameRoofs([seg(6.71)], [], DEFAULT_SPEC)
    expect(stationSpacingIn(cjs(at12))).toBe(12)
    const v = detailVariables(at12, DEFAULT_SPEC)
    expect(v.roof?.ceilingJoistSpacingIn).toBe(12)
    expect(v.roof?.ceilingJoist).toBe('2x10')
    // too few members to vote → the spec's spacing stands
    expect(stationSpacingIn(cjs(at12).slice(0, 2))).toBeNull()
    expect(detailVariables(at16.slice(0, 0), DEFAULT_SPEC).roof).toBeNull()
  })
})
