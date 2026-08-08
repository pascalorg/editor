import {
  type CastableElement,
  classifyElementFaces,
  collectCastableElements,
  cornerLegLength,
  DEFAULT_COLUMN_KICKER_MM,
  DEFAULT_FORMWORK_SYSTEM_ID,
  DEFAULT_INSIDE_CORNER_LEG_M,
  DEFAULT_KICKER_MM,
  type ElementCorner,
  type FaceRole,
  type FormworkFace,
  type FormworkSettings,
  type FormworkSystem,
  findAbutments,
  findFormworkSettingsNode,
  findJunctions,
  fitCorner,
  formworkSettings,
  formworkSystem,
  hardCutsForElement,
  layOutFace,
  type PourUnit,
  pourUnitsForElement,
  type StripPack,
  type StripPiece,
  tieHoles,
} from '@pascal-app/core/formwork'
import type { GeometryContext } from '@pascal-app/core/registry'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { MeshStandardMaterial } from 'three'
import type { CastableHostNode } from './attach'
import type { FormworkAssemblyNode } from './schema'

/**
 * The parts of a shutter that are the same whatever is being cast: the board
 * and member sizes, the coverage lookup, and the pour unit the assembly covers.
 * The three per-kind builders differ only in where they put those parts.
 *
 * v1: plain colored boxes, no textures/slots — see
 * `wiki/formwork-system-plan.md` decision #2. Every part is a named child
 * (`panel-*`, `tie-*`, `waler-*`, `clamp-*`, `prop-*`, `scaffold-*`) so a
 * future `inspect_formwork` AI tool can count them without re-deriving the
 * layout math.
 */

export const PANEL_THICKNESS = 0.02
export const PANEL_GAP = 0.005
export const TIE_SIZE = 0.03
export const WALER_HEIGHT = 0.08
export const WALER_DEPTH = 0.1

/**
 * The upstand cast with the slab that a wall form stands against and locates off.
 * It is part of the wall rather than of the shutter, so the courses start at its
 * top — which is why a wall shutter is clear of the floor without a margin having
 * to be invented for it.
 */
export const KICKER_M = DEFAULT_KICKER_MM / 1000

/**
 * The kicker a column form lands on. Shorter than a wall's, because it locates a
 * box rather than holding a shutter's line over a length, so the wall's figure is
 * not reusable here.
 */
export const COLUMN_KICKER_M = DEFAULT_COLUMN_KICKER_MM / 1000

// Scaffold: uprights standing off beyond the walers, tied together with
// horizontal ledgers every lift and a diagonal brace per bay — the
// minimum assembly that actually holds a shutter face upright on site.
export const SCAFFOLD_STANDOFF = 0.35 // gap beyond the waler face
export const SCAFFOLD_BAY = 1.8 // upright spacing along the wall
export const SCAFFOLD_LIFT = 2.0 // ledger row spacing up the wall
export const SCAFFOLD_POST_SIZE = 0.05
export const SCAFFOLD_LEDGER_SIZE = 0.045
export const SCAFFOLD_BRACE_SIZE = 0.035

export const tieMaterial = new MeshStandardMaterial({ color: '#4a4a4a' }) // steel tie
export const walerMaterial = new MeshStandardMaterial({ color: '#6b4a2f' }) // timber waler
export const scaffoldMaterial = new MeshStandardMaterial({ color: '#c77b1a' }) // galvanized tube

export function panelColor(formworkType: CastableHostNode['formworkType']): string {
  if (formworkType === 'steel-panel') return '#8a8f94'
  if (formworkType === 'aluminium') return '#c7ccd1'
  return '#c9b896' // plywood / default
}

export function panelMaterial(host: CastableHostNode): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: panelColor(host.formworkType) })
}

/**
 * Resolves the host's level siblings and the openings they host, so the
 * coverage engine can see which elements abut it. Without the siblings every
 * end looks free and the shutter grows stop-ends it doesn't need; without the
 * openings it panels straight over the door.
 */
export function resolveLevelElements(host: CastableHostNode, ctx: GeometryContext): AnyNode[] {
  const parentId = host.parentId
  const resolve = (id: string) => ctx.resolve<AnyNode>(id as Parameters<typeof ctx.resolve>[0])
  const level = parentId ? resolve(parentId) : undefined
  const childIds = (level as { children?: string[] } | undefined)?.children ?? []
  const elements: AnyNode[] = []
  for (const id of childIds) {
    const node = resolve(id)
    if (node) elements.push(node)
  }
  if (elements.length === 0) elements.push(host as AnyNode)

  // Keyed by id: an opening reachable both as a level child and as its host's
  // child must still be counted once, or its area is deducted twice.
  const out = new Map<string, AnyNode>(elements.map((element) => [element.id as string, element]))
  for (const element of elements) {
    for (const child of (element as { children?: string[] }).children ?? []) {
      const node = resolve(child)
      if (node && (node.type === 'door' || node.type === 'window')) out.set(node.id as string, node)
    }
  }
  return [...out.values()]
}

