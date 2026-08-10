import type { BomLine } from './parts'

/**
 * Where a bill's parts come from: the yard's own rack, a hire agreement, or nowhere
 * they will return from.
 *
 * A different question from `provenance`, and the two are easy to conflate. Provenance
 * is the part's *condition* — stock as supplied, stock altered for this pour, or made
 * for this pour — and it decides whether the thing can go back on a rack at all.
 * Supply is *whose rack*. They are orthogonal, and the pair of them is what a costing
 * pass needs: a purchase is amortised over its uses, a hire is charged per month
 * against new value, and a cut board is spent.
 *
 * The reason this is engine work rather than a label is that ownership is a *pool*.
 * A yard owns 200 of a panel type and hires whatever a job needs beyond that, so the
 * answer for a line is a split rather than a flag, and the split depends on what the
 * other lines of the same catalog id already took. A boolean per type would put every
 * panel of a 300-panel job on hire the moment the job outgrew the rack by one.
 *
 * ## The pool is per scope, and two scopes are not additive
 *
 * Level 1 taking 100 owned panels and level 2 taking the same 100 is correct: they
 * are cast in sequence and the same panels serve both. It is wrong only if the two
 * are formed at once, which is the set count phase 10 owns and this cannot see. So a
 * per-level answer is right per level and two of them must not be added — exactly the
 * caveat `bomLines` already carries about the bill itself, arriving here through the
 * same door rather than as a new hazard.
 *
 * ## Absent stock is not zero stock
 *
 * A project that has never recorded what it owns must not be told its whole bill is
 * on hire. That is a claim it never made, and it is the same distinction the design
 * report draws between "assumed" and "project", and the validator between a failed
 * check and one it could not run. So the pool being *empty* means the yard owns
 * nothing, which is a real answer; the project not having *stated* a pool means there
 * is no answer, and the caller leaves the whole split off rather than filling it in.
 */

/** How many of each catalog id the yard owns. Keyed by `catalogId`. */
export type OwnedStock = Readonly<Record<string, number>>

/**
 * Whether a part comes back.
 *
 * `consumed` is one bucket rather than "bespoke" and "consumable" separately, because
 * the distinction that matters to a bill is the one they share: nothing returns, so
 * there is nothing to amortise and nothing to hire. A cut board, a carpenter's box
 * and a drum of release agent are the same line in a cost model and three different
 * lines in a parts table.
 */
export type PartSupply =
  /** Off the project's own rack, and going back on it. */
  | 'owned'
  /** On a hire agreement — charged while held, and returned. */
  | 'hired'
  /** Spent on this pour: made on site, or used up. */
  | 'consumed'

/** One bill line, split by where its parts come from. */
export interface SupplyLine {
  line: BomLine
  ownedQuantity: number
  hiredQuantity: number
  consumedQuantity: number
  /**
   * Hired stock this pour alters — drilled, trimmed, packed.
   *
   * The number that costs money quietly, and the reason the split is worth computing
   * at all rather than labelling. A hire company's panel that comes back with holes
   * in it is recharged at list, so this is a purchase nobody decided to make. It is
   * `hiredQuantity` where the line is `modified`, called out because nothing else in
   * the bill distinguishes it from ordinary hire.
   */
  hiredModifiedQuantity: number
}

/** What a scope's bill draws on, and what that costs the project in kind. */
export interface BomSupply {
  lines: SupplyLine[]
  ownedQuantity: number
  hiredQuantity: number
  consumedQuantity: number
  /** Hired stock altered for this pour — a recharge at list, not a hire charge. */
  hiredModifiedQuantity: number
  /**
   * Weight on hire, kg — absent where any hired line has no published weight.
   *
   * Apportioned from the line's total by quantity, which is exact because a line is
   * one catalog id at one condition and its parts weigh the same as each other. Hire
   * is often priced against tonnage or area held, so this is the figure a hire desk
   * quotes from; the same partial-total discipline as `bomWeightKg` applies, because
   * a tonnage that silently omits three unweighed lines is one somebody signs.
   */
  hiredWeightKg?: number
  /** Catalog ids the project says it owns that this scope's bill never draws on. */
  unusedOwnedIds: string[]
}

