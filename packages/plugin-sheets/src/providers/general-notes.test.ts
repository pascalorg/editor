import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FloorplanGeometry } from '@pascal-app/core'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import type { ProviderArgs } from '../drawings'
import type { AnyNodeLike, NodeMap } from '../model'
import { computeAtticVentilation, pitchLabel } from '../notes/attic'
import { plateToSvg } from '../notes/debug-svg'
import { citation, generalNoteSections, noteLine, roofNotes } from '../notes/general'
import { codeHeaderLine, resolveJurisdiction, resolveState } from '../notes/jurisdiction'
import type { PlanSetContext } from '../plans/context'
import { energyPlans, notesPlans } from '../plans/notes-set'
import { DEFAULT_VIEWPORT_LAYERS } from '../schema'
import {
  buildGeneralNotesDrawing,
  columnsFor,
  layoutGeneralNotes,
  measureIn,
} from './general-notes'

const SCENE: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes

/** The drawable field of an ARCH D sheet, less the strip A0.1 reserves. */
const FIELD = { x: 0.6, y: 1.0, w: 31.4, h: 22.2 }

const OUT_DIR =
  'C:/Users/steve/AppData/Local/Temp/claude/C--Dev-Pascal/a595fb05-e3d2-4d5c-afdf-c017ab20e61b/scratchpad'

function args(box: { x: number; y: number; w: number; h: number }, notesKey: string): ProviderArgs {
  return {
    levelId: (Object.values(SCENE).find((n) => n.type === 'level') as AnyNodeLike | undefined)?.id,
    layers: { ...DEFAULT_VIEWPORT_LAYERS },
    notesKey,
    viewport: { ...box, scale: 48 },
  }
}

function textOf(plate: readonly FloorplanGeometry[] | undefined): string {
  return (plate ?? [])
    .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
    .map((g) => g.text)
    .join(' ')
}