/**
 * The project's pour settings, found by climbing the host's ancestors.
 *
 * A `GeometryContext` resolves nodes by id and has no scene-wide iteration, so
 * the node is reached the way the level's siblings are: from the host upwards,
 * checking each ancestor's children. The settings live on the site, but climbing
 * rather than assuming a depth means a scene that parents them to a building or
 * a level still finds them instead of silently designing to the defaults.
 */
function resolveFormworkSettings(host: CastableHostNode, ctx: GeometryContext): FormworkSettings {
  const resolve = (id: string) => ctx.resolve<AnyNode>(id as Parameters<typeof ctx.resolve>[0])
  let ancestor = host.parentId ? resolve(host.parentId) : undefined
  while (ancestor) {
    const childIds = (ancestor as { children?: string[] }).children ?? []
    const found = findFormworkSettingsNode(
      childIds.map(resolve).filter((node): node is AnyNode => node !== undefined),
    )
    if (found) return formworkSettings(found)
    const parentId = ancestor.parentId
    ancestor = parentId ? resolve(parentId) : undefined
  }
  return formworkSettings(undefined)
}

/**
 * The pour unit this assembly covers. Falls back to the whole element when the
 * scene has no split — and also when the indices name a unit that no longer
 * exists, which happens when the host's lift cap is relaxed after the
 * assemblies were created. Building nothing in that case would silently hide
 * the shutter; the inspector's scope readout is where the mismatch belongs.
 */
function resolvePourUnit(
  element: CastableElement,
  node: FormworkAssemblyNode,
  levelNodes: AnyNode[],
): PourUnit | undefined {
  const units = pourUnitsForElement(
    element,
    {},
    hardCutsForElement(element.id as AnyNodeId, levelNodes),
  )
  if (units.length <= 1) return undefined
  return units.find(
    (unit) => unit.segmentIndex === node.segmentIndex && unit.liftIndex === node.liftIndex,
  )
}

export interface FormworkScope {
  element: CastableElement
  unit: PourUnit | undefined
  /** Which faces actually need forming — a function of cast order, not a constant. */
  isFormed: (role: FaceRole) => boolean
  /** The classified face itself, for the properties a shutter part has to carry. */
  faceOf: (role: FaceRole) => FormworkFace | undefined
  /** Corner units this shutter's faces turn onto, formed and unformed alike. */
  corners: ElementCorner[]
  /** The pour the project designs to, so every shutter is sized against one set of inputs. */
  settings: FormworkSettings
}

/** A stretch of a face run, as distance along the element in m. */
export interface FaceRun {
  lo: number
  hi: number
}

export interface CornerRun {
  entry: ElementCorner
  /** Where the corner unit's leg itself lands on this face. */
  leg: FaceRun
  /**
   * What it takes out of the panel layout — the leg plus the stretch between it
   * and the junction centreline, which is inside the other element's concrete and
   * needs no panel either.
   */
  blocked: FaceRun
}

/**
 * The stretches of one face taken by corner units. Panels go in the gaps: the
 * layout rule is to place the corners first and let the make-up piece land
 * mid-run, so a panel starting at the corner point overlaps the unit.
 *
 * A leg is measured from the corner of the *concrete*, which is the neighbour's
 * face rather than the junction's centreline point — the inner face for an inside
 * unit, the outer face for an outside one. Half the neighbour's core either way,
 * and that offset is exactly what makes an outside leg's first joint land at the
 * same station along the wall as its inside counterpart's, so a tie between them
 * passes through square. Placing both from the centreline instead staggers the
 * two skins by the wall thickness.
 *
 * Ends are not enough to place these. A junction landing mid-run on a wall's face
 * — the spine of a T — puts two units on the same face at the same point, running
 * opposite ways, which is what `towardEnd` records.
 */