/**
 * Whether a line's parts come back to a rack at all.
 *
 * A bespoke part was made for this pour, a consumable is used up in it, and a part with no
 * catalog id is nothing a yard stocks by number — none of the three returns, whatever the
 * project owns. Exported because the set count needs exactly this rule and a second copy of
 * it would be a second thing to fix: a cut board counted as poolable stock would be reported
 * as reused, and a board is cut once.
 */
export function isReturnableLine(line: BomLine): boolean {
  return line.provenance !== 'bespoke' && line.kind !== 'consumable' && line.catalogId !== undefined
}

/**
 * Which lines draw on the pool first.
 *
 * Altered stock before untouched stock, and it is a cost decision rather than a tidy
 * one: a hired panel this pour drills comes back with holes in it and is recharged at
 * list, while the yard's own panel is already the yard's problem. So a project that
 * owns ten of a type and needs ten untouched plus five drilled should spend its own
 * on the five it is going to drill. Allocated the other way round the same job returns
 * five holed panels to a hire company.
 */
const CONDITION_PRIORITY = { modified: 0, standard: 1, bespoke: 2 } as const

/**
 * Split a bill by where its parts come from.
 *
 * Total in the pool sense: an empty `owned` is the honest answer for a yard that owns
 * nothing, and it is the *caller's* job to decide that a project which never stated a
 * pool gets no split at all. See the module docstring — the two are different claims
 * and only one of them is this function's business.
 */
export function bomSupply(lines: readonly BomLine[], owned: OwnedStock): BomSupply {
  const pool = new Map<string, number>(Object.entries(owned))
  const drawnOn = new Set<string>()

  // A line's own share of the pool depends on what earlier lines took, so the order
  // is part of the answer rather than a presentation choice. Sorted on a copy: the
  // bill's order is `bomLines`' and a CSV whose rows move between two downloads of an
  // unchanged scene is a CSV nobody can diff.
  const ordered = [...lines].sort(
    (a, b) =>
      CONDITION_PRIORITY[a.provenance] - CONDITION_PRIORITY[b.provenance] ||
      (a.catalogId ?? '').localeCompare(b.catalogId ?? '') ||
      a.description.localeCompare(b.description),
  )

  const split = new Map<BomLine, SupplyLine>()
  for (const line of ordered) {
    // Made for this pour, or used up in it: there is no rack it came off and none it
    // goes back to, whatever the yard owns.
    if (!isReturnableLine(line)) {
      split.set(line, {
        line,
        ownedQuantity: 0,
        hiredQuantity: 0,
        consumedQuantity: line.quantity,
        hiredModifiedQuantity: 0,
      })
      continue
    }
    const catalogId = line.catalogId as string
    const available = pool.get(catalogId) ?? 0
    const fromStock = Math.min(available, line.quantity)
    pool.set(catalogId, available - fromStock)
    drawnOn.add(catalogId)
    const hired = line.quantity - fromStock
    split.set(line, {
      line,
      ownedQuantity: fromStock,
      hiredQuantity: hired,
      consumedQuantity: 0,
      hiredModifiedQuantity: line.provenance === 'modified' ? hired : 0,
    })
  }

  let ownedQuantity = 0
  let hiredQuantity = 0
  let consumedQuantity = 0
  let hiredModifiedQuantity = 0
  let hiredWeightKg = 0
  let hiredWeighable = true
  for (const entry of split.values()) {
    ownedQuantity += entry.ownedQuantity
    hiredQuantity += entry.hiredQuantity
    consumedQuantity += entry.consumedQuantity
    hiredModifiedQuantity += entry.hiredModifiedQuantity
    if (entry.hiredQuantity === 0) continue
    if (entry.line.totalWeightKg === undefined) hiredWeighable = false
    else hiredWeightKg += (entry.line.totalWeightKg / entry.line.quantity) * entry.hiredQuantity
  }

  return {
    // Back in the bill's own order, so a supply figure sits beside the line it is
    // about wherever the bill is shown.
    lines: lines.map((line) => split.get(line) as SupplyLine),
    ownedQuantity,
    hiredQuantity,
    consumedQuantity,
    hiredModifiedQuantity,
    ...(hiredWeighable && hiredQuantity > 0 ? { hiredWeightKg } : {}),
    unusedOwnedIds: Object.keys(owned)
      .filter((catalogId) => !drawnOn.has(catalogId))
      .sort(),
  }
}
