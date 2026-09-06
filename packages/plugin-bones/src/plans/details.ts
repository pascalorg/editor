/**
 * Typical construction details — PlanCrafters' `details.js` (the automated
 * draftsman: parametric details drawn live from model variables, like Revit
 * details, never static blocks), redrawn as SVG for the Bones plan set with
 * every variable read from the FRAMED MODEL: the stud size and spacing the
 * wall engine used, the layer thicknesses it laid, the header it sized, the
 * rafter and ceiling joist the roof engine placed and the pitch they lie
 * at, the footing and stemwall the foundation poured (stepped or not), the
 * deck joist the deck engine hung on its ledger. A pitch / assembly /
 * jurisdiction change re-drafts the sheet and its callouts can never go
 * stale (W12).
 *
 * Registry entry: { id, title, applies(v), draw(v) → primitives + notes }.
 * `detailsSheets` lays the applicable details out on a 3 × 2 grid, fits
 * each drawing to its panel, packs its notes into a leader column beside
 * it, numbers it, and prints the scale the fit produced.
 */
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member } from '../core/types'
import { LUMBER_CROSS_SECTIONS, type LumberSize } from '../lumber'

const IN = 0.0254
/** Sheet pixels per paper inch (letter landscape, 1056 px wide). */
const PX_PER_PAPER_IN = 96

// ---------------------------------------------------------------------------
// Variables — read from the members (what was framed), the spec (what sized
// it) and the foundation record (how far the floor stands above grade).
// ---------------------------------------------------------------------------

export type DetailFoundation = {
  type: 'slab' | 'raised'
  /** Finish floor above grade, inches. */
  ffAboveGradeIn: number
}

export type DetailVariables = {
  stud: { size: LumberSize; depthIn: number; spacingIn: number; plates: number; batt: string }
  layers: { claddingIn: number; sheathingIn: number; drywallIn: number; wrb: boolean }
  header: { size: LumberSize; depthIn: number } | null
  roof: {
    rafter: LumberSize
    rafterDepthIn: number
    spacingIn: number
    /** Rise per 12 in of run. */
    pitchRise: number
    ceilingJoist: LumberSize | null
    ceilingJoistSpacingIn: number
    ties: boolean
    fascia: boolean
  } | null
  foundation: {
    type: 'slab' | 'raised'
    footingWIn: number
    footingHIn: number
    stemWIn: number
    /** Stemwall showing above finish grade at the plate line, inches. */
    stemExposedIn: number
    ffAboveGradeIn: number
    slabIn: number
    boltSpacingIn: number
    plateWashers: boolean
    verticalsIn: number
    stepped: boolean
    mudsillWIn: number
  } | null
  deck: { joist: LumberSize; joistDepthIn: number } | null
  porchLedger: { rafter: LumberSize; rafterDepthIn: number } | null
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | null = null
  let n = 0
  for (const [v, c] of counts) {
    if (c > n) {
      best = v
      n = c
    }
  }
  return best
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] as number
}

const thinnest = (m: Member) => Math.min(m.dims[0], m.dims[1], m.dims[2])
const toIn = (m: number) => m / IN
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const depthOf = (size: LumberSize) => LUMBER_CROSS_SECTIONS[size][1] / IN
const isLumber = (s: unknown): s is LumberSize =>
  typeof s === 'string' && s in LUMBER_CROSS_SECTIONS