export function cornerRuns(corners: readonly ElementCorner[], face: 'a' | 'b'): CornerRun[] {
  const out: CornerRun[] = []
  const system = formworkSystem(DEFAULT_FORMWORK_SYSTEM_ID)
  for (const entry of corners) {
    if (!entry.formed || entry.leg.face !== face) continue
    // A real unit's legs come from the catalog. Where the system sweeps no unit
    // for the angle, the corner is cut to fit on site, which is what the derived
    // length describes.
    const fit = system ? fitCorner(system, entry.corner) : undefined
    const legIndex = entry.corner.legs.indexOf(entry.leg) === 1 ? 1 : 0
    const length =
      fit?.legLengthsM[legIndex] ??
      cornerLegLength(entry.corner, entry.leg, DEFAULT_INSIDE_CORNER_LEG_M)
    const direction = entry.leg.towardEnd ? 1 : -1
    const inset =
      (entry.corner.side === 'inside' ? 1 : -1) * direction * entry.leg.turnsOntoThicknessM
    const from = entry.leg.alongM + inset / 2
    const to = from + direction * length
    const leg = { lo: Math.min(from, to), hi: Math.max(from, to) }
    out.push({
      entry,
      leg,
      blocked: {
        lo: Math.min(leg.lo, entry.leg.alongM),
        hi: Math.max(leg.hi, entry.leg.alongM),
      },
    })
  }
  return out.sort((a, b) => a.blocked.lo - b.blocked.lo)
}

/**
 * The catalog system this assembly builds from, most specific first: the
 * assembly's own choice, then the project's, then the shipped default — so a
 * scene that has never opened the formwork settings still lays out real panels
 * rather than an invented module.
 *
 * Takes the id rather than the node because the design report resolves the same
 * system without an assembly in hand — it reports on a host whose shutter has not
 * been generated yet.
 */
export function assemblySystem(
  settings: FormworkSettings,
  systemId: string | undefined,
): FormworkSystem | undefined {
  return formworkSystem(systemId ?? settings.parts.systemId ?? DEFAULT_FORMWORK_SYSTEM_ID)
}

/** One piece as it is set: a span along the element inside one course. */
export interface PlannedPiece {
  lo: number
  hi: number
  piece: StripPiece
}

export interface PlannedCourse {
  /** Elevations in m, absolute — the pour base is already added. */
  baseM: number
  topM: number
  pieces: PlannedPiece[]
}

export interface FacePlan {
  courses: PlannedCourse[]
  /** Drilled tie holes: m along the element, m elevation, both absolute. */
  holes: Array<{ alongM: number; elevationM: number }>
  /**
   * The packed runs this plan came out of, one per face run.
   *
   * Kept because a pack answers questions the plan cannot. `unfilledMm` is a
   * stretch of concrete nothing closes, and once the plan has substituted a cut
   * board for the whole run — which is what a carpenter does with it — the open
   * width is no longer anywhere in the pieces. Empty on a conventional plan,
   * where there is no catalog pack to report.
   */
  packs: StripPack[]
}

/**
 * A carpenter's shutter: one full-height course, divided evenly. This is what a
 * face gets when no catalog system answers for it — sheets cut to suit rather than
 * a frame chosen from stock — so there are no drilled holes and the tie grid falls
 * back to the spacing on the host.
 */
function conventionalPlan(
  runs: readonly FaceRun[],
  node: FormworkAssemblyNode,
  lift: { baseM: number; heightM: number; kickerM: number },
): FacePlan {
  const pieces: PlannedPiece[] = []
  for (const run of runs) {
    const runLength = run.hi - run.lo
    const count = Math.max(1, Math.ceil(runLength / (node.panelWidth || 0.6)))
    const width = runLength / count
    for (let i = 0; i < count; i++) {
      const widthMm = width * 1000
      pieces.push({
        lo: run.lo + i * width,
        hi: run.lo + (i + 1) * width,
        piece: { kind: 'cut', fromMm: i * widthMm, toMm: (i + 1) * widthMm, widthMm },
      })
    }
  }
  return {
    courses: [{ baseM: lift.baseM + lift.kickerM, topM: lift.baseM + lift.heightM, pieces }],
    holes: [],
    packs: [],
  }
}

/**
 * One formed face as real panels: courses up the lift, catalog widths along each,
 * and the tie holes those panels bring with them.
 *
 * The top course stands proud of the concrete rather than flush with it, because a
 * steel-framed panel is not cut down to suit a wall height — a 2.40 m lift in a
 * 2.70 m system is formed with 2.70 m panels and 300 mm of them holds nothing back.
 * How far proud is `stack.freeboardMm`, and whether that is more than the trade
 * would like is `freeboardOutOfBand`; neither is a reason to refuse to form the
 * wall.
 *
 * `panelWidth` on the node caps the width rather than setting it — the layout picks
 * from what the manufacturer sells, and the cap is how a job says "hand-set only,
 * nothing the crane has to lift".
 */
