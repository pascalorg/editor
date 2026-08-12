import type { FormworkSystem } from '../catalog'
import { type FaceLayout, type FaceLayoutOptions, layOutFace } from './courses'
import { type FaceGangs, type GangOptions, gangFace } from './gangs'

/**
 * Re-laying a face because its gangs do not lift.
 *
 * `gangs.ts` refuses to move a boundary onto anything but a joint every course shares,
 * so a face whose one pick is over the crane has no answer inside that module — its own
 * warning says as much: *"This is a layout to redo, not a boundary to move: narrower
 * panels give more joints."* This is the redo. A 2.7 m wide Framax panel weighs 416 kg
 * and a run built from one of them holds no interior joint at all; the same run built
 * from two 1.35 m panels weighs the same in total, holds a joint in the middle, and
 * lifts in two picks of 210 kg.
 *
 * ## One lever, walked widest-first
 *
 * The lever is `preferredWidthMm` — the cap `strip-pack.ts` already takes — and the
 * candidates are the widths the system actually sells at the heights this stack uses.
 * Walked from the widest down, so the accepted layout is the one with the fewest joints
 * that still lifts: every step down the width list is another joint, another coupler and
 * more stripping time, which is the cost `strip-pack.ts` minimises and the cost this
 * spends deliberately. It stops at the first cap that clears every gang rather than
 * continuing to the narrowest, because a lighter pick is not worth buying past the point
 * where the crane takes it.
 *
 * A required joint at the width limit would be a second lever and is not used here. It
 * is available (`requiredJointsMm`) and it is what an architect's grid uses, but forcing
 * one at an arbitrary station cuts boards: a joint at 675 mm on a 1350 mm run comes back
 * as two 550 panels and two cut boards, and a cut board has no catalog weight at all.
 *
 * ## Two attempts that look like improvements and are not
 *
 * An attempt that leaves concrete unformed is refused however light its gangs are —
 * `StripPack.unfilledMm` is a blowout, not a rounding error, and a cap below the
 * narrowest panel the system sells produces exactly that.
 *
 * An attempt that turns a weighed face into an unweighed one is refused for a subtler
 * reason: a cut board voids its gang's pick weight, and a gang with no weight is not
 * over any limit. So the narrower layout would *report* the over-capacity gangs gone
 * while having replaced a failing check with no check. That is the one way this search
 * could make a drawing more dangerous than the layout it started from.
 *
 * ## The layout somebody chose is not second-guessed
 *
 * With no over-limit gang the face comes back exactly as it was laid out, with no
 * attempts recorded and `forcedByCrane` unset. A face that already lifts is a face
 * nobody asked about, and re-laying it narrower to balance the picks would spend panels
 * and joints on an objective the site never stated.
 */

/** One layout tried, and how it came out. Kept so a report can show what was rejected. */
export interface RelayoutAttempt {
  /** The width cap tried, mm. Absent for the face as it was first laid out. */
  preferredWidthMm?: number
  /** Gangs still breaking a stated limit. Zero is what ends the search. */
  overLimitCount: number
  /** Panels in the whole face — the price of the attempt. */
  panelCount: number
  gangCount: number
  /** Why it was not taken, where it was not. Absent on the accepted attempt. */
  rejectedBecause?: RelayoutRejection
}

export type RelayoutRejection =
  /** It leaves concrete unformed, which no weight saving buys back. */
  | 'unformed-strip'
  /** It replaces a failing capacity check with no capacity check at all. */
  | 'loses-pick-weight'
  /** Its gangs still break a stated limit. */
  | 'still-over-limit'

export interface CraneRelayout {
  face: FaceLayout
  gangs: FaceGangs
  /** The cap that produced this layout, mm. Absent where the first layout stood. */
  preferredWidthMm?: number
  /** Set where the layout changed to make a gang lift, rather than by anyone's choice. */
  forcedByCrane?: true
  /** Panels this layout costs over the one the face would have had. */
  extraPanels?: number
  /** Set where no width the system sells clears every limit. */
  stillOverLimit?: true
  /** Widest-first, the accepted one last. Empty where the first layout already lifted. */
  attempts: RelayoutAttempt[]
}

function panelsInFace(gangs: FaceGangs): number {
  return gangs.gangs.reduce((sum, gang) => sum + gang.panelCount, 0)
}

function overLimitCount(gangs: FaceGangs): number {
  return gangs.gangs.filter((gang) => gang.overLimit).length
}

/**
 * Panel widths worth capping at, widest first.
 *
 * Only the widths that exist at the heights this stack uses, because a cap between two
 * real widths lays out identically to the lower of them and would spend an attempt
 * proving it. Universal and self-compacting panels are excluded here for the same reason
 * `panelChoices` excludes them: the packer will not spend one on a plain run, so a cap at
 * a width only they come in changes nothing.
 *
 * Capped below the widest panel the face already uses, for the same reason: a cap at or
 * above it produces the layout that has just been rejected, and recording that as a
 * separate attempt would report a re-layout that was never a different layout.
 */
