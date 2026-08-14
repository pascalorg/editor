import dedent from 'dedent'
import { z } from 'zod'

/**
 * Fields shared by every element that gets cast in concrete (wall, column,
 * and later slab/beam/footing). They live here rather than on each node so
 * the coverage engine can read one shape regardless of host kind.
 *
 * `castOrder` and `pourId` are the primary inputs, not annotations: which
 * faces need forming is almost entirely a function of what was already
 * hardened when this element is poured. See `wiki/formwork/reference/coverage.md`.
 */

export const FormworkMode = z.enum(['double-sided', 'single-sided-a', 'single-sided-b', 'none'])
export type FormworkMode = z.infer<typeof FormworkMode>

export const ConcreteFaceSide = z.enum(['a', 'b'])
export type ConcreteFaceSide = z.infer<typeof ConcreteFaceSide>

export const TopSurfaceKind = z.enum(['open', 'formed', 'bounded'])
export type TopSurfaceKind = z.infer<typeof TopSurfaceKind>

export const TopSurface = z.object({
  kind: TopSurfaceKind.default('open'),
  slopeDeg: z.number().min(0).max(90).default(0),
})
export type TopSurface = z.infer<typeof TopSurface>

export const ExposureClass = z.enum(['standard', 'architectural', 'water-retaining'])
export type ExposureClass = z.infer<typeof ExposureClass>

export const KickerMode = z.enum(['monolithic', 'separate', 'kickerless'])
export type KickerMode = z.infer<typeof KickerMode>

export const CastableFields = {
  /**
   * Total order in which elements are poured. Lower is cast first. Absent
   * means "unsequenced" — the engine then treats every neighbour as
   * simultaneous, which is the conservative reading (no stop-end suppressed).
   */
  castOrder: z.number().int().optional(),
  /** Elements sharing a `pourId` are cast monolithically — no joint between them. */
  pourId: z.string().trim().max(120).optional(),
  /**
   * This element is cast in alternate bays: no two adjacent segments share a pour
   * interval, so the sequence orders odd bays before even (or the reverse) and
   * reports which. Overrides `pours.alternateBays` for this element.
   */
  alternateBays: z.boolean().optional(),
  formworkMode: FormworkMode.optional(),
  /** Which face is against earth/an existing structure, so cannot be formed or tied through. */
  againstEarthSide: ConcreteFaceSide.optional(),
  topSurface: TopSurface.optional(),
  exposureClass: ExposureClass.optional(),
  kickerMode: KickerMode.optional(),
  /** Splits the element into lifts when its height exceeds this, in meters. */
  maxLiftHeight: z.number().finite().positive().optional(),
  /**
   * Splits the element into segments when a bay exceeds this length, in meters.
   * Shrinkage control — water-retaining practice caps a bay at around 7.5 m.
   */
  maxPourLength: z.number().finite().positive().optional(),
  /**
   * Splits the element into segments when a bay would need more concrete than
   * this, in m³. The plant has to deliver a pour before the first concrete
   * placed reaches initial set, so supply is a geometric constraint.
   */
  maxPourVolume: z.number().finite().positive().optional(),
  /**
   * The architect's tie-hole grid on visible concrete, mm — the module the
   * exposed face is read by. Stated, never derived: on architectural work the
   * grid is the design and the layout is an output of it, so the tie rows sit
   * on this module uniform rather than graded, and a tie the module would
   * overload is answered by a lower pressure, not by moving the grid. Absent
   * means the design is free to grade.
   */
  specifiedTieGridMm: z
    .object({
      columnsMm: z.number().finite().positive(),
      rowsMm: z.number().finite().positive(),
    })
    .optional(),
} as const

/**
 * The shuttering hardware, as opposed to the pour sequence above. Every kind
 * that gets formed carries these, because the answer differs per element and
 * not per project: a column takes a purpose-made clamp-and-yoke box while the
 * slab beside it takes a propped deck.
 */
export const ShutteringFields = {
  formworkType: z.enum(['plywood', 'aluminium', 'steel-panel', 'none']).optional(),
  shutterMaterial: z.string().trim().max(120).optional(),
  tieSpacing: z.number().finite().positive().optional(),
  walerSpacing: z.number().finite().positive().optional(),
  scaffoldRequired: z.boolean().optional(),
} as const

export const SHUTTERING_FIELD_DOCS = dedent`
  - formworkType: shuttering system used to cast this element, if any
  - shutterMaterial: free-text material reference for the formwork face (e.g. "12mm plywood")
  - tieSpacing: spacing between formwork ties (column clamps / slab bearer centres) in meters
  - walerSpacing: spacing between walers (slab joists) in meters
  - scaffoldRequired: whether scaffold access is required to erect/strip formwork
`

export const CASTABLE_FIELD_DOCS = dedent`
  - castOrder: pour sequence; lower is cast first. Drives which faces need stop-ends
  - pourId: elements sharing a pourId are cast monolithically, with no joint between them
  - alternateBays: this element is cast in alternate bays, so no two adjacent segments share a pour interval; overrides the project's pours.alternateBays
  - formworkMode: form both faces, one face (the other braced/against earth), or none
  - againstEarthSide: face cast against earth or an existing structure
  - topSurface: whether the top is screeded open, formed, or cast against a soffit, plus its slope
  - exposureClass: standard, architectural (visible concrete), or water-retaining
  - kickerMode: whether the kicker is cast with this element, separately, or omitted
  - maxLiftHeight: split into multiple lifts above this height, in meters
  - maxPourLength: split into segments when a bay exceeds this length, in meters (shrinkage control)
  - maxPourVolume: split into segments when a bay would exceed the concrete one pour can supply, in m³
  - specifiedTieGridMm: the architect's tie-hole grid on visible concrete, columns × rows in mm — the module the exposed face is read by, so rows sit on it uniform rather than graded and an overload answers with a lower pressure
`