/** Read the detail variables from what was framed. */
export function detailVariables(
  members: Member[],
  spec: FramingSpec = DEFAULT_SPEC,
  foundation?: DetailFoundation | null,
): DetailVariables {
  const wall = members.filter((m) => m.system === 'wall-framing')
  const studSizes = wall
    .filter((m) => m.role === 'stud' && isLumber(m.size))
    .map((m) => m.size as LumberSize)
  // the exterior stud is the deepest stud size in use (interior partitions run 2x4)
  const studSize =
    studSizes.length > 0
      ? (studSizes.reduce((a, b) => (depthOf(b) > depthOf(a) ? b : a)) as LumberSize)
      : spec.exteriorStudSize
  const studDepth = depthOf(studSize)
  const layer = (role: Member['role'], fallbackIn: number) => {
    const t = median(wall.filter((m) => m.role === role).map((m) => toIn(thinnest(m))))
    return t === null ? fallbackIn : round(t, 4)
  }
  const headerSizes = wall
    .filter((m) => m.role === 'header' && isLumber(m.size))
    .map((m) => m.size as LumberSize)
  const headerSize = mode(headerSizes)
  const roofMembers = members.filter((m) => m.system === 'roof-framing')
  const rafters = roofMembers.filter(
    (m) => m.role === 'rafter' && isLumber(m.size) && !/ledger|porch/i.test(m.label ?? ''),
  )
  const rafterSize = mode(rafters.map((m) => m.size as LumberSize))
  const pitchAngle = median(
    rafters.map((m) => Math.abs(m.rotation[2])).filter((a) => a > 0.01 && a < 1.5),
  )
  const cjSize = mode(
    roofMembers
      .filter((m) => m.role === 'ceiling-joist' && isLumber(m.size))
      .map((m) => m.size as LumberSize),
  )
  const fnd = members.filter((m) => m.system === 'foundation')
  const footings = fnd.filter(
    (m) => m.role === 'footing' && !/Pad footing|Footing step|thickened/i.test(m.label ?? ''),
  )
  const stems = fnd.filter((m) => m.role === 'stemwall')
  const mudsills = fnd.filter((m) => m.role === 'mudsill')
  const raised = foundation ? foundation.type === 'raised' : mudsills.length > 0
  const exposedFromLabel = median(
    stems
      .map((m) => /—\s*([\d'"\-\s./]+?)\s*exposed above grade/.exec(m.label ?? '')?.[1] ?? null)
      .filter((s): s is string => s !== null)
      .map(parseFtIn)
      .filter((v): v is number => v !== null),
  )
  const deckJoists = members.filter(
    (m) =>
      m.system === 'floor-framing' &&
      m.role === 'joist' &&
      /Deck joist/i.test(m.label ?? '') &&
      isLumber(m.size),
  )
  const deckLedger = members.some((m) => m.system === 'floor-framing' && m.role === 'ledger')
  const porchLedgerRafters = roofMembers.filter(
    (m) => m.role === 'rafter' && isLumber(m.size) && /ledger|porch|shed/i.test(m.label ?? ''),
  )
  const roofLedger = roofMembers.some((m) => m.role === 'ledger')
  return {
    stud: {
      size: studSize,
      depthIn: round(studDepth),
      spacingIn: Math.round(spec.studSpacing / IN),
      plates: spec.topPlateCount,
      batt: studDepth >= 5 ? 'R-21' : 'R-15',
    },
    layers: {
      claddingIn: layer('cladding', 0.75),
      sheathingIn: layer('sheathing', 0.4375),
      drywallIn: layer('drywall', 0.5),
      wrb: wall.some((m) => m.role === 'wrb') || wall.length === 0,
    },
    header: headerSize ? { size: headerSize, depthIn: round(depthOf(headerSize)) } : null,
    roof:
      rafterSize && rafters.length > 0
        ? {
            rafter: rafterSize,
            rafterDepthIn: round(depthOf(rafterSize)),
            spacingIn: Math.round(spec.rafterSpacing / IN),
            pitchRise: pitchAngle === null ? 6 : Math.max(1, Math.round(Math.tan(pitchAngle) * 12)),
            ceilingJoist: cjSize,
            ceilingJoistSpacingIn: Math.round(spec.ceilingJoistSpacing / IN),
            ties: roofMembers.some((m) => /hurricane tie|H2\.5/i.test(m.label ?? '')),
            fascia: roofMembers.some((m) => m.role === 'fascia'),
          }
        : null,
    foundation:
      footings.length > 0 || stems.length > 0
        ? {
            type: raised ? 'raised' : 'slab',
            footingWIn: round(toIn(median(footings.map((m) => m.dims[2])) ?? spec.footingWidth)),
            footingHIn: round(toIn(median(footings.map((m) => m.dims[1])) ?? 8 * IN)),
            stemWIn: round(toIn(median(stems.map((m) => m.dims[2])) ?? spec.stemwallThickness)),
            stemExposedIn: round(exposedFromLabel ?? (foundation ? foundation.ffAboveGradeIn : 0)),
            ffAboveGradeIn: foundation ? foundation.ffAboveGradeIn : raised ? 18 : 8,
            slabIn: round(
              toIn(median(fnd.filter((m) => m.role === 'slab').map((m) => m.dims[1])) ?? 3.5 * IN),
            ),
            boltSpacingIn: Math.round(spec.anchorBoltSpacing / IN),
            plateWashers: spec.seismicHoldDowns,
            verticalsIn: spec.seismicHoldDowns ? 24 : 48,
            stepped: fnd.some((m) => m.role === 'footing' && /Footing step/.test(m.label ?? '')),
            mudsillWIn: round(
              toIn(
                median(mudsills.map((m) => m.dims[2])) ??
                  LUMBER_CROSS_SECTIONS[spec.exteriorStudSize][1],
              ),
            ),
          }
        : null,
    deck:
      deckLedger && deckJoists.length > 0
        ? {
            joist: mode(deckJoists.map((m) => m.size as LumberSize)) as LumberSize,
            joistDepthIn: round(
              depthOf(mode(deckJoists.map((m) => m.size as LumberSize)) as LumberSize),
            ),
          }
        : null,
    porchLedger:
      roofLedger && porchLedgerRafters.length > 0
        ? {
            rafter: mode(porchLedgerRafters.map((m) => m.size as LumberSize)) as LumberSize,
            rafterDepthIn: round(
              depthOf(mode(porchLedgerRafters.map((m) => m.size as LumberSize)) as LumberSize),
            ),
          }
        : null,
  }
}

/** `1'-6"`, `18"`, `1' 6"`, `0.5"` → inches; null when unreadable. */
export function parseFtIn(text: string): number | null {
  const s = text.trim()
  const ft = /(-?\d+(?:\.\d+)?)\s*'/.exec(s)
  const inch = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+)\/(\d+))?\s*"/.exec(
    s.replace(/^-?\d+(?:\.\d+)?\s*'\s*-?\s*/, ''),
  )
  let total = 0
  let any = false
  if (ft) {
    total += Number(ft[1]) * 12
    any = true
  }
  if (inch) {
    total += Number(inch[1]) + (inch[2] && inch[3] ? Number(inch[2]) / Number(inch[3]) : 0)
    any = true
  }
  return any && Number.isFinite(total) ? total : null
}

// ---------------------------------------------------------------------------
// Drawing primitives in WORLD INCHES (x right, z up) — fitted to paper later.
// ---------------------------------------------------------------------------

const WOOD = '#d8b98a'
const WOOD2 = '#c9a36b'
const CONC = '#8a8f96'
const GYP = '#e8d9b8'
const SHTG = '#c9c3b8'
const CLAD = '#b9c4a8'
const EARTH = 'rgba(122,99,72,0.5)'
const BAY = '#f7f5f1'
const INK = '#111'
const FLASH = '#2e86c1'
const BAR = '#b03a2e'
const NAIL = '#1f2a36'

export type Prim =
  | {
      k: 'rect'
      x: number
      zTop: number
      w: number
      h: number
      fill?: string
      xMark?: boolean
      stroke?: string
    }
  | {
      k: 'line'
      x1: number
      z1: number
      x2: number
      z2: number
      stroke?: string
      width?: number
      dash?: string
    }
  | { k: 'poly'; pts: [number, number][]; fill?: string; stroke?: string }
  | { k: 'batt'; x: number; zTop: number; zBot: number; w: number }
  | { k: 'dot'; x: number; z: number; r?: number; fill?: string }
  | {
      k: 'text'
      x: number
      z: number
      t: string
      anchor?: 'start' | 'middle' | 'end'
      size?: number
    }

export type Note = { t: string; x: number; z: number; red?: boolean }

export type DetailDrawing = { prims: Prim[]; notes: Note[] }

export type DetailDef = {
  id: string
  title: string
  applies: (v: DetailVariables) => boolean
  draw: (v: DetailVariables) => DetailDrawing
}

type Sketch = DetailDrawing & {
  rect: (x: number, zTop: number, w: number, h: number, fill?: string) => void
  xRect: (x: number, zTop: number, w: number, h: number, fill?: string) => void
  line: (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    stroke?: string,
    width?: number,
    dash?: string,
  ) => void
  poly: (pts: [number, number][], fill?: string, stroke?: string) => void
  batt: (x: number, zTop: number, zBot: number, w: number) => void
  dot: (x: number, z: number, r?: number, fill?: string) => void
  text: (x: number, z: number, t: string, anchor?: 'start' | 'middle' | 'end') => void
  note: (t: string, x: number, z: number, red?: boolean) => void
}

function sketch(): Sketch {
  const prims: Prim[] = []
  const notes: Note[] = []
  return {
    prims,
    notes,
    rect: (x, zTop, w, h, fill) => prims.push({ k: 'rect', x, zTop, w, h, fill }),
    xRect: (x, zTop, w, h, fill = WOOD) =>
      prims.push({ k: 'rect', x, zTop, w, h, fill, xMark: true }),
    line: (x1, z1, x2, z2, stroke, width, dash) =>
      prims.push({ k: 'line', x1, z1, x2, z2, stroke, width, dash }),
    poly: (pts, fill, stroke) => prims.push({ k: 'poly', pts, fill, stroke }),
    batt: (x, zTop, zBot, w) => prims.push({ k: 'batt', x, zTop, zBot, w }),
    dot: (x, z, r, fill) => prims.push({ k: 'dot', x, z, r, fill }),
    text: (x, z, t, anchor) => prims.push({ k: 'text', x, z, t, anchor }),
    note: (t, x, z, red) => notes.push({ t, x, z, red }),
  }
}

const fmtIn = (v: number): string => {
  // to the nearest 1/16, reduced: 7/16", 1-1/2", 5-1/2", 16"
  const sixteenths = Math.round(v * 16)
  const whole = Math.floor(sixteenths / 16)
  let num = sixteenths % 16
  let den = 16
  while (num > 0 && num % 2 === 0) {
    num /= 2
    den /= 2
  }
  if (num === 0) return `${whole}"`
  return whole === 0 ? `${num}/${den}"` : `${whole}-${num}/${den}"`
}
const fmtFtIn = (v: number): string => {
  const ft = Math.floor(v / 12)
  const inch = Math.round((v - ft * 12) * 4) / 4
  if (ft === 0) return fmtIn(inch)
  return inch === 0 ? `${ft}'-0"` : `${ft}'-${fmtIn(inch)}`
}
const nominal = (size: LumberSize) => size.toUpperCase()

// ---- 1. TYPICAL EXTERIOR WALL ---------------------------------------------
const wallDetail: DetailDef = {
  id: 'wallsection',
  title: 'TYPICAL EXTERIOR WALL',
  applies: () => true,
  draw(v) {
    const S = sketch()
    const d = v.stud.depthIn
    const cl = Math.max(0.6, v.layers.claddingIn)
    const sh = Math.max(0.4, v.layers.sheathingIn)
    const gy = Math.max(0.4, v.layers.drywallIn)
    const H = 40
    const slab = v.foundation ? v.foundation.type === 'slab' : true
    // layers, outside at left (x = 0 is the stud face out)
    S.rect(-cl - sh, 0, cl, H - 2, CLAD)
    S.rect(-sh, 0, sh, H, SHTG)
    S.rect(0, 0, d, H, BAY)
    S.batt(0, -1.8, -(H - 3.2), d)
    S.rect(d, 0, gy, H - 1.5, GYP)
    S.xRect(0, -(H - 3), d, 1.5) // bottom plate
    S.xRect(0, 0, d, 1.5) // top plate
    if (v.stud.plates === 2) S.xRect(0, -1.5, d, 1.5)
    if (slab) {
      const t = v.foundation?.slabIn ?? 3.5
      S.rect(-cl - sh - 4, -(H - 1.5), cl + sh + d + gy + 10, t + 14, CONC)
      S.line(d / 2, -(H - 3), d / 2, -(H + 4), '#333')
      S.line(d / 2 - 1.2, -(H - 3.4), d / 2 + 1.2, -(H - 3.4), '#333')
      S.rect(-cl - sh - 14, -(H + 1), 10, 10, EARTH)
    }
    S.note(`${fmtIn(cl)} CLADDING PER ELEVATIONS`, -cl - sh + cl / 2, -6)
    if (v.layers.wrb) S.note('WRB — CONT., LAP SHINGLE-STYLE (R703.2)', -sh - 0.1, -10)
    S.note(`${fmtIn(sh)} WD STRUCT PANEL SHTG — 8d @ 6" E.N. / 12" F.N.`, -sh / 2, -14)
    S.note(
      `${nominal(v.stud.size)} STUDS @ ${v.stud.spacingIn}" O.C. + ${v.stud.batt} BATT`,
      d / 2,
      -19,
    )
    S.note(`${fmtIn(gy)} GYP BD — INT.`, d + gy / 2, -24)
    S.note(
      v.stud.plates === 2
        ? 'DBL TOP PLATE — LAP 24" MIN @ SPLICES (R602.3.2)'
        : 'SINGLE TOP PLATE — STRAP @ SPLICES',
      d / 2,
      -0.75,
    )
    S.note(
      slab
        ? `PT SOLE PLATE + 5/8"Ø A.B. @ ${v.foundation?.boltSpacingIn ?? 72}" O.C. (R403.1.6, R317.1)`
        : 'BOTTOM PLATE ON SUBFLOOR — RIM + PT MUDSILL, SEE FOUNDATION DETAIL',
      d / 2,
      -(H - 2.2),
    )
    return S
  },
}

// ---- 2. FOUNDATION @ EXT. WALL -----------------------------------------------
const foundationDetail: DetailDef = {
  id: 'foundationdetail',
  title: 'FOUNDATION @ EXT. WALL',
  applies: (v) => v.foundation !== null,
  draw(v) {
    const S = sketch()
    const f = v.foundation as NonNullable<DetailVariables['foundation']>
    const d = v.stud.depthIn
    const raised = f.type === 'raised'
    const fw = f.footingWIn
    const fh = f.footingHIn
    const stemW = f.stemWIn
    if (raised) {
      // datum z = 0 at finish grade; the stem shows `stemExposedIn` above it; the footing is fh tall below the crawl grade
      const stemTop = f.stemExposedIn
      const ftgTop = -6
      const ftgBot = ftgTop - fh
      S.rect(-fw - 4, -2, fw + 4 + stemW / 2 + 16, -2 - ftgBot + 4, EARTH)
      S.rect(-fw - 4, 0, fw + 4 - stemW / 2, 2, EARTH)
      S.line(-fw - 6, 0, -stemW / 2, 0, '#4a6b3a', 1.6) // finish grade
      S.line(stemW / 2, -2, stemW / 2 + 15, -2, '#4a6b3a', 1) // crawl grade
      S.rect(-stemW / 2, stemTop, stemW, stemTop - ftgTop, CONC)
      S.rect(-fw / 2, ftgTop, fw, fh, CONC)
      for (let i = 0; i < 2; i++) S.dot(-fw / 2 + (fw / 3) * (i + 1), ftgBot + 3, 0.35, BAR)
      S.line(0, stemTop - 2, 0, ftgBot + 3, BAR, 1.4)
      S.line(0, ftgBot + 3, Math.min(4, fw / 3), ftgBot + 3, BAR, 1.4)
      // mudsill + anchor bolt + rim + joist bay + subfloor + wall stub
      S.xRect(-stemW / 2, stemTop + 1.5, f.mudsillWIn, 1.5, WOOD2)
      S.line(0, stemTop + 1.5, 0, stemTop - 7, '#333')
      S.line(-1.2, stemTop + 1.5, 1.2, stemTop + 1.5, '#333')
      const rimTop = stemTop + 1.5 + 9.25
      S.xRect(-stemW / 2, rimTop, 1.5, 9.25)
      S.rect(-stemW / 2 + 1.5, rimTop, 14, 9.25, BAY)
      S.rect(-stemW / 2, rimTop + 1.1, 16, 1.1, WOOD)
      S.xRect(-stemW / 2, rimTop + 1.1 + 1.5, d, 1.5)
      S.note(
        `2X${Math.round(f.mudsillWIn)} PT MUDSILL + 5/8"Ø A.B. @ ${f.boltSpacingIn}" O.C., 7" EMBED (R403.1.6)${f.plateWashers ? ' — 3×3×0.229" PLATE WASHERS (R602.11.1)' : ''}`,
        0,
        stemTop + 2.2,
      )
      S.note('RIM JOIST — FIRE BLOCKING PER R302.11', -stemW / 2 + 0.75, stemTop + 1.5 + 4.6 + 4.6)
      S.note(
        `STEM ${fmtIn(stemW)} W × ${fmtFtIn(stemTop)} ABV GRADE — F.F. ${fmtFtIn(f.ffAboveGradeIn)} ABV GRADE`,
        0,
        stemTop / 2,
      )
      S.note(`#4 VERT DOWELS @ ${f.verticalsIn}" O.C. — HOOK @ FTG`, 0.4, 2)
      S.note(
        `FTG ${fmtIn(fw)}W × ${fmtIn(fh)}D — (2) #4 CONT., BOTTOM BELOW FROST LINE (R403.1.4.1)`,
        fw / 4,
        ftgBot + 3,
      )
      S.note('6" MIN CLR GRADE→WOOD (R317.1)', -stemW / 2 - 2, stemTop * 0.75, stemTop < 6)
      S.note(
        '18" MIN CRAWL CLEARANCE — CLASS I VAPOR RETARDER ON GRADE (R408)',
        stemW / 2 + 5,
        stemTop + 3,
      )
      if (f.stepped)
        S.note(
          'FOOTINGS STEPPED DOWN THE HILL — STEPS ≤ 24", RUNS ≥ 24" (R403.1.5) — SEE FOUNDATION PLAN',
          -fw / 2,
          ftgTop,
          true,
        )
    } else {
      const slabT = f.slabIn
      const exposed = f.stemExposedIn
      S.rect(-fw - 4, 0, fw + 4 + fw / 2 + 26, fh + 6 + exposed, EARTH)
      S.line(-fw - 6, 0, -stemW / 2 - 2, 0, '#4a6b3a', 1.6)
      // slab on a stem/thickened edge: slab top `exposed` above grade
      const slabTop = exposed + 0
      S.poly(
        [
          [-stemW / 2 - 2, slabTop],
          [24, slabTop],
          [24, slabTop - slabT],
          [fw / 2, slabTop - slabT],
          [fw / 2, -(fh + 4)],
          [-fw / 2, -(fh + 4)],
          [-fw / 2, slabTop],
        ],
        CONC,
      )
      S.line(2, slabTop - slabT - 0.6, 24, slabTop - slabT - 0.6, '#555', 1, '5 3')
      for (let bx = 4; bx <= 22; bx += 6) S.dot(bx, slabTop - slabT / 2, 0.3, BAR)
      for (let i = 0; i < 2; i++) S.dot(-fw / 4 + (i * fw) / 4, -(fh + 1), 0.35, BAR)
      S.xRect(-stemW / 2, slabTop + 1.5, d, 1.5, WOOD2)
      S.line(-stemW / 2 + d / 2, slabTop + 1.5, -stemW / 2 + d / 2, slabTop - 7, '#333')
      S.note(
        `PT PLATE + 5/8"Ø A.B. @ ${f.boltSpacingIn}" O.C., 7" MIN EMBED (R403.1.6)${f.plateWashers ? ' + PLATE WASHERS (R602.11.1)' : ''}`,
        -stemW / 2 + d / 2,
        slabTop + 0.6,
      )
      S.note(
        `${fmtIn(slabT)} CONC SLAB — TOP ${fmtFtIn(exposed)} ABV GRADE (R404.1.6 / R317.1)`,
        12,
        slabTop - slabT / 2,
      )
      S.note('6-MIL VAPOR RETARDER O/ 4" BASE (R506.2.3)', 14, slabTop - slabT - 0.6)
      S.note(
        `STEM ${fmtIn(stemW)} W — FTG ${fmtIn(fw)}W × ${fmtIn(fh)}D, (2) #4 CONT., BOTTOM BELOW FROST LINE`,
        0,
        -(fh + 1),
      )
      S.note("FIN GRADE — SLOPE 5% AWAY 10' (R401.3)", -fw + 3, 0)
      if (f.stepped)
        S.note(
          'FOOTINGS STEPPED DOWN THE HILL — STEPS ≤ 24" (R403.1.5) — SEE FOUNDATION PLAN',
          -fw / 2,
          -(fh + 3),
          true,
        )
    }
    return S
  },
}

// ---- 3. TYPICAL EAVE -----------------------------------------------------------
const eaveDetail: DetailDef = {
  id: 'eave',
  title: 'TYPICAL EAVE',
  applies: (v) => v.roof !== null,
  draw(v) {
    const S = sketch()
    const r = v.roof as NonNullable<DetailVariables['roof']>
    const slope = r.pitchRise / 12
    const over = 16
    const memD = r.rafterDepthIn
    const d = v.stud.depthIn
    const cl = Math.max(0.6, v.layers.claddingIn)
    const sh = Math.max(0.4, v.layers.sheathingIn)
    const gy = Math.max(0.4, v.layers.drywallIn)
    const spanX = d + 16
    const wallH = 26
    const zAt = (wx: number) => wx * slope
    const cjD = r.ceilingJoist ? depthOf(r.ceilingJoist) : 5.5
    // wall: cladding | shtg | studs | gyp, plate top at z = 0
    S.rect(-cl - sh, -3, cl, wallH, CLAD)
    S.rect(-sh, 0, sh, wallH + 3, SHTG)
    S.rect(0, -3, d, wallH, BAY)
    S.batt(0, -3.5, -(wallH - 1), d)
    S.xRect(0, 0, d, 1.5)
    if (v.stud.plates === 2) S.xRect(0, -1.5, d, 1.5)
    S.rect(d, -3, gy, wallH, GYP)
    // ceiling joist beside the rafter (one bay back) — dashed where hidden
    S.rect(0, cjD, spanX - 1, cjD, '#efe6d4')
    const tailX = -(cl + sh) - over
    S.poly(
      [
        [tailX, zAt(tailX)],
        [spanX, zAt(spanX)],
        [spanX, zAt(spanX) + memD],
        [tailX, zAt(tailX) + memD],
      ],
      WOOD,
    )
    // bird block: plate top to the underside of the roof sheathing
    const bx0 = -sh
    const bx1 = d * 0.5
    S.poly(
      [
        [bx0, 0],
        [bx1, 0],
        [bx1, zAt(bx1) + memD],
        [bx0, zAt(bx0) + memD],
      ],
      WOOD2,
    )
    S.line(bx0, 0, bx1, zAt(bx1) + memD)
    S.line(bx1, 0, bx0, zAt(bx0) + memD)
    // roof assembly: sheathing + underlayment (dashed) + roofing (heavy)
    S.poly(
      [
        [tailX, zAt(tailX) + memD],
        [spanX, zAt(spanX) + memD],
        [spanX, zAt(spanX) + memD + 0.5],
        [tailX, zAt(tailX) + memD + 0.5],
      ],
      SHTG,
    )
    S.line(tailX, zAt(tailX) + memD + 0.7, spanX, zAt(spanX) + memD + 0.7, '#555', 1, '4 3')
    S.line(tailX - 0.5, zAt(tailX) + memD + 1.2, spanX, zAt(spanX) + memD + 1.2, INK, 1.8)
    if (r.fascia) S.rect(tailX - 1.5, zAt(tailX) + memD, 1.5, memD + 1.5, WOOD2)
    S.rect(tailX, zAt(tailX) + 0.75, -tailX - cl - sh, 0.75, '#efece6') // soffit
    S.rect(-cl - sh, zAt(tailX) + 0.75, cl, 3, WOOD2) // frieze
    S.line(0, zAt(0) + 1, spanX * 0.8, zAt(spanX * 0.8) + 1, FLASH, 1.1, '6 3') // baffle
    S.batt(spanX - 5, zAt(spanX - 5) - 0.3, cjD + 0.2, 8)
    const xHid = Math.min(spanX - 1, cjD / Math.max(slope, 0.01))
    S.line(0, cjD, xHid, cjD, '#5a4a38', 1, '4 3')
    S.line(0, cjD, 0, 0, '#5a4a38', 1, '4 3')
    // nailing — the shear-transfer path
    const bmx = (bx0 + bx1) / 2
    S.line(bmx, zAt(bmx) + memD + 1.6, bmx, zAt(bmx) + memD - 2.6, NAIL, 1.3)
    S.line(bx1 - 0.4, 2.6, bx1 - 2.6, -1.6, NAIL, 1.3)
    S.line(-sh - 0.9, -1.2, 1.8, -1.2, NAIL, 1.3)
    for (const fx of [7.5, 9.5]) S.dot(fx, 3.4, 0.35, NAIL)
    // overhang dimension + pitch flag
    S.line(tailX, -8, -cl - sh, -8, '#333', 0.8)
    S.text((tailX - cl - sh) / 2, -7.2, `${fmtFtIn(over)} EAVE (PER PLAN)`, 'middle')
    const pfx0 = tailX + 3
    const zR = zAt(pfx0) + memD + 2.6
    S.line(pfx0, zR, pfx0 + 12, zR)
    S.line(pfx0 + 12, zR, pfx0 + 12, zR + r.pitchRise)
    S.text(pfx0 - 1, zR + 1, `${r.pitchRise}:12`, 'end')
    S.note(
      'ROOFING PER SCHEDULE O/ UNDERLAYMENT (R905)',
      spanX * 0.5,
      zAt(spanX * 0.5) + memD + 1.3,
    )
    S.note('ROOF SHTG — 8d @ 6" O.C. E.N. INCL. INTO BLOCKING (R803.2)', bmx, zAt(bmx) + memD + 0.8)
    S.note(
      `RAFTER ${nominal(r.rafter)} @ ${r.spacingIn}" O.C. — ${r.pitchRise}:12 (R802.4.1)`,
      spanX * 0.35,
      zAt(spanX * 0.35) + memD / 2,
    )
    S.note(
      `CLG JOIST ${r.ceilingJoist ? nominal(r.ceilingJoist) : '2X6'} @ ${r.ceilingJoistSpacingIn}" O.C. — FACE-NAIL TO RAFTER PER T. R802.5.2 + (3) 8d TOE TO PLATE`,
      8.5,
      3.4,
    )
    S.note('CLG INSUL PER ENERGY CODE (R-38 TYP) — BAFFLE 1" MIN AIR @ VENT', spanX - 5, 6.8)
    if (r.fascia)
      S.note(
        '2X FASCIA + GUTTER PER PLAN — VENTED SOFFIT, CONT. 2" STRIP VENT',
        tailX - 0.75,
        zAt(tailX) + memD - 2,
      )
    S.note(
      r.ties
        ? 'FULL-DEPTH 2X BLOCKING + SIMPSON H2.5A @ EA. RAFTER (R802.11) — SHEAR + UPLIFT TRANSFER'
        : 'FULL-DEPTH 2X BLOCKING — 8d TOE-NAIL @ 6" O.C. TO PLATE (OR A35) — SHEAR TRANSFER',
      bx1 - 1.5,
      0.6,
    )
    S.note('WALL SHTG EDGE-NAILED TO TOP PLATE — 8d @ 6" O.C. E.N.', -sh - 0.5, -1.2)
    S.note(`${fmtIn(cl)} CLADDING O/ WRB`, -cl - sh + cl / 2, -14)
    return S
  },
}

// ---- 4. WINDOW HEAD & SILL ---------------------------------------------------
const openingDetail: DetailDef = {
  id: 'openinghead',
  title: 'WINDOW HEAD & SILL',
  applies: (v) => v.header !== null,
  draw(v) {
    const S = sketch()
    const h = v.header as NonNullable<DetailVariables['header']>
    const d = v.stud.depthIn
    const cl = Math.max(0.6, v.layers.claddingIn)
    const sh = Math.max(0.4, v.layers.sheathingIn)
    const gy = Math.max(0.4, v.layers.drywallIn)
    const hdrD = h.depthIn
    // head
    S.rect(-cl - sh, 0, cl, 6, CLAD)
    S.rect(-sh, 0, sh, 6 + hdrD, SHTG)
    S.xRect(0, 0, d, hdrD, WOOD)
    S.rect(d, 0, gy, 6 + hdrD, GYP)
    S.rect(-cl - sh, -6, cl + 0.4, 1.2, WOOD2)
    S.line(-sh, -4.6, -cl - sh - 0.5, -4.6, FLASH, 1.3)
    S.line(-cl - sh - 0.5, -4.6, -cl - sh - 0.5, -5.4, FLASH, 1.3)
    S.rect(-sh - 0.4, -(hdrD - 0.2), 2, 1.6, '#dfe7ee')
    S.line(-sh + 0.6, -(hdrD + 1.2), -sh + 0.6, -(hdrD + 8))
    // sill
    const sy = -(hdrD + 12)
    S.rect(-cl - sh, sy, cl, 8, CLAD)
    S.rect(-sh, sy + 1.5, sh, 9.5, SHTG)
    S.xRect(0, sy, d, 1.5)
    S.rect(d, sy, gy, 8, GYP)
    S.poly(
      [
        [-sh, sy + 1.7],
        [-cl - sh - 1.2, sy + 0.8],
        [-cl - sh - 1.2, sy + 0.2],
        [-sh, sy + 1.1],
      ],
      WOOD2,
    )
    S.line(-cl - sh - 1.0, sy + 1.0, -sh + 0.2, sy + 1.9, FLASH, 1.3)
    S.line(-sh + 0.2, sy + 1.9, -sh + 0.2, sy + 3.4, FLASH, 1.3)
    S.rect(-sh - 0.4, sy + 3.4, 2, 1.6, '#dfe7ee')
    S.line(-sh + 0.6, sy + 3.4, -sh + 0.6, sy + 9)
    S.note(`HDR ${nominal(h.size)} PER PLAN (TABLE R602.7(1)) — TRIMMERS PER PLAN`, d / 2, hdrD / 2)
    S.note('HEAD FLASHING — LAP WRB OVER (R703.4)', -cl - sh - 0.4, -4.8)
    S.note('SEALANT + BACKER @ FRAME PERIM.', -sh - 0.3, -(hdrD - 0.4))
    S.note('WINDOW PER SCHEDULE — FIN OR FLANGE', -sh + 0.6, -(hdrD + 4))
    S.note('SILL PAN — TURN UP 4" @ JAMBS + BACK DAM', -sh - 0.2, sy + 2.2)
    S.note('SLOPED SILL — 1/4"/FT MIN', -cl - sh - 0.6, sy + 0.6)
    S.note('2X SILL PLATE', d / 2, sy + 0.75)
    return S
  },
}

// ---- 5. DECK LEDGER @ RIM ----------------------------------------------------
const deckLedgerDetail: DetailDef = {
  id: 'deckledger',
  title: 'DECK LEDGER @ RIM',
  applies: (v) => v.deck !== null,
  draw(v) {
    const S = sketch()
    const dk = v.deck as NonNullable<DetailVariables['deck']>
    const jd = dk.joistDepthIn
    const sh = Math.max(0.4, v.layers.sheathingIn)
    const d = v.stud.depthIn
    S.rect(0, 12, sh, 24, SHTG)
    S.xRect(sh, 4, 1.5, jd)
    S.rect(sh + 1.5, 4, 12, jd, BAY)
    S.rect(sh, 5.1, 14, 1.1, WOOD)
    S.xRect(sh, 8.1, d, 1.5)
    S.rect(sh, 12, d, 3, BAY)
    S.xRect(-1.5, 3.4, 1.5, jd, WOOD2)
    S.line(-2.2, 1.2, sh + 1.8, 1.2, '#333', 1.1)
    S.line(-2.2, -2.4, sh + 1.8, -2.4, '#333', 1.1)
    S.xRect(-14, 2.9, 12.5, jd, WOOD)
    S.rect(-16, 4.2, 16, 1.1, WOOD2)
    S.line(-1.5, 2.4, -3.6, 2.4, '#555', 1.2)
    S.line(-3.6, 2.4, -3.6, 2.4 - jd + 1.5, '#555', 1.2)
    S.line(-3.6, 2.4 - jd + 1.5, -1.5, 2.4 - jd + 1.5, '#555', 1.2)
    S.line(0.2, 8, 0.2, 3.6, FLASH, 1.3)
    S.line(0.2, 3.6, -1.7, 3.6, FLASH, 1.3)
    S.line(-1.7, 3.6, -1.7, 2.6, FLASH, 1.3)
    S.note('DECKING PER PLAN — 5/4 PT OR COMPOSITE', -10, 3.8)
    S.note('LEDGER FLASHING — UP BEHIND WRB, OVER LEDGER (R507.9.1)', -0.7, 3.2)
    S.note(
      `${nominal(dk.joist)} PT LEDGER — 1/2"Ø THRU-BOLTS OR LEDGERLOK PER TABLE R507.9.1.3(1)`,
      -0.75,
      -0.8,
    )
    S.note('JOIST HANGER EA. JOIST (SIMPSON LUS OR EQ.)', -3.6, -3.5)
    S.note(`DECK JOIST ${nominal(dk.joist)} PT PER PLAN (R507.6)`, -9, -1.5)
    S.note("LATERAL LOAD CONNECTION REQ'D — R507.9.2 (2 LOCATIONS)", sh + 2.5, 0)
    S.note('NO SHEATHING GAP — BOLT THRU RIM, VERIFY MEMBER', sh + 0.75, 6)
    return S
  },
}

// ---- 6. PORCH ROOF LEDGER @ WALL -----------------------------------------------
const porchLedgerDetail: DetailDef = {
  id: 'porchledger',
  title: 'PORCH ROOF LEDGER @ WALL',
  applies: (v) => v.porchLedger !== null,
  draw(v) {
    const S = sketch()
    const p = v.porchLedger as NonNullable<DetailVariables['porchLedger']>
    const rd = p.rafterDepthIn
    const slope = (v.roof?.pitchRise ?? 4) / 12
    const d = v.stud.depthIn
    const cl = Math.max(0.6, v.layers.claddingIn)
    const sh = Math.max(0.4, v.layers.sheathingIn)
    const zAt = (wx: number) => wx * slope
    // upper wall: stud bay + sheathing; siding held above the porch roof
    S.rect(0, 20, d, 34, BAY)
    S.batt(0, 19, -13, d)
    S.rect(-sh, 20, sh, 34, SHTG)
    S.rect(-cl - sh, 20, cl, 16.5, CLAD)
    // the ledger on the wall, rafter hung on it
    S.xRect(-sh - 1.5, rd + 1.5, 1.5, rd + 1.5, WOOD2)
    const rx0 = -26
    S.poly(
      [
        [rx0, zAt(rx0)],
        [-sh - 1.5, zAt(-sh - 1.5)],
        [-sh - 1.5, zAt(-sh - 1.5) - rd],
        [rx0, zAt(rx0) - rd],
      ],
      WOOD,
    )
    S.poly(
      [
        [rx0, zAt(rx0) + 0.5],
        [-sh - 1.5, zAt(-sh - 1.5) + 0.5],
        [-sh - 1.5, zAt(-sh - 1.5)],
        [rx0, zAt(rx0)],
      ],
      SHTG,
    )
    S.line(rx0 - 1, zAt(rx0) + 1.1, -sh - 2, zAt(-sh - 2) + 1.1, INK, 1.8)
    for (let i = 0; i < 4; i++) {
      const wx = -sh - 2 - i * 5
      S.line(-sh, zAt(wx) + 1.1 + 4, -sh, zAt(wx) + 1.1, FLASH, 1.3)
      S.line(-sh, zAt(wx) + 1.1, wx, zAt(wx) + 1.1, FLASH, 1.3)
    }
    S.line(rx0 + 2, zAt(rx0 + 2) + 1.1, rx0, zAt(rx0) + 4, FLASH, 1.3)
    S.note('SIDING HELD 2" MIN ABV ROOF — NO CAULK JOINT', -cl - sh + cl / 2, 4.5)
    S.note('STEP FLASHING 4"×4" MIN EA. COURSE — LAP WRB OVER (R903.2)', -sh, zAt(-sh - 6) + 3)
    S.note('KICKOUT DIVERTER @ EAVE TERMINATION — TO GUTTER', rx0 + 1, zAt(rx0) + 3)
    S.note(
      `2X LEDGER — LAG OR THRU-BOLT TO STUDS @ 16" O.C. (VERIFY); RAFTER ${nominal(p.rafter)} ON SIMPSON LUS HANGER`,
      -sh - 0.75,
      rd / 2,
    )
    S.note(`UPPER WALL ${nominal(v.stud.size)} STUDS + SHTG CONT. PAST THE PORCH ROOF`, d / 2, 16)
    return S
  },
}

export const DETAILS: DetailDef[] = [
  wallDetail,
  foundationDetail,
  eaveDetail,
  openingDetail,
  deckLedgerDetail,
  porchLedgerDetail,
]

// ---------------------------------------------------------------------------
// Composer — fit each detail into a panel, pack its notes, number it.
// ---------------------------------------------------------------------------

export type Panel = { x: number; y: number; w: number; h: number }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Ext = { x0: number; x1: number; z0: number; z1: number }

function extentOf(prims: Prim[]): Ext {
  const e: Ext = {
    x0: Number.POSITIVE_INFINITY,
    x1: Number.NEGATIVE_INFINITY,
    z0: Number.POSITIVE_INFINITY,
    z1: Number.NEGATIVE_INFINITY,
  }
  const add = (x: number, z: number) => {
    e.x0 = Math.min(e.x0, x)
    e.x1 = Math.max(e.x1, x)
    e.z0 = Math.min(e.z0, z)
    e.z1 = Math.max(e.z1, z)
  }
  for (const p of prims) {
    switch (p.k) {
      case 'rect':
        add(p.x, p.zTop)
        add(p.x + p.w, p.zTop - p.h)
        break
      case 'line':
        add(p.x1, p.z1)
        add(p.x2, p.z2)
        break
      case 'poly':
        for (const q of p.pts) add(q[0], q[1])
        break
      case 'batt':
        add(p.x, p.zTop)
        add(p.x + p.w, p.zBot)
        break
      case 'dot':
        add(p.x, p.z)
        break
      case 'text':
        add(p.x, p.z)
        break
    }
  }
  if (!Number.isFinite(e.x0)) return { x0: 0, x1: 1, z0: 0, z1: 1 }
  return e
}

/** Nearest drafting scale label for `s` px per world inch: paper inches per foot. */
export function scaleLabel(s: number): string {
  const paperInPerFt = (12 * s) / PX_PER_PAPER_IN
  const eighths = Math.max(1, Math.round(paperInPerFt * 8))
  const whole = Math.floor(eighths / 8)
  const rem = eighths % 8
  const fr =
    rem === 0 ? '' : rem % 4 === 0 ? `${rem / 4}/2` : rem % 2 === 0 ? `${rem / 2}/4` : `${rem}/8`
  const lead = whole > 0 ? `${whole}${fr ? `-${fr}` : ''}` : fr
  return `${lead || '1/8'}" = 1'-0"`
}

function wrapText(t: string, max: number): string[] {
  const words = t.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (next.length > max && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** One detail drawn into its panel: fitted drawing, note column with leaders, caption. */
export function renderDetail(
  def: DetailDef,
  v: DetailVariables,
  panel: Panel,
  num: number,
): string {
  const drawing = def.draw(v)
  const ext = extentOf(drawing.prims)
  const capH = 30
  const noteW = Math.round(panel.w * 0.42)
  const gap = 10
  const drawW = panel.w - noteW - gap - 8
  const drawH = panel.h - capH - 12
  const sx = drawW / Math.max(1, ext.x1 - ext.x0)
  const sz = drawH / Math.max(1, ext.z1 - ext.z0)
  const s = Math.min(sx, sz)
  const ox = panel.x + 4 + (drawW - (ext.x1 - ext.x0) * s) / 2
  const oy = panel.y + 6 + (drawH - (ext.z1 - ext.z0) * s) / 2
  const X = (wx: number) => ox + (wx - ext.x0) * s
  const Y = (wz: number) => oy + (ext.z1 - wz) * s
  const f = (n: number) => n.toFixed(1)
  const out: string[] = []
  const hair = 0.8
  for (const p of drawing.prims) {
    switch (p.k) {
      case 'rect': {
        const x = X(p.x)
        const y = Y(p.zTop)
        const w = p.w * s
        const h = p.h * s
        out.push(
          `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${p.fill ?? 'none'}" stroke="${p.stroke ?? INK}" stroke-width="${hair}"/>`,
        )
        if (p.xMark)
          out.push(
            `<path d="M${f(x)} ${f(y)} L${f(x + w)} ${f(y + h)} M${f(x + w)} ${f(y)} L${f(x)} ${f(y + h)}" stroke="${INK}" stroke-width="${hair}" fill="none"/>`,
          )
        break
      }
      case 'line':
        out.push(
          `<line x1="${f(X(p.x1))}" y1="${f(Y(p.z1))}" x2="${f(X(p.x2))}" y2="${f(Y(p.z2))}" stroke="${p.stroke ?? INK}" stroke-width="${p.width ?? hair}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`,
        )
        break
      case 'poly':
        out.push(
          `<polygon points="${p.pts.map((q) => `${f(X(q[0]))},${f(Y(q[1]))}`).join(' ')}" fill="${p.fill ?? 'none'}" stroke="${p.stroke ?? INK}" stroke-width="${hair}"/>`,
        )
        break
      case 'batt': {
        // chained semicircle squiggle down the cavity
        const r = Math.max(1.5, (p.w * s) / 2)
        const cx = X(p.x + p.w / 2)
        let y = Y(p.zTop) + r
        const yEnd = Y(p.zBot) - r
        let flip = false
        const d: string[] = []
        while (y < yEnd) {
          d.push(`M${f(cx)} ${f(y - r)} A${f(r)} ${f(r)} 0 0 ${flip ? 0 : 1} ${f(cx)} ${f(y + r)}`)
          y += r * 1.6
          flip = !flip
        }
        if (d.length > 0)
          out.push(`<path d="${d.join(' ')}" fill="none" stroke="#b48ead" stroke-width="1"/>`)
        break
      }
      case 'dot':
        out.push(
          `<circle cx="${f(X(p.x))}" cy="${f(Y(p.z))}" r="${f(Math.max(1.4, (p.r ?? 0.3) * s))}" fill="${p.fill ?? INK}"/>`,
        )
        break
      case 'text':
        out.push(
          `<text x="${f(X(p.x))}" y="${f(Y(p.z))}" font-size="${p.size ?? 8}" font-family="Helvetica, Arial, sans-serif" fill="${INK}" text-anchor="${p.anchor ?? 'start'}">${esc(p.t)}</text>`,
        )
        break
    }
  }
  // notes: a right column, rows packed top-down in anchor order, elbow leaders
  const colX = panel.x + panel.w - noteW
  const fs = 7.2
  const lineH = fs * 1.25
  const maxChars = Math.max(18, Math.floor(noteW / (fs * 0.52)))
  const sorted = [...drawing.notes].sort((a, b) => b.z - a.z)
  const blocks = sorted.map((n) => ({ n, lines: wrapText(n.t, maxChars) }))
  const totalH = blocks.reduce((sum, b) => sum + b.lines.length * lineH, 0)
  const avail = panel.h - capH - 8
  const gapY =
    blocks.length > 1 ? Math.max(2, Math.min(6, (avail - totalH) / (blocks.length - 1))) : 0
  let cursor = panel.y + 6
  // ideal top from the anchor, pushed down to avoid overlap, then pulled up to fit
  const tops: number[] = []
  for (const b of blocks) {
    const h = b.lines.length * lineH
    const ideal = Math.max(panel.y + 6, Math.min(Y(b.n.z) - h / 2, panel.y + avail - h))
    const top = Math.max(ideal, cursor)
    tops.push(top)
    cursor = top + h + gapY
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const h = (blocks[i] as { lines: string[] }).lines.length * lineH
    const maxTop =
      i === blocks.length - 1 ? panel.y + avail - h : (tops[i + 1] as number) - gapY - h
    tops[i] = Math.min(tops[i] as number, maxTop)
  }
  blocks.forEach((b, i) => {
    const top = tops[i] as number
    const h = b.lines.length * lineH
    const ly = top + h / 2
    const tx = X(b.n.x)
    const ty = Y(b.n.z)
    const color = b.n.red ? '#c2372b' : '#333'
    const elbow = colX - 6
    out.push(
      `<path d="M${f(colX - 2)} ${f(ly)} L${f(elbow)} ${f(ly)} L${f(tx)} ${f(ty)}" fill="none" stroke="${color}" stroke-width="0.7"/>`,
    )
    out.push(`<circle cx="${f(tx)}" cy="${f(ty)}" r="1.3" fill="${color}"/>`)
    b.lines.forEach((line, j) => {
      out.push(
        `<text x="${f(colX)}" y="${f(top + lineH * (j + 0.8))}" font-size="${fs}" font-family="Helvetica, Arial, sans-serif" fill="${b.n.red ? '#c2372b' : INK}">${esc(line)}</text>`,
      )
    })
  })
  // caption: hex bubble + title + scale
  const cy = panel.y + panel.h - capH / 2
  const r = 9
  const hx = panel.x + r + 2
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return `${f(hx + Math.cos(a) * r)},${f(cy + Math.sin(a) * r)}`
  }).join(' ')
  out.push(`<polygon points="${hex}" fill="none" stroke="${INK}" stroke-width="1.2"/>`)
  out.push(
    `<text x="${f(hx)}" y="${f(cy + 3.5)}" font-size="9" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="${INK}" text-anchor="middle">${num}</text>`,
  )
  out.push(
    `<text x="${f(hx + r + 8)}" y="${f(cy - 1)}" font-size="10" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="${INK}">${esc(def.title)}</text>`,
  )
  out.push(
    `<text x="${f(hx + r + 8)}" y="${f(cy + 10)}" font-size="7.5" font-family="Helvetica, Arial, sans-serif" fill="#555">SCALE: ${esc(scaleLabel(s))}</text>`,
  )
  // panel frame
  out.push(
    `<rect x="${f(panel.x)}" y="${f(panel.y)}" width="${f(panel.w)}" height="${f(panel.h)}" fill="none" stroke="#999" stroke-width="0.6"/>`,
  )
  return out.join('')
}

/** The one-line provenance footer: which framed variables the sheet read. */
export function variablesLine(v: DetailVariables): string {
  const parts = [
    `studs ${nominal(v.stud.size)} @ ${v.stud.spacingIn}" o.c.`,
    `sheathing ${fmtIn(v.layers.sheathingIn)} · cladding ${fmtIn(v.layers.claddingIn)} · gyp ${fmtIn(v.layers.drywallIn)}`,
    v.header ? `headers ${nominal(v.header.size)}` : '',
    v.roof
      ? `rafters ${nominal(v.roof.rafter)} @ ${v.roof.spacingIn}" o.c., ${v.roof.pitchRise}:12${v.roof.ceilingJoist ? `, clg joists ${nominal(v.roof.ceilingJoist)}` : ''}`
      : '',
    v.foundation
      ? `${v.foundation.type === 'raised' ? 'raised floor' : 'slab on grade'} — footing ${fmtIn(v.foundation.footingWIn)}×${fmtIn(v.foundation.footingHIn)}, stem ${fmtIn(v.foundation.stemWIn)}, F.F. ${fmtFtIn(v.foundation.ffAboveGradeIn)} above grade${v.foundation.stepped ? ', footings stepped' : ''}`
      : '',
    v.deck ? `deck joists ${nominal(v.deck.joist)} PT` : '',
  ].filter((p) => p.length > 0)
  return `Variables read from the framed model: ${parts.join(' · ')}`
}

export type DetailsSheet = { title: string; body: string; footer: string; count: number }

/**
 * Lay the applicable details out on 3 × 2 panels per sheet. Returns the SVG
 * BODY (panels) per sheet; the plan set wraps it in its chrome.
 */
export function detailsSheetBodies(
  v: DetailVariables,
  frame: { x: number; y: number; w: number; h: number },
): DetailsSheet[] {
  const defs = DETAILS.filter((d) => d.applies(v))
  if (defs.length === 0) return []
  const cols = 3
  const rows = 2
  const gap = 10
  const pw = (frame.w - gap * (cols - 1)) / cols
  const ph = (frame.h - gap * (rows - 1)) / rows
  const perSheet = cols * rows
  const sheets: DetailsSheet[] = []
  for (let start = 0; start < defs.length; start += perSheet) {
    const chunk = defs.slice(start, start + perSheet)
    const body = chunk
      .map((def, i) => {
        const c = i % cols
        const r = Math.floor(i / cols)
        const panel: Panel = {
          x: frame.x + c * (pw + gap),
          y: frame.y + r * (ph + gap),
          w: pw,
          h: ph,
        }
        return renderDetail(def, v, panel, start + i + 1)
      })
      .join('')
    sheets.push({
      title: sheets.length === 0 ? 'Typical details' : `Typical details (${sheets.length + 1})`,
      body,
      footer: variablesLine(v),
      count: chunk.length,
    })
  }
  return sheets
}