function widthLadderMm(system: FormworkSystem, face: FaceLayout): number[] {
  const heights = new Set(face.stack.courses.map((course) => course.panelHeightMm))
  const widestUsedMm = face.courses.reduce(
    (widest, { pack }) =>
      pack.pieces.reduce(
        (held, piece) => (piece.kind === 'panel' ? Math.max(held, piece.widthMm) : held),
        widest,
      ),
    0,
  )
  const widths = new Set<number>()
  for (const panel of system.panels) {
    if (!heights.has(panel.heightMm)) continue
    if (panel.universal || panel.selfCompacting) continue
    if (panel.widthMm >= widestUsedMm) continue
    widths.add(panel.widthMm)
  }
  return [...widths].sort((a, b) => b - a)
}

/**
 * Lay out a face so its gangs lift, and say what that cost.
 *
 * Replaces a `layOutFace` + `gangFace` pair at the call site rather than wrapping one:
 * the accepted layout and the gangs over it have to be the same pair, and a caller that
 * kept its own `layOutFace` result would draw the panels of one layout beside the picks
 * of another.
 */
export function relayoutForCrane(
  system: FormworkSystem,
  faceOptions: FaceLayoutOptions,
  gangOptions: GangOptions = {},
): CraneRelayout {
  const face = layOutFace(system, faceOptions)
  const gangs = gangFace(face.courses, gangOptions)
  const asLaid: CraneRelayout = { face, gangs, attempts: [] }
  if (overLimitCount(gangs) === 0) return asLaid

  const basePanels = panelsInFace(gangs)
  const weighed = gangs.totalWeightKg !== undefined
  const attempts: RelayoutAttempt[] = []
  for (const preferredWidthMm of widthLadderMm(system, face)) {
    const tried = layOutFace(system, { ...faceOptions, preferredWidthMm })
    const triedGangs = gangFace(tried.courses, gangOptions)
    const attempt: RelayoutAttempt = {
      preferredWidthMm,
      overLimitCount: overLimitCount(triedGangs),
      panelCount: panelsInFace(triedGangs),
      gangCount: triedGangs.gangs.length,
    }
    const rejection: RelayoutRejection | undefined =
      tried.unfilledMm > 0
        ? 'unformed-strip'
        : weighed && triedGangs.totalWeightKg === undefined
          ? 'loses-pick-weight'
          : attempt.overLimitCount > 0
            ? 'still-over-limit'
            : undefined
    if (rejection !== undefined) {
      attempts.push({ ...attempt, rejectedBecause: rejection })
      continue
    }
    attempts.push(attempt)
    return {
      face: tried,
      gangs: triedGangs,
      preferredWidthMm,
      forcedByCrane: true,
      extraPanels: attempt.panelCount - basePanels,
      attempts,
    }
  }
  return { ...asLaid, stillOverLimit: true, attempts }
}

/** What a re-laid face does not tell a reader on its own. */
export function formworkRelayoutCaveats(relayout: CraneRelayout): string[] {
  if (relayout.stillOverLimit) {
    const narrowest = relayout.attempts.at(-1)?.preferredWidthMm
    return [
      `No panel width this system sells brings every gang inside the stated limits${narrowest === undefined ? '' : `, down to ${narrowest} mm`}. The face needs a lifting frame, a bigger crane, or a joint the architect has to agree to — it is not a layout problem any more.`,
    ]
  }
  if (relayout.forcedByCrane !== true) return []
  const out = [
    `This face is laid out in panels no wider than ${relayout.preferredWidthMm} mm because the layout it would otherwise have had could not be lifted. That is a decision the crane made, not a preference — the panels are narrower, the joints are more numerous, and the concrete finish shows them.`,
  ]
  if (relayout.extraPanels !== undefined && relayout.extraPanels > 0) {
    out.push(
      `It costs ${relayout.extraPanels} more ${relayout.extraPanels === 1 ? 'panel' : 'panels'} than the widest layout of this face, each with its own joint, coupler and stripping time. A crane that reaches this wall with more capacity removes that cost.`,
    )
  }
  const rejected = relayout.attempts.filter((attempt) => attempt.rejectedBecause !== undefined)
  if (rejected.some((attempt) => attempt.rejectedBecause === 'loses-pick-weight')) {
    out.push(
      'A wider layout than this one was rejected for having no pick weight rather than for being heavy: a piece in it is cut on site and carries no catalog weight, so its gangs could not be checked against the crane at all.',
    )
  }
  return out
}