export function planFace(
  runs: readonly FaceRun[],
  node: FormworkAssemblyNode,
  system: FormworkSystem | undefined,
  lift: { baseM: number; heightM: number; kickerM: number },
): FacePlan | undefined {
  if (runs.length === 0) return undefined
  const layouts = system
    ? runs.map((run) =>
        layOutFace(system, {
          runMm: (run.hi - run.lo) * 1000,
          liftHeightMm: lift.heightM * 1000,
          kickerMm: lift.kickerM * 1000,
          fillerPosition: node.fillerPosition,
          avoidPanelIds: node.avoidedPanelIds,
          preferredWidthMm: node.panelWidth * 1000,
        }),
      )
    : []
  // The stack depends on the lift and not on the run, so every run is coursed the
  // same way and the first one carries the elevations for all of them.
  const frame = layouts[0]
  if (!frame || frame.courses.length === 0) return conventionalPlan(runs, node, lift)

  const courses: PlannedCourse[] = []
  const holes: FacePlan['holes'] = []
  for (const [index, entry] of frame.courses.entries()) {
    const pieces: PlannedPiece[] = []
    for (const [runIndex, layout] of layouts.entries()) {
      const run = runs[runIndex] as FaceRun
      const courseLayout = layout.courses[index]
      if (!courseLayout) continue
      // A run no division of the catalog closes — a stretch between two corner
      // units narrower than the narrowest panel. It is still formed, by a board
      // cut on site, which is what a carpenter does with it.
      if (layout.unfilledMm > 0) {
        const widthMm = (run.hi - run.lo) * 1000
        pieces.push({
          lo: run.lo,
          hi: run.hi,
          piece: { kind: 'cut', fromMm: 0, toMm: widthMm, widthMm },
        })
        continue
      }
      for (const piece of courseLayout.pack.pieces) {
        pieces.push({ lo: run.lo + piece.fromMm / 1000, hi: run.lo + piece.toMm / 1000, piece })
      }
      for (const hole of tieHoles([courseLayout])) {
        holes.push({
          alongM: run.lo + hole.alongMm / 1000,
          elevationM: lift.baseM + hole.elevationMm / 1000,
        })
      }
    }
    courses.push({
      baseM: lift.baseM + entry.course.baseMm / 1000,
      topM: lift.baseM + entry.course.topMm / 1000,
      pieces,
    })
  }
  // The base course's pack per run, not every course's: the stations are shared up
  // the wall by rule 3, so the courses above are the same division at another
  // height and reporting each of them would multiply one open strip by the stack.
  return {
    courses,
    holes,
    packs: layouts.flatMap((layout) => (layout.courses[0] ? [layout.courses[0].pack] : [])),
  }
}

/** How a corner leg is named, so a BOM can count units without re-deriving them. */
export function cornerPartName(entry: ElementCorner): string {
  const where = entry.leg.end ?? 'mid'
  // Both walls at a junction draw their own leg, so both are visible — but only
  // the owner's is counted. One unit, one line in the BOM.
  return `corner-${entry.corner.side}-${entry.leg.face}-${where}-${entry.owns ? 'owned' : 'shared'}`
}

/**
 * Which faces of the host this shutter builds, scoped to this assembly's pour
 * unit so a lift's top is left open for the lift above and a segment cut inside
 * the element is closed with a bulkhead.
 */
export function resolveFormworkScope(
  host: CastableHostNode,
  node: FormworkAssemblyNode,
  ctx: GeometryContext,
): FormworkScope | null {
  const levelNodes = resolveLevelElements(host, ctx)
  const elements = collectCastableElements(levelNodes)
  const element = elements.find((e) => e.id === host.id)
  if (!element) return null
  const unit = resolvePourUnit(element, node, levelNodes)
  const coverage = classifyElementFaces(element, findAbutments(elements), {
    neighbours: elements,
    junctions: findJunctions(elements),
    pourUnit: unit,
  })
  const formed = new Set(coverage.faces.filter((f) => f.formed).map((f) => f.role))
  const byRole = new Map(coverage.faces.map((face) => [face.role, face]))
  return {
    element,
    unit,
    isFormed: (role: FaceRole) => formed.has(role),
    faceOf: (role: FaceRole) => byRole.get(role),
    corners: coverage.corners,
    settings: resolveFormworkSettings(host, ctx),
  }
}
