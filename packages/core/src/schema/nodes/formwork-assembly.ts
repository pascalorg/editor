import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * One formwork assembly: the shutter for a single (element × segment × lift).
 *
 * The scope fields are what make this a node rather than a flag on the wall.
 * A 9 m wall is not formed in one go — it is poured in lifts, each with its
 * own shutter, its own tie grid, and a construction joint to the lift below,
 * and a long wall is cut into segments so no single pour exceeds the batch
 * plant's supply. Each of those is separately erected, struck, and paid for,
 * so each needs its own node to hang parts and overrides off.
 *
 * `parentId` IS the host element — same convention as door/window. There is
 * deliberately no `hostId` field: two sources of truth for the same relation
 * drift apart the first time a node is reparented.
 *
 * For the same reason there is no `mode` here. Which faces get formed is a
 * property of the concrete being cast, so `formworkMode` lives on the host
 * element and the coverage solver reads it from there
 * (`systems/formwork/coverage/elements.ts`). A copy on the assembly would be
 * unread and free to contradict the wall it belongs to.
 */

export const FormworkFillerPosition = z.enum(['start', 'middle', 'end', 'symmetric'])
export type FormworkFillerPosition = z.infer<typeof FormworkFillerPosition>

/**
 * Spacings the engine would otherwise derive from the pressure envelope.
 * Present because a site sometimes has to build what it has on the yard, but
 * an override is a claim about structure — the design report has to show the
 * adopted value against the calculated one so an overridden spacing that
 * fails its check is visible rather than silent.
 */
export const FormworkDesignOverrides = z.object({
  tieSpacing: z.number().finite().positive().optional(),
  walerSpacing: z.number().finite().positive().optional(),
  joistSpacing: z.number().finite().positive().optional(),
  tieCatalogId: z.string().trim().max(120).optional(),
})
export type FormworkDesignOverrides = z.infer<typeof FormworkDesignOverrides>

/**
 * A per-part edit, keyed by the part's deterministic mark. Marks are derived
 * from geometry so they survive a recompute; keying on array index would
 * silently move every override the moment a panel is inserted upstream.
 */
export const FormworkPartOverride = z.object({
  catalogId: z.string().trim().max(120).optional(),
  omitted: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
})
export type FormworkPartOverride = z.infer<typeof FormworkPartOverride>

export const FormworkAssemblyNode = BaseNode.extend({
  id: objectId('formwork-assembly'),
  type: nodeType('formwork-assembly'),
  children: z.array(z.string()).default([]),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /** Which pour segment of the host this shutter covers, along its length. */
  segmentIndex: z.number().int().min(0).default(0),
  /** Which lift of that segment, counting up from the base. */
  liftIndex: z.number().int().min(0).default(0),

  /**
   * The day this pour is cast, `YYYY-MM-DD`. Absent means unprogrammed.
   *
   * Here rather than on the host element because a date is per *pour*, and the whole
   * reason this node exists is that an element is cast in several: a 9 m wall in three
   * lifts is three dates a week apart, and a date on the wall could only be one of
   * them. It is also why a shutter is the thing a programme has rows for.
   *
   * Stated rather than derived from a sequence. A real scheduler would compute it from
   * dependencies and float, and until that exists a stated date is the honest input —
   * where a derived one would be a programme the project never agreed to, presented
   * with the same confidence as the geometry.
   *
   * A date rather than a timestamp, because everything downstream of it is measured in
   * days: a hire runs in days, a striking table is tabulated in days, and a programme
   * has day columns. An hour on this field would imply a precision the strike periods
   * it is added to do not have.
   */
  pourAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),

  /**
   * The day the plant is actually booked against, `YYYY-MM-DD`. Absent means nobody has
   * committed to this pour yet.
   *
   * `pourAt` is what the project currently intends and this is what somebody has agreed
   * to. Every date in this model until now has been the first kind: typed by whoever was
   * planning, moved freely by anybody, and — since `resequence.ts` shipped — offered up as
   * a candidate to shift eight days to save 24 panels. None of that is safe once a hire
   * company has the delivery in its diary and the following trade has been told when the
   * floor is theirs. That is a different claim about the same day, and it needs its own
   * field rather than a flag, for the reason below.
   *
   * **A date rather than a boolean, because the two can come apart and that is the whole
   * point.** A `committed: true` beside `pourAt` would silently follow `pourAt` wherever it
   * went, so moving a booked pour would look exactly like moving a free one and the
   * commitment would re-attach itself to the new day as though the hire desk had agreed to
   * it. Storing the day that was agreed instead means a `pourAt` that has moved off it is
   * *visible*: the plant is booked for one day and the programme now says another, which is
   * a phone call somebody has to make rather than a state the model should hide.
   *
   * So the four states are distinct and each means something different: neither field is
   * unprogrammed; `pourAt` alone is an intent, and free to move; the two equal is committed;
   * and the two unequal is a commitment the programme has drifted off.
   *
   * Writing it does not move `pourAt` and moving `pourAt` does not clear it. A site really
   * does move committed pours, and that event is expensive rather than invalid — refusing
   * the edit would only push the user into clearing the commitment first, which loses the
   * one fact worth keeping.
   */
  committedPourAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),

  /** Catalog system; absent means the project default. */
  systemId: z.string().trim().max(120).optional(),
  /**
   * Widest panel the layout may spend, m. Not a module width — the layout picks
   * real catalog widths and this caps them, which is how a job says "hand-set
   * only, nothing over 0.60" or "no crane, keep off the large-area panels".
   */
  panelWidth: z.number().finite().positive().default(0.6),
  fillerPosition: FormworkFillerPosition.default('middle'),
  /** Catalog panel ids the yard cannot supply, so the layout must avoid them. */
  avoidedPanelIds: z.array(z.string()).default([]),
  designOverrides: FormworkDesignOverrides.default({}),
  partOverrides: z.record(z.string(), FormworkPartOverride).default({}),
}).describe(
  dedent`
  Formwork assembly - the shutter for one lift of one pour segment of a castable element
  - parentId: the element this shutter forms (wall/column); the host relation
  - segmentIndex: which pour segment along the host's length, 0-based
  - liftIndex: which lift up the host, 0-based; each non-bottom lift sits on a construction joint
  - pourAt: the day this pour is cast, YYYY-MM-DD; absent means unprogrammed and the takeoff carries no dates for it. Per pour rather than per element: a wall cast in three lifts has three dates
  - committedPourAt: the day the plant is actually booked against, YYYY-MM-DD; absent means nobody has committed to this pour. pourAt is what the project intends and this is what somebody agreed to, so a committedPourAt that no longer equals pourAt is a booking the programme has drifted off rather than an error
  - systemId: catalog formwork system; absent means the project default
  - panelWidth: widest catalog panel the layout may spend, meters, default 0.6
  - fillerPosition: where the non-modular closing piece goes in the panel run
  - avoidedPanelIds: catalog panels unavailable for this assembly
  - designOverrides: forced tie/waler/joist spacings and tie SKU, checked against the calculated values
  - partOverrides: per-part edits keyed by the part's mark
  `,
)
export type FormworkAssemblyNode = z.infer<typeof FormworkAssemblyNode>
export type FormworkAssemblyId = FormworkAssemblyNode['id']
