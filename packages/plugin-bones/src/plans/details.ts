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
import { HOLD_DOWN, HURRICANE_TIE, hangerFor, postBaseFor } from '../engines/hardware'
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
    /** Pre-engineered trusses: the "rafter" is the top chord. */
    truss: boolean
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
  /** The porch cover's 6x6 posts were framed (a guard runs into them). */
  porchPosts: boolean
  /** A guard is built: a deck's edge or a porch's post line. */
  guard: boolean
  /** The energy code's prescriptive values for the site (null = not citable: the note says "per energy code"). */
  insulation: { wallR: string; ceilingR: string | null; floorR: string | null }
}

/** What the sheets hand the details from the jurisdiction's prescriptive table. */
export type DetailInsulation = { wallR?: string | null; ceilingR?: string | null; floorR?: string | null }

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
/**
 * The station spacing (in) of a joist family read off the members: the
 * largest group (one roof) spreads its stations along one axis; the gaps
 * between neighbouring stations vote for 12 / 16 / 24 within ±2 in (a
 * station sistered beside a rafter sits 1.5 in off the grid; the lapped
 * pieces beside their mates are closer than 3 in and do not vote).
 */
export function stationSpacingIn(members: readonly Member[]): number | null {
  const bySource = new Map<string, Member[]>()
  for (const m of members) bySource.set(m.sourceId, [...(bySource.get(m.sourceId) ?? []), m])
  const group = [...bySource.values()].sort((a, b) => b.length - a.length)[0]
  if (group === undefined || group.length < 3) return null
  const xs = group.map((m) => m.position[0])
  const zs = group.map((m) => m.position[2])
  const range = (v: number[]) => Math.max(...v) - Math.min(...v)
  const coords = [...new Set((range(xs) >= range(zs) ? xs : zs).map((v) => Math.round(v * 1000)))]
    .sort((a, b) => a - b)
    .map((v) => v / 1000 / IN)
  const gaps: number[] = []
  for (let i = 1; i < coords.length; i++) {
    const g = (coords[i] as number) - (coords[i - 1] as number)
    if (g > 3) gaps.push(g)
  }
  if (gaps.length === 0) return null
  let best: number | null = null
  let bestVotes = 0
  for (const c of [12, 16, 24]) {
    const votes = gaps.filter((g) => Math.abs(g - c) <= 2).length
    if (votes > bestVotes) {
      best = c
      bestVotes = votes
    }
  }
  return best
}

