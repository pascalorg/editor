import { type FillerType, type FormworkSystem, fillerForGap, type PanelType } from '../catalog'

/**
 * Covering one horizontal face run with panels the manufacturer actually sells.
 *
 * The run handed in is already clipped clear of the corner units — corners are
 * fixed geometry and go in first — so what is left is the stretch between them,
 * and the job is to choose a multiset of real widths that covers it and to decide
 * where the make-up piece lands. Three rules from the trade shape this and none of
 * them fall out of a greedy left-to-right fill:
 *
 * 1. The make-up piece belongs mid-run, not against a corner. A poor joint beside
 *    a corner unit is the first thing anyone sees and the corner is where the form
 *    is hardest to keep tight; in the middle of a run, or at a T, it disappears.
 *    So the panels are laid outward from both ends and the gap is left where the
 *    two halves meet.
 * 2. Full panels first, then descending widths, then compensation — with a cost
 *    per descent, because every narrower panel is another joint, another coupler
 *    and more stripping time. That is why the pack is chosen by minimising a cost
 *    rather than by taking the widest panel that fits at each step: `1350 + 900`
 *    beats `1350 + 450 + 450` on the same 2.25 m even though both fit.
 * 3. Panel joints are aligned up the wall, not staggered — the reverse of
 *    masonry, because a tie has to pass through holes that line up. So this
 *    returns the stations for *one* course and `stack.ts` repeats them; the
 *    stations are the shared thing, not a per-course decision.
 *
 * A gap below every filler's reach is the signal to re-split rather than an error:
 * two workable pieces beat one panel and a sliver nothing closes. That happens
 * here by construction — the search considers every reachable panel sum, so a sum
 * leaving 40 mm simply loses to one leaving 340 mm.
 */

/** Two panel edges closer than this are the same joint. */
export const JOINT_TOLERANCE_MM = 2

/**
 * Narrowest piece worth making, mm. A ply strip under about 100 mm splits when
 * it is nailed and cannot span two walers, so it is scrap however neatly it
 * completes the arithmetic.
 */
export const MIN_WORKABLE_PIECE_MM = 100

/**
 * Widest piece worth cutting, mm. No system sells a compensation part beyond
 * about this — PERI's TPP filler profile reaches 600 mm and Doka's fitting timbers
 * stop at 100 — and past it you are not making up a gap, you are hand-building a
 * panel the system already sells. So a wider remainder is a panel that was not
 * spent, not a board somebody cuts.
 */
export const MAX_BESPOKE_PIECE_MM = 600

/**
 * The cost the pack minimises. Not money — a handling count: one unit per piece
 * (which is PAAD's "minimise total panels"), plus a penalty for each step down
 * the width list, plus what it costs to close the remainder. The filler ladder is
 * the system's own cascade in the order it costs: a stock plate is a stores issue,
 * a bespoke board is a carpenter.
 */
const PANEL_COST = 1
const DESCENT_PENALTY = 0.35
const FILLER_COST: Record<FillerType['madeFrom'], number> = {
  'system-plate': 1,
  aluminium: 1.2,
  timber: 2,
  'site-cut': 3,
}
/**
 * Cutting a board has to be dearer than any way the catalog closes a gap it could
 * have closed, or the packer prefers carpentry to stock — a 400 mm stretch comes
 * back as one cut board rather than a 300 panel and a 100 mm fitting timber, which
 * is the opposite of what a yard does. The bound is loose on purpose: the widest
 * bespoke piece is `MAX_BESPOKE_PIECE_MM`, and the dearest catalog answer to a gap
 * that narrow is one narrow panel plus a site-cut filler, so anything above that
 * total makes the board the last resort it is on site.
 */
const BESPOKE_CUT_COST = 8

/** Where the make-up piece goes. Tekla exposes this to the user and so do we. */
export type FillerPosition = 'start' | 'middle' | 'end' | 'symmetric'