/** Only writes when asked, so an ordinary `bun test` never touches disk. */
function eyeball(name: string, plate: readonly FloorplanGeometry[] | undefined): void {
  if (!process.env.PASCAL_SHEET_SVG) return
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/${name}.svg`, plateToSvg(plate ?? [], FIELD), 'utf8')
}

/* ------------------------------------------------------- jurisdiction */

describe('which code the notes cite', () => {
  test('the cottage resolves Florida from the site node, not from a guess', () => {
    expect(resolveState(SCENE)).toBe('FL')
    const j = resolveJurisdiction(SCENE)
    expect(j.resolved).toBe(true)
    expect(j.code).toContain('Florida Building Code, Residential')
    expect(j.code).toContain('8th Edition (2023)')
    expect(j.ircBase).toBe(2021)
    expect(j.county).toBe('Hillsborough')
    // Climate + design values come from the researched tables, not invented.
    expect(j.climateZone).toBe('2A')
    expect(j.ultimateWindMph).toBe(140)
    expect(j.termiteRisk).toBe('very heavy')
    expect(j.wallInsulation?.value).toBe('R13')
  })

  test('an unknown state falls back to IRC 2021 and says so', () => {
    const j = resolveJurisdiction({})
    expect(j.resolved).toBe(false)
    expect(j.code).toBe('IRC 2021')
    expect(codeHeaderLine(j)).toContain('2021 INTERNATIONAL RESIDENTIAL CODE')
    expect(codeHeaderLine(j)).toContain('NOT ESTABLISHED')
    expect(j.caveats.join(' ')).toContain('No state on the site node')
  })

  test('the header line names the adopted code and warns about amendments', () => {
    const line = codeHeaderLine(resolveJurisdiction(SCENE))
    expect(line).toContain('FLORIDA BUILDING CODE')
    expect(line).toContain('2021 IRC SECTION NUMBERING')
    expect(line).toContain('VERIFY LOCAL AMENDMENTS')
  })
})

/* ------------------------------------------------------------ content */

describe('the general notes themselves', () => {
  const j = resolveJurisdiction(SCENE)
  const sections = generalNoteSections(j)

  test('covers every discipline a permit set needs', () => {
    const titles = sections.map((s) => s.title.toLowerCase())
    for (const discipline of [
      'general & codes',
      'site, excavation & foundation',
      'wood framing',
      'fire & life safety',
      'glazing & opening protection',
      'exterior envelope & roofing',
      'energy conservation',
      'electrical',
      'plumbing',
      'mechanical',
    ]) {
      expect(titles).toContain(discipline)
    }
  })

  test('every note carries a citation, and uncertain ones say "verify"', () => {
    const all = sections.flatMap((s) => s.notes)
    expect(all.length).toBeGreaterThan(90)
    for (const note of all) {
      expect(citation(note)).toStartWith('(')
      expect(citation(note)).toEndWith(')')
      expect(citation(note).length).toBeGreaterThan(4)
      // A note with no section prints as a drafting standard rather than
      // borrowing a number it does not come from.
      if (!note.cite) expect(citation(note)).toBe('(drafting standard)')
      if (note.verify) expect(citation(note)).toStartWith('(verify: ')
    }
    // Drafting conventions are the exception, not the rule.
    expect(all.filter((n) => !n.cite).length).toBeLessThanOrEqual(4)
  })

  test('the sections a plan checker looks for are cited by section number', () => {
    const body = sections.flatMap((s) => s.notes.map((n, i) => noteLine(i + 1, n))).join(' ')
    for (const section of [
      'R302.6', // garage separation
      'R302.5.1', // garage door
      'R303.1', // light and ventilation
      'R310.2.1', // emergency escape opening
      'R311.7.5.1', // 7-3/4 in riser
      'R311.7.5.2', // 10 in tread
      'R312.1.2', // 36 in guard
      'R314.3', // smoke alarms
      'R315.2.1', // CO alarms
      'R316.4', // foam plastic thermal barrier
      'R308.4.5', // safety glazing at tubs
      'R403.1.6', // anchor bolts
      'R506.2.3', // slab vapor retarder
      'R408.1', // crawl ventilation
      'Table R602.3(1)', // fastening schedule
      'R802.11', // roof tie-down
      'R703.2', // water-resistive barrier
      'R806.2', // attic ventilation
      'N1102.4.1', // air barrier
      'E3901.2', // 6 ft / 12 ft receptacle rule
      'E3902', // GFCI
      'P2603.2.1', // nail plates
      'P2708.1', // shower size
      'P3103.1', // vent terminals
      'M1502.4.6.1', // dryer duct length
      'M1505.4.3', // whole-house ventilation
    ]) {
      expect(body).toContain(section)
    }
  })

  test('Florida gets its wind-borne debris note; a calm state does not', () => {
    const florida = generalNoteSections(resolveJurisdiction(SCENE))
      .flatMap((s) => s.notes.map((n) => n.text))
      .join(' ')
    expect(florida).toContain('Wind-borne debris region')
    expect(florida).toContain('ASTM E1996')

    const calm = generalNoteSections({
      ...resolveJurisdiction(SCENE),
      hvhz: false,
      hurricaneTies: false,
      ultimateWindMph: 100,
    })
      .flatMap((s) => s.notes.map((n) => n.text))
      .join(' ')
    expect(calm).not.toContain('Wind-borne debris region')
  })

  test('the notes quote the jurisdiction data instead of inventing values', () => {
    const body = generalNoteSections(j)
      .flatMap((s) => s.notes.map((n) => n.text))
      .join(' ')
    // Frost depth and wall R come from jurisdictions-climate / wall-assemblies.
    expect(body).toContain('12 in below finished grade')
    expect(body).toContain('R-13')
    expect(body).toContain('climate zone 2A')
  })
})

/* ------------------------------------------------------------- layout */

describe('the notes fit the paper', () => {
  const sections = generalNoteSections(resolveJurisdiction(SCENE))

  test('a full ARCH D field flows into five columns with nothing left over', () => {
    const layout = layoutGeneralNotes({ x: 0, y: 0, w: 32, h: 20 }, sections)
    expect(layout.columns).toBe(5)
    expect(layout.columnWidth).toBeGreaterThan(6)
    expect(layout.overflow).toBe(0)
    // No wrapped line runs past its own column.
    expect(layout.longestLineIn).toBeLessThanOrEqual(layout.columnWidth + 1e-9)
  })

  test('the real A0.1 field fits too', () => {
    const layout = layoutGeneralNotes(FIELD, sections)
    expect(layout.overflow).toBe(0)
    expect(layout.longestLineIn).toBeLessThanOrEqual(layout.columnWidth + 1e-9)
  })

  test('a field too small to hold them says "continued on next sheet"', () => {
    const drawing = buildGeneralNotesDrawing(SCENE, args({ x: 1, y: 1, w: 7, h: 6 }, 'general'))
    expect(textOf(drawing?.plate)).toContain('continued on next sheet')
    expect((drawing?.warnings ?? []).join(' ')).toContain('did not fit this viewport')
  })

  test('column count follows the width of the field', () => {
    expect(columnsFor(31.4).count).toBe(5)
    expect(columnsFor(10).count).toBe(2)
    expect(columnsFor(6.2).count).toBe(1)
    expect(measureIn('12345678', 0.1)).toBeCloseTo(0.44, 6)
  })
})

/* ------------------------------------------------------------- plates */

describe('the general notes plate', () => {
  const drawing = buildGeneralNotesDrawing(SCENE, args(FIELD, 'general'))

  test('is a plate only — there is no model window behind notes', () => {
    expect(drawing).not.toBeNull()
    expect(drawing?.primitives).toHaveLength(0)
    expect(drawing?.noLabel).toBe(true)
    expect(drawing?.title).toBe('General notes')
    eyeball('notes-general', drawing?.plate)
  })

  test('prints the code header, the discipline headings and the data caveats', () => {
    const body = textOf(drawing?.plate)
    expect(body).toContain('GENERAL NOTES')
    expect(body).toContain('FLORIDA BUILDING CODE')
    expect(body).toContain('WOOD FRAMING')
    expect(body).toContain('FIRE & LIFE SAFETY')
    expect(body).toContain('LOCAL AMENDMENTS ARE NOT INCLUDED')
  })

  test('the roof note block is a separate, shorter key', () => {
    const roof = buildGeneralNotesDrawing(SCENE, args({ x: 1, y: 1, w: 9, h: 8 }, 'roof'))
    expect(roof?.title).toBe('Roof notes')
    expect(textOf(roof?.plate)).toContain('R806.3')
    expect(roofNotes(resolveJurisdiction(SCENE))[0]?.notes.length).toBeGreaterThan(3)
  })
})

/* -------------------------------------------------- attic ventilation */

describe('the attic ventilation calculation', () => {
  test('pitch in degrees becomes rise in 12ths', () => {
    expect(pitchLabel(30.256437)).toBe('7:12')
    expect(pitchLabel(45)).toBe('12:12')
    expect(pitchLabel(18.4349)).toBe('4:12')
    expect(pitchLabel(0)).toBe('FLAT')
    expect(pitchLabel(undefined)).toBe('—')
  })

  test('matches the hand calculation on the cottage roof', () => {
    const vent = computeAtticVentilation(SCENE)
    // One 14.0208 m × 9.7536 m gable segment = 136.753 m² = 1,472 sf.
    expect(vent.segments).toHaveLength(1)
    expect(vent.segments[0]?.pitch).toBe('7:12')
    expect(vent.areaSqM).toBeCloseTo(136.75327488, 6)
    expect(vent.areaSqFt).toBeCloseTo(1472, 2)
    // 1,472 / 150 = 9.813 sf = 1,413 sq in.
    expect(vent.required150SqIn / 144).toBeCloseTo(9.813, 3)
    expect(Math.round(vent.required150SqIn)).toBe(1413)
    // The 1/300 alternative is exactly half of it.
    expect(Math.round(vent.required300SqIn)).toBe(707)
    expect(vent.upperShare.minSqIn).toBeCloseTo(vent.required300SqIn * 0.4, 6)
    expect(vent.upperShare.maxSqIn).toBeCloseTo(vent.required300SqIn * 0.5, 6)
  })

  test('says the area excludes overhangs rather than leaving it implied', () => {
    const vent = computeAtticVentilation(SCENE)
    expect(vent.warnings.join(' ')).toContain('eave overhangs are excluded')
  })

  test('an empty scene computes nothing and says so', () => {
    const vent = computeAtticVentilation({})
    expect(vent.areaSqFt).toBe(0)
    expect(vent.warnings.join(' ')).toContain('No roof segments')
  })

  test('the plate prints both ratios, both conditions and no vent product', () => {
    const box = { x: FIELD.x + FIELD.w * 0.68, y: FIELD.y, w: FIELD.w * 0.32, h: FIELD.h }
    const drawing = buildGeneralNotesDrawing(SCENE, args(box, 'attic-ventilation'))
    expect(drawing?.noLabel).toBe(true)
    const body = textOf(drawing?.plate)
    eyeball('notes-attic', drawing?.plate)

    expect(body).toContain('ROOF VENTING CALCULATION & DIAGRAM')
    expect(body).toContain('1,472') // vented attic area, sf
    expect(body).toContain('1,413 SQ IN') // 1/150
    expect(body).toContain('707 SQ IN') // 1/300
    expect(body).toContain('1/150')
    expect(body).toContain('1/300')
    // Both R806.2 exception conditions, in full.
    expect(body).toContain('Climate Zones 6, 7 and 8')
    expect(body).toContain('40 %')
    expect(body).toContain('50 %')
    // R806.1's opening rules.
    expect(body).toContain('1/16 in')
    expect(body).toContain('1/4 in')
    // Pascal does not choose a vent product.
    expect(body).toContain('manufacturer’s listed NFA')
    expect(body).toContain('7:12')
    // And it never declares a result.
    expect(body).not.toContain('PASS')
    expect(body).not.toContain('COMPLIES')
  })
})

/* ---------------------------------------------------------- the sheets */

describe('the sheets these plates land on', () => {
  const ctx = {
    nodes: SCENE,
    frame: FIELD,
    gap: 0.5,
    planScale: 48,
    elevationScale: 48,
    levels: Object.values(SCENE).filter((n) => n.type === 'level'),
    hasBones: false,
    archScales: [],
    civilScales: [],
  } as unknown as PlanSetContext

  test('A0.1 is a whole sheet of general notes', () => {
    const a01 = notesPlans(ctx).find((plan) => plan.number === 'A0.1')
    expect(a01?.title).toBe('General notes')
    expect(a01?.viewports).toHaveLength(1)
    expect(a01?.viewports[0]?.kind).toBe('general-notes')
    expect(a01?.viewports[0]?.notesKey).toBe('general')
    expect(a01?.viewports[0]?.w).toBe(FIELD.w)
  })

  test('A3.0 is EXTENDED with the venting column, not replaced', () => {
    const a30 = notesPlans(ctx).find((plan) => plan.number === 'A3.0')
    expect(a30?.extend).toBe(true)
    expect(a30?.viewports[0]?.notesKey).toBe('attic-ventilation')
    // The right third — generate.ts leaves the roof plan the left 66 %.
    expect(a30?.viewports[0]?.x).toBeCloseTo(FIELD.x + FIELD.w * 0.68, 6)
    expect(a30?.viewports[0]?.w).toBeCloseTo(FIELD.w * 0.32, 6)
  })

  test('a scene with no roof gets no venting calculation', () => {
    const roofless = Object.fromEntries(
      Object.entries(SCENE).filter(([, node]) => node.type !== 'roof-segment'),
    )
    const plans = notesPlans({ ...ctx, nodes: roofless } as unknown as PlanSetContext)
    expect(plans.map((plan) => plan.number)).toEqual(['A0.1'])
  })

  test('EN1.0 is the energy sheet, on the first level', () => {
    const en = energyPlans(ctx)[0]
    expect(en?.number).toBe('EN1.0')
    expect(en?.viewports[0]?.kind).toBe('energy')
    expect(en?.viewports[0]?.levelId).toBe(
      (Object.values(SCENE).find((n) => n.type === 'level') as AnyNodeLike).id,
    )
  })
})