export function detailVariables(
  members: Member[],
  spec: FramingSpec = DEFAULT_SPEC,
  foundation?: DetailFoundation | null,
  insulation?: DetailInsulation | null,
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
  // a trussed roof's sloped top chords are its rafters for the eave's purposes
  const truss = roofMembers.some((m) => m.role === 'truss-chord')
  const rafters = roofMembers.filter(
    (m) =>
      (m.role === 'rafter' || (m.role === 'truss-chord' && Math.abs(m.rotation[2]) > 0.01)) &&
      isLumber(m.size) &&
      !/ledger|porch/i.test(m.label ?? ''),
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
  // W15 may tighten a segment's joists to 12" o.c. — read the spacing off the members
  const cjSpacingIn = stationSpacingIn(roofMembers.filter((m) => m.role === 'ceiling-joist'))
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
  const porchPosts = members.some((m) => m.role === 'post' && /porch post/i.test(m.label ?? ''))
  const wallR =
    insulation?.wallR?.replace(/^R(\d)/, 'R-$1') ?? (studDepth >= 5 ? 'R-21' : 'R-15')
  return {
    stud: {
      size: studSize,
      depthIn: round(studDepth),
      spacingIn: Math.round(spec.studSpacing / IN),
      plates: spec.topPlateCount,
      batt: wallR,
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
            ceilingJoistSpacingIn: cjSpacingIn ?? Math.round(spec.ceilingJoistSpacing / IN),
            ties: roofMembers.some((m) => /hurricane tie|H2\.5/i.test(m.label ?? '')),
            fascia: roofMembers.some((m) => m.role === 'fascia'),
            truss,
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
    porchPosts,
    guard: (deckLedger && deckJoists.length > 0) || porchPosts,
    insulation: {
      wallR,
      ceilingR: insulation?.ceilingR?.replace(/^R(\d)/, 'R-$1') ?? null,
      floorR: insulation?.floorR?.replace(/^R(\d)/, 'R-$1') ?? null,
    },
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
      S.note(
        `GIRDER POSTS ON PADS W/ SIMPSON ${postBaseFor('4x4').model} BASES${f.plateWashers ? ` — SIMPSON ${HOLD_DOWN.model} HOLD-DOWNS @ BRACED WALL ENDS` : ''}`,
        stemW / 2 + 12,
        ftgTop,
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
      r.truss
        ? `TRUSS TOP CHORD ${nominal(r.rafter)} @ ${r.spacingIn}" O.C. — ${r.pitchRise}:12, MFR DESIGN (R802.10)`
        : `RAFTER ${nominal(r.rafter)} @ ${r.spacingIn}" O.C. — ${r.pitchRise}:12 (R802.4.1)`,
      spanX * 0.35,
      zAt(spanX * 0.35) + memD / 2,
    )
    S.note(
      r.truss
        ? 'TRUSS BOTTOM CHORD ON THE PLATE — THE CEILING MEMBER AND RAFTER TIE (R802.10.1); NO NOTCHING'
        : `CLG JOIST ${r.ceilingJoist ? nominal(r.ceilingJoist) : '2X6'} @ ${r.ceilingJoistSpacingIn}" O.C. — FACE-NAIL TO RAFTER PER T. R802.5.2 + (3) 8d TOE TO PLATE`,
      8.5,
      3.4,
    )
    S.note(
      `CLG INSUL ${v.insulation.ceilingR ? `${v.insulation.ceilingR} (N1102.1.3)` : 'PER ENERGY CODE'} — BAFFLE 1" MIN AIR @ VENT (R806.3)`,
      spanX - 5,
      6.8,
    )
    if (r.fascia)
      S.note(
        '2X FASCIA + GUTTER PER PLAN — VENTED SOFFIT, CONT. 2" STRIP VENT',
        tailX - 0.75,
        zAt(tailX) + memD - 2,
      )
    S.note(
      r.ties
        ? `FULL-DEPTH 2X BLOCKING + SIMPSON ${HURRICANE_TIE.model} @ EA. RAFTER (R802.11) — SHEAR + UPLIFT TRANSFER`
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
    S.note(`JOIST HANGER EA. JOIST — SIMPSON ${hangerFor(dk.joist).model} OR EQ.`, -3.6, -3.5)
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
      `2X LEDGER — LAG OR THRU-BOLT TO STUDS @ 16" O.C. (VERIFY); RAFTER ${nominal(p.rafter)} ON SIMPSON ${hangerFor(p.rafter).model} HANGER`,
      -sh - 0.75,
      rd / 2,
    )
    S.note(`UPPER WALL ${nominal(v.stud.size)} STUDS + SHTG CONT. PAST THE PORCH ROOF`, d / 2, 16)
    return S
  },
}


// ---- 7. DECK / PORCH GUARD @ RIM (AWC DCA 6) ---------------------------------
/**
 * The guard the fence and stair nodes build (DCA 6's guard: 4x4 posts, a
 * 2x6 cap flat over a 2x4 top rail, 2x2 balusters on a 2x4 bottom rail),
 * at its post: the post bolted through the rim and the blocking beside it
 * with a tension tie into the joist — the connection that keeps a 200 lb
 * top-rail load from prying the post off the deck (Table R301.5).
 */
const guardDetail: DetailDef = {
  id: 'deckguard',
  title: 'DECK / PORCH GUARD @ POST',
  applies: (v) => v.guard,
  draw(v) {
    const S = sketch()
    const jd = v.deck?.joistDepthIn ?? 9.25
    const H = 36
    const onDeck = v.deck !== null
    if (onDeck) {
      // decking over the joist bay, the rim at x = 0, a joist and the post's blocking behind it
      S.rect(-16, 1, 17.5, 1, WOOD)
      S.rect(-16, 0, 16, jd, BAY)
      S.xRect(-16, 0, 1.5, jd, WOOD2)
      S.xRect(-7, 0, 1.5, jd, WOOD2)
      S.xRect(0, 0, 1.5, jd)
      // (2) 1/2" through-bolts, washers both ends; the tension tie on the joist
      for (const bz of [-2, -(jd - 2)]) {
        S.line(-7.6, bz, 5.6, bz, NAIL, 1.4)
        S.dot(5.3, bz, 0.5, NAIL)
        S.dot(-7.3, bz, 0.5, NAIL)
      }
      S.rect(-5.5, -(jd - 5.5), 4.5, 2.4, '#6d7a86')
      S.line(-5.5, -(jd - 4.3), 5.3, -(jd - 4.3), NAIL, 1.4)
    } else {
      // a concrete porch: the post on a standoff base, anchored to the slab
      S.rect(-16, 1, 24, 5, CONC)
      S.rect(1.2, 1.5, 4.1, 1.2, '#6d7a86')
      S.line(3.25, 1.5, 3.25, -3.5, NAIL, 1.4)
      S.rect(-18, -4, 28, 4, EARTH)
    }
    // the 4x4 post from the rim bottom (or the slab) to the cap
    S.rect(1.5, H + 1, 3.5, H + 1 + (onDeck ? jd : -1.5), WOOD)
    // 2x6 cap flat over the post; 2x4 top and bottom rails on edge; a 2x2 baluster between them
    S.xRect(0.5, H + 2.5, 5.5, 1.5, WOOD)
    S.xRect(2.5, H + 1, 1.5, 3.5, '#efe6d4')
    S.xRect(2.5, 8, 1.5, 3.5, '#efe6d4')
    S.rect(2.5, H - 2.5, 1.5, H - 2.5 - 8, '#efe6d4')
    // the guard height, decking to cap
    S.line(9, 1, 9, H + 2.5, '#333', 0.8)
    S.line(8.2, 1, 9.8, 1, '#333', 0.8)
    S.line(8.2, H + 2.5, 9.8, H + 2.5, '#333', 0.8)
    S.text(9.8, (H + 3.5) / 2, `${fmtIn(H)} MIN`, 'start')
    S.note('2x6 CAP RAIL FLAT OVER THE POSTS — POSTS ≤ 6\'-0" O.C. (AWC DCA 6)', 3.25, H + 1.75)
    S.note(
      '2x4 TOP & BOTTOM RAILS ON EDGE; 2x2 BALUSTERS @ 5" O.C. — 3-1/2" CLR (4" SPHERE, R312.1.3)',
      3.25,
      (H + 4.5) / 2,
    )
    S.note('BOTTOM RAIL UNDERSIDE ≤ 4" ABOVE DECKING (R312.1.3)', 3.25, 6.5)
    S.note(
      `GUARD ${fmtIn(H)} MIN ABOVE THE WALKING SURFACE (R312.1.2) — 200 LB CONCENTRATED LOAD (TABLE R301.5)`,
      9.2,
      H - 6,
    )
    if (onDeck) {
      S.note(
        `4x4 PT GUARD POST — (2) 1/2"Ø THRU-BOLTS + WASHERS THRU THE RIM & BLOCKING, SIMPSON DTT2Z TENSION TIE TO THE JOIST (DCA 6 FIG. 24; R507.9.2 / R301.5)`,
        3.25,
        -(jd / 2),
      )
      S.note('2x BLOCKING BETWEEN JOISTS @ EACH POST (DCA 6)', -6.25, -(jd / 2) + 1.5)
      S.note(`${nominal(v.deck?.joist ?? '2x8')} PT RIM & JOISTS PER PLAN (R507.5, R507.6)`, 0.75, -1)
      S.note('DECKING — 5/4 PT OR COMPOSITE, 1/8" GAPS', -8, 1.5)
    } else {
      S.note(
        `6x6 PORCH POST ON SIMPSON ${postBaseFor('6x6').model} STANDOFF BASE — 5/8"Ø ANCHOR INTO THE SLAB (R507.4.1, R317.1)`,
        3.25,
        2.1,
      )
      S.note('CONC. PORCH SLAB PER FOUNDATION PLAN', -8, 3.5)
    }
    return S
  },
}

// ---- 8. STAIR GUARD & HANDRAIL -----------------------------------------------
/**
 * The entrance flight's guard, in elevation: the DCA 6 stair guard the
 * stair node builds — 4x4 posts at the bottom and every ≤ 4 ft, the top
 * rails dying into the porch's 6x6 — with the code's numbers on it: riser,
 * tread, the guard height off the nosing line, the handrail a flight of
 * four or more risers must carry.
 */
const stairGuardDetail: DetailDef = {
  id: 'stairguard',
  title: 'STAIR GUARD & HANDRAIL',
  applies: (v) => v.guard,
  draw(v) {
    const S = sketch()
    const rise = 7
    const run = 11
    const n = 3
    const top = rise * n
    const H = 36
    const nose = (x: number) => rise + (x / run) * rise
    // grade and the landing (deck edge at x = n × run)
    S.rect(-10, 0, 10 + n * run + 6, 4, EARTH)
    S.rect(-6, 0, 6, 4, CONC)
    // the stringer band under the nosings, the treads and risers
    S.poly(
      [
        [0, nose(0) - 1.5],
        [n * run, top - 1.5],
        [n * run, top - 1.5 - 9.25],
        [0, nose(0) - 1.5 - 9.25],
      ],
      WOOD2,
    )
    for (let i = 0; i < n; i++) {
      const x = i * run
      const z = rise * (i + 1)
      S.rect(x - 1, z, run + 1, 1.5, WOOD)
      S.line(x, z - 1.5, x, z - rise, '#5a4a38', 1)
    }
    // the deck / porch landing
    S.rect(n * run, top + 1, 8, top + 1 - 4, WOOD)
    // posts: 4x4 at the bottom, the porch 6x6 at the top
    S.rect(-1.5, nose(0) + H + 1.5, 3.5, nose(0) + H + 1.5 + 6, WOOD)
    S.rect(n * run + 1, top + H + 8, 5.5, top + H + 8 + 10, WOOD)
    // cap rail 2x6 sloped 36" over the nosing line, the 2x4 top rail under it, the bottom rail 4" over the nosings
    const capZ = (x: number) => nose(x) + H
    S.poly(
      [
        [-1.5, capZ(-1.5)],
        [n * run + 1, capZ(n * run + 1)],
        [n * run + 1, capZ(n * run + 1) + 1.5],
        [-1.5, capZ(-1.5) + 1.5],
      ],
      WOOD,
    )
    S.poly(
      [
        [2, capZ(2) - 3.5],
        [n * run + 1, capZ(n * run + 1) - 3.5],
        [n * run + 1, capZ(n * run + 1)],
        [2, capZ(2)],
      ],
      '#efe6d4',
    )
    S.poly(
      [
        [2, nose(2) + 4],
        [n * run + 1, nose(n * run + 1) + 4],
        [n * run + 1, nose(n * run + 1) + 7.5],
        [2, nose(2) + 7.5],
      ],
      '#efe6d4',
    )
    for (let x = 6; x < n * run - 1; x += 5) {
      S.rect(x - 0.75, capZ(x) - 3.5, 1.5, capZ(x) - 3.5 - (nose(x) + 7.5), '#efe6d4')
    }
    // the handrail a 4+ riser flight adds: 34"–38" over the nosings, graspable
    S.line(0, nose(0) + 34, n * run, nose(n * run) + 34, INK, 1.6, '5 3')
    // the guard height, off the nosing line
    const gx = n * run - 4
    S.line(gx, nose(gx), gx, capZ(gx) + 1.5, '#333', 0.8)
    S.text(gx + 0.6, nose(gx) + H / 2, `${fmtIn(H)} MIN`, 'start')
    S.note(
      `RISERS ≤ 7-3/4", TREADS ≥ 10" (R311.7.5.1, R311.7.5.2); ${n} RISERS @ ${fmtIn(rise)} SHOWN — PER PLAN`,
      run,
      rise * 2 - 0.75,
    )
    S.note('2x12 PT STRINGERS @ 16" O.C. — 5" MIN THROAT, HANGERS AT THE RIM (R311.7, R507.6)', run * 1.5, nose(run * 1.5) - 6)
    S.note('STRINGERS BEAR ON A CONC. LANDING PAD — 36" × THE STAIR WIDTH (R311.7.6)', -3, 2)
    S.note(
      `GUARD ${fmtIn(H)} MIN, MEASURED VERTICALLY FROM THE NOSING LINE (R312.1.2); 4" SPHERE BETWEEN PICKETS, 6" IN THE TREAD/RISER TRIANGLE (R312.1.3)`,
      gx + 0.3,
      nose(gx) + H * 0.8,
    )
    S.note('2x6 CAP + 2x4 TOP & BOTTOM RAILS FOLLOW THE FLIGHT; 2x2 PICKETS @ 5" O.C.', run * 1.2, capZ(run * 1.2) + 0.75)
    S.note(
      '4x4 PT POST AT THE BOTTOM AND EVERY ≤ 4\'-0" — RAILS DIE INTO THE PORCH 6x6 AT THE TOP (NO POST BESIDE IT)',
      0.25,
      nose(0) + H / 2,
    )
    S.note(
      'HANDRAIL WHERE 4 OR MORE RISERS: 34"–38" ABOVE NOSINGS, GRASPABLE TYPE I (1-1/4"–2") OR TYPE II, RETURNED TO THE POSTS (R311.7.8)',
      run * 2,
      nose(run * 2) + 34,
    )
    return S
  },
}

// ---- 9. GABLE END — SHEAR TRANSFER & BRACING ---------------------------------
/**
 * The gable end from the attic side: the end frame (a truss or the gable
 * studs on the plate), blocked to the roof at the wall line so the
 * diaphragm's shear reaches the wall, strapped for uplift, and braced back
 * into the attic — the horizontal braces on the bottom chords and the
 * diagonals that keep a tall gable end from hinging in a hurricane (the
 * Florida gable-end detail, R602.10.8.2's connections to roof framing).
 */
const gableEndDetail: DetailDef = {
  id: 'gableend',
  title: 'GABLE END — SHEAR TRANSFER & BRACING',
  applies: (v) => v.roof !== null,
  draw(v) {
    const S = sketch()
    const r = v.roof as NonNullable<DetailVariables['roof']>
    const slope = r.pitchRise / 12
    const half = 72
    const peak = half * slope
    const d = v.stud.depthIn
    // the wall below the plate, the double top plate, the gable end frame above it
    S.rect(-half, 0, 2 * half, 14, BAY)
    S.xRect(-half, 0, 2 * half, 1.5)
    S.xRect(-half, -1.5, 2 * half, 1.5)
    for (let x = -half + 16; x < half; x += 16) S.rect(x - 0.75, 0, 1.5, 14, WOOD2)
    S.poly(
      [
        [-half, 0],
        [half, 0],
        [0, peak],
      ],
      '#f1ede6',
    )
    // top chords / rafters, the bottom chord on the plate, gable studs @ 24" o.c.
    S.poly([[-half, 0], [0, peak], [0, peak + 3.5 / Math.cos(Math.atan(slope))], [-half, 3.5]], WOOD)
    S.poly([[half, 0], [0, peak], [0, peak + 3.5 / Math.cos(Math.atan(slope))], [half, 3.5]], WOOD)
    S.xRect(-half, 3.5, 2 * half, 3.5, WOOD)
    for (let x = -half + 24; x < half; x += 24) {
      const zTop = peak - Math.abs(x) * slope
      S.rect(x - 0.75, zTop, 1.5, zTop - 3.5, WOOD2)
    }
    // horizontal braces (2x4 flat, seen end-on) back into the attic: on the bottom chord every 4 ft, and mid-height on studs over 4 ft
    for (let x = -half + 24; x < half; x += 48) {
      S.rect(x - 0.75, 5.5, 3.5, 1.5, '#8a6a3a')
      const zTop = peak - Math.abs(x) * slope
      if (zTop > 48 + 3.5) S.rect(x - 0.75, zTop / 2 + 1.5, 3.5, 1.5, '#8a6a3a')
    }
    // the diagonal braces to the bottom chords, blocking between the end frame and the next truss at the wall line, the straps
    S.line(-12, peak - 12 * slope - 6, -40, 5.5, '#8a6a3a', 2.2, '6 3')
    S.line(12, peak - 12 * slope - 6, 40, 5.5, '#8a6a3a', 2.2, '6 3')
    for (let x = -half + 24; x < half; x += 24) {
      const zTop = peak - Math.abs(x) * slope
      S.rect(x - 12, zTop - 0.5 + 12 * slope * (x < 0 ? -1 : 1) * 0, 1.5, 3.5, NAIL)
    }
    for (const x of [-half + 8, -8, 8, half - 8]) S.line(x, -1.5, x, 4.5, FLASH, 1.6)
    S.note(
      `GABLE END ${r.truss ? 'TRUSS' : 'FRAME'} ON THE DOUBLE TOP PLATE — ${r.truss ? 'MFR DESIGN' : `GABLE STUDS 2x4 @ 24" O.C., ${nominal(r.rafter)} RAFTERS`}; VERTICAL STUDS @ 24" O.C. (R602.3)`,
      -half + 30,
      1.75,
    )
    S.note(
      'FULL-DEPTH 2x BLOCKING BETWEEN THE END FRAME AND THE NEXT TRUSS/RAFTER @ 24" O.C. — ROOF SHTG EDGE-NAILED 8d @ 6" TO THE BLOCKING, BLOCKING TO THE PLATE (3) 16d TOE OR SIMPSON A35 EA. (R602.10.8.2, R803.2)',
      -half + 12,
      peak - (half - 12) * slope - 2,
    )
    S.note(
      `${HURRICANE_TIE.model} OR LSTA STRAP AT EACH TRUSS/RAFTER AND AT THE GABLE END FRAME — UPLIFT (R802.11)${v.stud ? '' : ''}`,
      -half + 8,
      1.5,
    )
    S.note(
      '2x4 HORIZONTAL BRACES ON THE BOTTOM CHORDS @ 4\'-0" O.C., BACK 3 TRUSSES (6\'-0") MIN — (2) 16d @ EACH CHORD; AT MID-HEIGHT OF GABLE STUDS OVER 4\'-0" (R602.10.8.2(2) LATERAL SUPPORT — VERIFY WITH THE TRUSS MFR / LOCAL GABLE-END DETAIL)',
      -half + 24 + 1,
      6.25,
    )
    S.note('2x4 DIAGONAL BRACE FROM THE GABLE STUD TO THE BRACE @ THE 3RD TRUSS — (2) 16d EA. END', -26, peak - 26 * slope - 3 - (peak - 26 * slope - 6 - 5.5) / 2)
    S.note('WALL SHTG CONTINUOUS OVER THE PLATE TO THE END FRAME OR CS16 STRAPS STUD-TO-GABLE STUD @ 48" O.C. (R602.3.3)', half - 20, 8)
    return S
  },
}

// ---- 10. FIREBLOCKING & DRAFTSTOPPING ----------------------------------------
/**
 * Where a house's concealed spaces are cut off from each other (R302.11):
 * the plates at the ceiling line, the soffit / drop that would let a wall
 * bay open into a horizontal space, penetrations through the plates, the
 * stair stringers — and the materials that count.
 */
const fireblockDetail: DetailDef = {
  id: 'fireblock',
  title: 'FIREBLOCKING @ SOFFIT & PENETRATIONS',
  applies: () => true,
  draw(v) {
    const S = sketch()
    const d = v.stud.depthIn
    const gy = Math.max(0.4, v.layers.drywallIn)
    const H = 30
    // the wall: stud bay, plates at the ceiling line (z = 0), gypsum inside (x > d)
    S.rect(0, 0, d, H, BAY)
    S.batt(0, -1.8, -(H - 2), d)
    S.xRect(0, 0, d, 1.5)
    S.xRect(0, -1.5, d, 1.5)
    S.rect(-0.5, 0, 0.5, H, SHTG)
    // the ceiling joist bay above the plate and the ceiling gypsum
    S.rect(-0.5, 12, 30, 12, '#f1ede6')
    S.rect(d, 0, 26, gy, GYP)
    // a kitchen soffit hung 12" below the ceiling, 24" into the room, framed with 2x2s
    const sz = -12
    S.rect(d + gy, sz, 24, 12 + sz - sz, '#faf8f4')
    S.rect(d + gy, sz, 24, gy, GYP)
    S.rect(d + gy + 24, 0, gy, 12, GYP)
    S.xRect(d + gy, sz + 1.5, 1.5, 1.5, WOOD2)
    S.xRect(d + gy + 24 - 1.5, sz + 1.5, 1.5, 1.5, WOOD2)
    S.xRect(d + gy + 24 - 1.5, -1.5, 1.5, 1.5, WOOD2)
    // the fireblock: solid 2x in the stud bay at the soffit line; the block closing the soffit to the ceiling
    S.xRect(0, sz + 0.75, d, 1.5, '#c94b3b')
    S.xRect(d + gy + 24 - 1.5, -1.5 - 1.5, 1.5, 1.5, '#c94b3b')
    // a pipe through the top plate, packed
    S.dot(d / 2, -0.75, 1.2, '#dfe7ee')
    S.rect(d / 2 - 1.9, 1.6, 3.8, 1.6, '#c94b3b')
    S.rect(d, gy, 26, 0, GYP)
    S.note('DOUBLE TOP PLATE — THE FIREBLOCK AT THE CEILING LINE (R302.11(1))', d / 2, -0.75)
    S.note(
      'SOLID 2x FIREBLOCK IN EVERY STUD BAY AT THE SOFFIT / DROPPED-CEILING LINE — THE WALL BAY MAY NOT OPEN INTO A HORIZONTAL SPACE (R302.11(2))',
      d / 2,
      sz,
    )
    S.note('2x BLOCK CLOSING THE SOFFIT TO THE CEILING (R302.11(2)) — GYP BD SOFFIT (R702.3)', d + gy + 23.25, -2.25)
    S.note('MINERAL WOOL OR APPROVED FIRE CAULK PACKED AROUND PIPES, DUCTS, CABLES AND VENTS AT PLATES (R302.11(4))', d / 2, 2.4)
    S.note(
      'MATERIALS: 2x NOMINAL LUMBER, (2) 1x, 23/32" WSP, 1/2" GYP BD, MINERAL WOOL (R302.11.1); HORIZONTAL FIREBLOCKING @ 10\'-0" MAX IN CONCEALED FURRED SPACES (R302.11(1))',
      d / 2,
      -(H - 6),
    )
    S.note('FIREBLOCK STAIR STRINGERS AT THE TOP AND BOTTOM OF THE RUN (R302.11(3)); DRAFTSTOP CONCEALED FLOOR-CEILING SPACES OVER 1,000 SF (R302.12)', d / 2, -(H - 14))
    return S
  },
}

// ---- 11. WINDOW JAMB — FLASHING SEQUENCE -------------------------------------
/**
 * The opening in plan at the jamb (king and jack studs, the sheathing,
 * the WRB, the fin and its flashing, the cladding held off the frame) with
 * the flashing sequence numbered the way the WRB manufacturer's and ASTM
 * E2112's installation is written: pan, fins, jambs, head, WRB over.
 */
const windowJambDetail: DetailDef = {
  id: 'windowjamb',
  title: 'WINDOW JAMB & FLASHING SEQUENCE',
  applies: (v) => v.header !== null,
  draw(v) {
    const S = sketch()
    const d = v.stud.depthIn
    const cl = Math.max(0.6, v.layers.claddingIn)
    const sh = Math.max(0.4, v.layers.sheathingIn)
    const gy = Math.max(0.4, v.layers.drywallIn)
    // plan: x through the wall (outside at the left), z along the wall (the opening above z = 3)
    S.rect(-cl - sh, 0, cl, 2.6, CLAD)
    S.rect(-sh, 0, sh, 3, SHTG)
    S.xRect(0, 0, d, 1.5, WOOD) // king stud
    S.xRect(0, 1.5, d, 1.5, WOOD2) // jack (trimmer)
    S.rect(d, 0, gy, 3, GYP)
    S.rect(d - 0.75, 3, 0.75, 6, WOOD2) // jamb extension / casing
    // the window frame in the opening with its nailing fin on the sheathing
    S.rect(-sh - 0.6, 3, 2.6, 3, '#dfe7ee')
    S.rect(-sh - 0.1, 2.6, 0.1, 1.6, '#9aa4ae')
    S.line(-sh + 0.9, 4.2, -sh + 0.9, 9, '#7f8a95', 1.2)
    // WRB on the sheathing; jamb flashing over the fin lapping the WRB; sealant at the fin and at the frame edge
    S.line(-sh - 0.05, 0, -sh - 0.05, 2.7, FLASH, 1.1, '4 2')
    S.line(-sh - 0.2, 1.0, -sh - 0.2, 4.2, FLASH, 1.6)
    S.dot(-sh - 0.3, 2.9, 0.3, '#333')
    S.dot(-cl - sh - 0.2, 2.8, 0.3, '#333')
    S.text(-sh - 2.2, 1.6, '3', 'middle')
    S.text(-sh - 2.2, 3.4, '2', 'middle')
    S.note(`KING + JACK STUDS ${nominal(v.stud.size)} — HEADER ${v.header ? nominal(v.header.size) : ''} PER PLAN (R602.7)`, d / 2, 0.75)
    S.note('1 — SILL PAN FLASHING FIRST: TURN UP 4"–6" AT THE JAMBS, BACK DAM AT THE INTERIOR (R703.4)', -sh - 0.2, 0.3)
    S.note('2 — WINDOW SET PLUMB IN A BEAD OF SEALANT BEHIND THE FIN (SIDES + HEAD, NOT THE SILL); FIN NAILED PER MFR (R609.1)', -sh - 0.1, 3.4)
    S.note('3 — JAMB FLASHING (4" MIN SELF-ADHERED) OVER THE FIN, LAPPING THE WRB BELOW AND THE PAN', -sh - 0.2, 1.6)
    S.note('4 — HEAD FLASHING OVER THE TOP FIN; 5 — WRB LAPPED OVER THE HEAD FLASHING, SHINGLE-STYLE (R703.4, R703.2)', -sh - 0.05, 2.2)
    S.note(`6 — CLADDING HELD 1/4"–3/8" OFF THE FRAME, SEALANT + BACKER ROD; ${fmtIn(cl)} CLADDING O/ WRB`, -cl - sh + cl / 2, 1.3)
    S.note('INTERIOR: LOW-EXPANSION FOAM OR BACKER + SEALANT AT THE SHIM SPACE (AIR BARRIER, N1102.4.1.1); JAMB EXTENSION + CASING', d, 4.5)
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
  guardDetail,
  stairGuardDetail,
  gableEndDetail,
  fireblockDetail,
  windowJambDetail,
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
    `insulation ${v.insulation.wallR} walls${v.insulation.ceilingR ? `, ${v.insulation.ceilingR} ceiling` : ''} (energy code)`,
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