export type StripPiece =
  | { kind: 'panel'; fromMm: number; toMm: number; widthMm: number; panel: PanelType }
  | { kind: 'filler'; fromMm: number; toMm: number; widthMm: number; filler: FillerType }
  /** A board somebody cuts: no catalog part answers this width. */
  | { kind: 'cut'; fromMm: number; toMm: number; widthMm: number }

export interface StripPack {
  pieces: StripPiece[]
  /**
   * Width left open, mm. Non-zero only when no division of the run leaves a
   * closable remainder — a run shorter than the narrowest piece anybody can make.
   * Reported rather than hidden: an unformed strip is a blowout, not a rounding
   * error.
   */
  unfilledMm: number
  cost: number
  /** Where the make-up piece actually went, which is not always what was asked. */
  fillerPosition: FillerPosition
}

export interface StripPackOptions {
  /** Course height, mm. Panels and fillers are picked at this height, not scaled. */
  heightMm: number
  fillerPosition?: FillerPosition
  /**
   * Panels the site will not use — hired stock it does not hold, or a size the
   * job has standardised away from. Tekla calls these avoided panels.
   */
  avoidPanelIds?: readonly string[]
  /** Widest panel to consider, mm. The crane, or a preference for hand-set sizes. */
  preferredWidthMm?: number
  /** Heaviest panel to consider, kg — a hand-set job cannot take a 400 kg sheet. */
  maxPanelWeightKg?: number
  /**
   * Stations along the run, mm, where a joint must fall. Exposed-concrete work
   * inverts the objective: the joint grid is specified by the architect and the
   * panel layout is an output of it, not the other way round. Opening jambs go
   * here too — a joint on the jamb line beats one 60 mm off it.
   */
  requiredJointsMm?: readonly number[]
}

interface PanelChoice {
  panel: PanelType
  widthMm: number
  cost: number
}

interface ClosurePart {
  widthMm: number
  filler?: FillerType
}

