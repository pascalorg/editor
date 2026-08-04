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