interface ClosurePlan {
  parts: ClosurePart[]
  cost: number
  unfilledMm: number
  position: FillerPosition
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * The widths this run may be built from, widest first, one panel per width.
 * Universal panels are excluded: they are drilled for T-junctions and stop-ends
 * and cost more, so spending one on a plain run is a real loss. Where a system
 * sells the same width at more than one weight, the lighter one is the one a crew
 * would rather lift.
 */
function panelChoices(system: FormworkSystem, opts: StripPackOptions): PanelChoice[] {
  const avoid = new Set(opts.avoidPanelIds ?? [])
  const byWidth = new Map<number, PanelType>()
  for (const panel of system.panels) {
    if (panel.heightMm !== opts.heightMm) continue
    if (panel.universal || panel.selfCompacting) continue
    if (avoid.has(panel.id)) continue
    if (opts.preferredWidthMm !== undefined && panel.widthMm > opts.preferredWidthMm) continue
    if (opts.maxPanelWeightKg !== undefined && panel.weightKg > opts.maxPanelWeightKg) continue
    const held = byWidth.get(panel.widthMm)
    if (!held || panel.weightKg < held.weightKg) byWidth.set(panel.widthMm, panel)
  }
  return [...byWidth.entries()]
    .sort(([a], [b]) => b - a)
    .map(([widthMm, panel], rank) => ({
      panel,
      widthMm,
      // Rank is the descent: the widest panel is free, and every narrower one
      // carries the joint and the coupler it adds.
      cost: PANEL_COST + rank * DESCENT_PENALTY,
    }))
}

/**
 * How the remainder is closed, and what that costs. A gap the cascade covers is a
 * catalog line; one it does not is a board somebody cuts, which is dearer but
 * still buildable; one below the minimum workable width is neither, and saying so
 * is what makes the search re-split the run instead of drawing a sliver.
 */
function closeGap(
  system: FormworkSystem,
  gapMm: number,
  heightMm: number,
  position: FillerPosition,
): ClosurePlan {
  if (gapMm <= JOINT_TOLERANCE_MM) return { parts: [], cost: 0, unfilledMm: 0, position }
  if (position === 'symmetric') {
    // Equal make-up at both ends, so the two end panels match — what you do on a
    // wall that will be looked at. It costs two pieces instead of one, and only
    // works if the half is a width something covers.
    const half = gapMm / 2
    const each = closeGap(system, half, heightMm, 'middle')
    if (each.unfilledMm === 0 && each.parts.length === 1) {
      return {
        parts: [...each.parts, ...each.parts],
        cost: each.cost * 2,
        unfilledMm: 0,
        position,
      }
    }
  }
  const single = position === 'symmetric' ? 'middle' : position
  const filler = fillerForGap(system, gapMm, heightMm)
  if (filler) {
    return {
      parts: [{ widthMm: gapMm, filler }],
      cost: FILLER_COST[filler.madeFrom],
      unfilledMm: 0,
      position: single,
    }
  }
  if (gapMm >= MIN_WORKABLE_PIECE_MM && gapMm <= MAX_BESPOKE_PIECE_MM) {
    return { parts: [{ widthMm: gapMm }], cost: BESPOKE_CUT_COST, unfilledMm: 0, position: single }
  }
  // Beyond the cascade's reach or below a workable strip: nothing closes this, and
  // the division that produced it loses to one that does.
  return { parts: [], cost: BESPOKE_CUT_COST, unfilledMm: gapMm, position: single }
}

/** The panels behind one reachable sum, from the min-cost table's back pointers. */
function panelsForSum(
  choices: readonly PanelChoice[],
  via: Int32Array,
  grid: number,
  index: number,
): PanelType[] {
  const out: PanelType[] = []
  let at = index
  while (at > 0) {
    const choice = choices[via[at] as number]
    if (!choice) break
    out.push(choice.panel)
    at -= choice.widthMm / grid
  }
  return out
}

/**
 * Panels outward from both ends, make-up piece where the two halves meet. Each
 * panel goes on whichever side is currently shorter, so the gap lands as near the
 * middle as the multiset allows — and the widest panels end up at the ends, which
 * is also the arrangement a gang is craned in.
 */
function layOut(
  panels: readonly PanelType[],
  closure: ClosurePlan,
): Array<PanelType | ClosurePart> {
  const sorted = [...panels].sort((a, b) => b.widthMm - a.widthMm)
  const head: PanelType[] = []
  const tail: PanelType[] = []
  let headMm = 0
  let tailMm = 0
  for (const panel of sorted) {
    if (headMm <= tailMm) {
      head.push(panel)
      headMm += panel.widthMm
    } else {
      tail.unshift(panel)
      tailMm += panel.widthMm
    }
  }
  switch (closure.position) {
    case 'start':
      return [...closure.parts, ...sorted]
    case 'end':
      return [...sorted, ...closure.parts]
    case 'symmetric': {
      const [first, second] = closure.parts
      return [...(first ? [first] : []), ...head, ...tail, ...(second ? [second] : [])] as Array<
        PanelType | ClosurePart
      >
    }
    default:
      return [...head, ...closure.parts, ...tail]
  }
}

function isPanel(item: PanelType | ClosurePart): item is PanelType {
  return 'heightMm' in item && 'tieHoles' in item
}

function packSingleRun(system: FormworkSystem, runMm: number, opts: StripPackOptions): StripPack {
  const position = opts.fillerPosition ?? 'middle'
  const run = Math.round(runMm)
  if (run <= JOINT_TOLERANCE_MM) {
    return { pieces: [], unfilledMm: 0, cost: 0, fillerPosition: position }
  }

  const choices = panelChoices(system, opts)
  // Every reachable panel sum, cheapest first, on the grid the widths share:
  // Framax's widths are all multiples of 50 mm and TRIO's of 60, so the table is
  // a few hundred entries rather than one per millimetre.
  const grid = choices.reduce((held, choice) => gcd(held, choice.widthMm), 0) || run
  const steps = Math.floor(run / grid)
  const cost = new Float64Array(steps + 1).fill(Number.POSITIVE_INFINITY)
  const via = new Int32Array(steps + 1).fill(-1)
  cost[0] = 0
  for (let i = 1; i <= steps; i++) {
    for (let c = 0; c < choices.length; c++) {
      const choice = choices[c] as PanelChoice
      const width = choice.widthMm / grid
      if (width > i) continue
      const candidate = (cost[i - width] as number) + choice.cost
      if (candidate < (cost[i] as number)) {
        cost[i] = candidate
        via[i] = c
      }
    }
  }

  let bestIndex = 0
  let bestClosure = closeGap(system, run, opts.heightMm, position)
  let bestCost = bestClosure.cost
  for (let i = 1; i <= steps; i++) {
    if (!Number.isFinite(cost[i] as number)) continue
    const closure = closeGap(system, run - i * grid, opts.heightMm, position)
    const total = (cost[i] as number) + closure.cost
    // Leaving concrete unformed is never traded against handling cost, so the
    // comparison is on the open width first and the cost only among divisions
    // that close.
    if (
      closure.unfilledMm < bestClosure.unfilledMm ||
      (closure.unfilledMm === bestClosure.unfilledMm && total < bestCost)
    ) {
      bestIndex = i
      bestClosure = closure
      bestCost = total
    }
  }

  const panels = panelsForSum(choices, via, grid, bestIndex)
  const pieces: StripPiece[] = []
  let at = 0
  for (const item of layOut(panels, bestClosure)) {
    const widthMm = isPanel(item) ? item.widthMm : item.widthMm
    const fromMm = at
    const toMm = at + widthMm
    at = toMm
    if (isPanel(item)) {
      pieces.push({ kind: 'panel', fromMm, toMm, widthMm, panel: item })
    } else if (item.filler) {
      pieces.push({ kind: 'filler', fromMm, toMm, widthMm, filler: item.filler })
    } else {
      pieces.push({ kind: 'cut', fromMm, toMm, widthMm })
    }
  }

  return {
    pieces,
    unfilledMm: bestClosure.unfilledMm,
    cost: bestCost,
    fillerPosition: bestClosure.position,
  }
}

/**
 * Pack one face run, `runMm` long, starting at station 0. Positions come back in
 * mm along the run in the order the pieces are set.
 *
 * With `requiredJointsMm` the run is cut at those stations and each stretch is
 * packed on its own, which is how an architectural joint grid is honoured: the
 * grid is the constraint and the panel sizes follow from it.
 */
export function packStrip(
  system: FormworkSystem,
  runMm: number,
  opts: StripPackOptions,
): StripPack {
  const required = [...new Set(opts.requiredJointsMm ?? [])]
    .filter((station) => station > JOINT_TOLERANCE_MM && station < runMm - JOINT_TOLERANCE_MM)
    .sort((a, b) => a - b)
  if (required.length === 0) return packSingleRun(system, runMm, opts)

  const pieces: StripPiece[] = []
  let unfilledMm = 0
  let cost = 0
  let from = 0
  for (const station of [...required, runMm]) {
    const pack = packSingleRun(system, station - from, opts)
    for (const piece of pack.pieces) {
      pieces.push({ ...piece, fromMm: piece.fromMm + from, toMm: piece.toMm + from })
    }
    unfilledMm += pack.unfilledMm
    cost += pack.cost
    from = station
  }
  return { pieces, unfilledMm, cost, fillerPosition: opts.fillerPosition ?? 'middle' }
}

/**
 * Interior joint stations, mm. This is what the courses above share and what the
 * tie grid snaps to — a joint line is where a tie can pass and where a waler
 * coupler clamps, so it is the layout's real output rather than the piece list.
 */
export function jointStationsMm(pack: StripPack): number[] {
  return pack.pieces.slice(1).map((piece) => piece.fromMm)
}

/** Every piece of the pack nothing in the catalog answers — the carpenter's list. */
export function bespokePieces(pack: StripPack): StripPiece[] {
  return pack.pieces.filter((piece) => piece.kind === 'cut')
}
