import { z } from 'zod'
import { ConcreteFaceSide, ExposureClass, FormworkMode, KickerMode } from '../../schema/formwork'
import type { BeamNode } from '../../schema/nodes/beam'
import type { ColumnNode } from '../../schema/nodes/column'
import type { SlabNode } from '../../schema/nodes/slab'
import type { WallNode } from '../../schema/nodes/wall'
import type { CastableKind } from './coverage/elements'

/**
 * What an agent may say about *how an element is built* — one write contract for every AI
 * surface, and the refusals that keep a kind-specific field off the wrong kind.
 *
 * These are the inputs everything else in this system is solved from. `formworkType`
 * decides whether anything is formed at all, `castOrder` decides which faces are, and the
 * pressure envelope is a function of neither — so this is the write that has to happen
 * before `attach_formwork`, and it is the one an agent is most likely to guess at, because
 * every field reads like a preference and every one is a structural decision.
 *
 * ## Why it is more than `Object.assign`
 *
 * Two of these fields exist on a slab only, and the schema cannot say so: `edgeFaceCount`
 * and `soffitHeightAboveSupport` are declared on `SlabNode` while the rest come from the
 * shared `ShutteringFields`/`CastableFields`, so a model that sets an edge face count on a
 * wall writes a field the wall's schema rejects — or worse, one it silently carries and
 * nothing reads. `applyConstructionPatch` refuses that rather than dropping it, because a
 * dropped field is a decision the user believes was recorded.
 *
 * ## What this deliberately cannot do
 *
 * It does not write, and it does not build. The fields come back and the caller applies
 * them — the chat tools mutate a plain graph, MCP goes through the store's `updateNode`.
 * And setting `formworkType` forms nothing on its own: the shutters follow from
 * `attach_formwork`, which is why `changed` names that call when the patch turned forming
 * on. See [[pour-patch]] for the pair on the other side of that boundary.
 */

/** The fields any castable kind takes. */
const SHARED_CONSTRUCTION_INPUT = {
  formworkType: z
    .enum(['plywood', 'aluminium', 'steel-panel', 'none'])
    .nullable()
    .optional()
    .describe(
      "the shuttering system this element is cast against. Nothing is formed until this names one, and 'none' states that it is cast against something else entirely. Setting it does not build the shutters — call attach_formwork afterwards",
    ),
  formworkMode: FormworkMode.nullable()
    .optional()
    .describe(
      'form both faces, one face with the other braced or against earth, or neither. A single-sided wall needs a braced frame reacting the whole pour pressure into the ground, so do not state it for convenience',
    ),
  shutterMaterial: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe('free-text material reference for the forming face, e.g. "18mm film-faced ply"'),
  tieSpacing: z
    .number()
    .finite()
    .positive()
    .nullable()
    .optional()
    .describe(
      'meters, and it means different hardware per kind: through-tie centres on a wall, clamp pitch on a column, bearer centres under a slab deck. Leave it unstated to have it solved from the pressure envelope — a stated figure overrides the calculation',
    ),
  walerSpacing: z
    .number()
    .finite()
    .positive()
    .nullable()
    .optional()
    .describe(
      'meters — waler centres on a wall, yoke pitch on a column, joist centres under a slab. Unstated is solved, stated overrides',
    ),
  scaffoldRequired: z
    .boolean()
    .nullable()
    .optional()
    .describe('whether a working platform is needed to erect and strike this element'),
  castOrder: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'pour sequence rank, lower is cast first. This is a formwork input rather than an annotation: a face butting concrete already hardened is not formed, so changing it changes the shutter and the bill',
    ),
  pourId: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .describe(
      'elements sharing one are cast monolithically — no joint and no stop-end between them. A column in the plane of a wall and sharing its pourId is a pilaster',
    ),
  againstEarthSide: ConcreteFaceSide.nullable()
    .optional()
    .describe(
      "which face is cast against earth or existing structure, so it cannot be formed or tied through. On a slab, 'b' reads as a ground-bearing underside, which needs no soffit deck or props at all",
    ),
  exposureClass: ExposureClass.nullable()
    .optional()
    .describe(
      'standard, architectural (visible concrete, so a tighter deflection limit and a stricter joint layout), or water-retaining (no tie may pass through the section)',
    ),
  specifiedTieGridMm: z
    .object({
      columnsMm: z.number().finite().positive(),
      rowsMm: z.number().finite().positive(),
    })
    .nullable()
    .optional()
    .describe(
      "the architect's tie-hole grid on visible concrete, columns × rows in mm. Stated, never derived: the exposed face is read by the module, so the tie rows sit on it uniform rather than graded, and a tie the module would overload is answered by a lower pour rate rather than by moving the grid. Leave it unstated to let the design grade the rows",
    ),
  kickerMode: KickerMode.nullable()
    .optional()
    .describe('whether the kicker is cast with this element, separately, or omitted'),
} as const

/** Declared on `SlabNode` alone, so refused on the other kinds rather than dropped. */
const SLAB_ONLY_CONSTRUCTION_INPUT = {
  edgeFaceCount: z
    .number()
    .int()
    .min(1)
    .max(2)
    .nullable()
    .optional()
    .describe('slabs only: 2 where the rim is an upstand or a downstand edge beam'),
} as const

/**
 * Declared on slabs and beams: the height the falsework is erected off, which
 * only an element with a propped soffit has. Refused on walls and columns.
 */
const SOFFIT_ONLY_CONSTRUCTION_INPUT = {
  soffitHeightAboveSupport: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .optional()
    .describe(
      'slabs and beams only: meters from the floor the props stand on to the soffit. This is the prop length, so it drives the prop capacity and the whole falsework design',
    ),
} as const

/**
 * The whole write, as a tool's input shape.
 *
 * A raw shape rather than a `z.object` so an MCP `inputSchema` takes it directly and the
 * AI SDK's `tool()` wraps it. Every field is `.nullable().optional()` for the reason the
 * other patch modules give: an agent needs three states where the node has two — state
 * it, leave it alone, or take it off.
 */
export const constructionPatchInput = {
  elementId: z.string().min(1),
  ...SHARED_CONSTRUCTION_INPUT,
  ...SLAB_ONLY_CONSTRUCTION_INPUT,
  ...SOFFIT_ONLY_CONSTRUCTION_INPUT,
}

export const ConstructionPatch = z.object(constructionPatchInput)
export type ConstructionPatch = z.infer<typeof ConstructionPatch>

/** The description every surface's construction write carries. */
export const SET_ELEMENT_CONSTRUCTION_DESCRIPTION =
  'Set how one wall, column, slab or beam is built and cast — the inputs every formwork figure is solved from. Nothing is formed until formworkType names a system, and setting it builds nothing on its own: call attach_formwork afterwards or the shutter never appears in the scene. castOrder is a formwork input rather than a note, because a face butting concrete already cast is not formed — so ask about the pour sequence rather than assuming every element is freestanding. tieSpacing and walerSpacing mean different hardware per kind (through-ties and walers on a wall, clamps and yokes on a column, bearers and joists under a slab deck) and are solved from the pressure envelope when left unstated, so state one only to override the calculation deliberately. edgeFaceCount applies to slabs alone; soffitHeightAboveSupport to slabs and beams, whose props stand on the floor below. Ask the user for the values you are missing rather than guessing: these are load-bearing engineering decisions, and a wrong exposureClass or formworkMode produces a complete, plausible bill for a shutter nobody can put up. Pass null to unstate a field.'

/** The description every surface's castable-element read carries. */
export const LIST_CASTABLE_ELEMENTS_DESCRIPTION =
  'Every wall, column, slab and beam in the scene with its dimensions, pour sequence and construction properties — the read to make before any formwork question, because it says which elements are formed and which are not. An element with no formworkType is not shuttered and is absent from every bill; that is the usual reason a total is lower than expected, and it is invisible in a bill of what exists. The dimensions here are the extent each kind is cast over (a wall between two points, a column at one, a slab as a polygon, a beam along a centreline), so this is also how to find the element ids the other formwork tools take.'

/** The description every surface's pour-unit read carries. */
export const INSPECT_POUR_UNITS_DESCRIPTION =
  "How a wall, column, slab or beam is split into separately cast pour units, why each cut is there, and what each unit's concrete volume is. Each unit is one shutter erected, poured and struck on its own, so the unit count is the shutter count an element needs and each cut between two units is a construction joint carrying roughening and starter bars. Read this to explain a formwork layout, to check whether an element is formed for the way it is cast, or before quoting a concrete volume — the volume per unit is what the batch plant has to deliver in one go, not a figure to add up. A slab is always one unit: both cuts run along a centreline and a slab has none."

/**
 * The refusal for a slab-only field stated on a wall or a column.
 *
 * Refused rather than ignored. The field is declared on `SlabNode` alone, so writing it
 * to a wall either fails the schema or lands somewhere nothing reads — and an agent told
 * "ok" over a dropped field reports a decision the project does not hold.
 */
export function slabOnlyFields(elementId: string, kind: CastableKind, fields: string[]): string {
  return `Error: ${fields.join(' and ')} ${fields.length === 1 ? 'applies' : 'apply'} to slabs only, and ${elementId} is a ${kind}.`
}

export type ConstructionPatchResult =
  | { error: string; writes?: undefined; changed?: undefined; formingTurnedOn?: undefined }
  | {
      error?: undefined
      /** The fields to write. An explicit `undefined` clears rather than stores. */
      writes: Record<string, unknown>
      /** What the call changed, in the words a reply reads back. */
      changed: string[]
      /** Set when this call is what made the element formed, so a reply can name the next one. */
      formingTurnedOn: boolean
    }

const CONSTRUCTION_FIELDS = [
  ...Object.keys(SHARED_CONSTRUCTION_INPUT),
  ...Object.keys(SLAB_ONLY_CONSTRUCTION_INPUT),
  ...Object.keys(SOFFIT_ONLY_CONSTRUCTION_INPUT),
] as const

const SLAB_ONLY_FIELDS = Object.keys(SLAB_ONLY_CONSTRUCTION_INPUT)
const SOFFIT_ONLY_FIELDS = Object.keys(SOFFIT_ONLY_CONSTRUCTION_INPUT)

/**
 * What a stated construction change does to an element — the writes, or the refusal.
 *
 * `formingTurnedOn` is the one derived answer here, and it exists because the most common
 * failure on this surface is not a bad value: it is a correct `formworkType` written,
 * reported "ok", and never followed by an attach — leaving a project that believes it
 * specified a steel-panel wall and holds no shutter, no bill and nothing on screen.
 */
/**
 * One stated field, in the words a reply reads back — the grid read as a module
 * rather than as "[object Object]" because that is how the design names it.
 */
function describeChanged(field: string, value: unknown): string {
  if (value === null) return `${field} unstated`
  if (field === 'specifiedTieGridMm') {
    const grid = value as { columnsMm: number; rowsMm: number }
    return `specifiedTieGridMm ${grid.columnsMm} × ${grid.rowsMm} mm`
  }
  return `${field} ${String(value)}`
}

export function applyConstructionPatch(
  kind: CastableKind,
  currentFormworkType: string | undefined,
  patch: Omit<ConstructionPatch, 'elementId'>,
  elementId: string,
): ConstructionPatchResult {
  const stated = CONSTRUCTION_FIELDS.filter(
    (field) => patch[field as keyof typeof patch] !== undefined,
  )
  if (stated.length === 0) {
    return {
      error: `Error: nothing to set — pass at least one of ${CONSTRUCTION_FIELDS.join(', ')}`,
    }
  }
  const misplaced = stated.filter((field) => SLAB_ONLY_FIELDS.includes(field) && kind !== 'slab')
  if (misplaced.length > 0) return { error: slabOnlyFields(elementId, kind, misplaced) }

  // The falsework-height field is a soffit's, so a wall or column writing it is
  // refused the same way — a prop length on an element with nothing propped is
  // a decision recorded nowhere.
  const soffitMisplaced = stated.filter(
    (field) => SOFFIT_ONLY_FIELDS.includes(field) && kind !== 'slab' && kind !== 'beam',
  )
  if (soffitMisplaced.length > 0) {
    return {
      error: `${soffitMisplaced.join(' and ')} ${soffitMisplaced.length === 1 ? 'applies' : 'apply'} to slabs and beams only, and ${elementId} is a ${kind}.`,
    }
  }

  const writes: Record<string, unknown> = {}
  const changed: string[] = []
  for (const field of stated) {
    const value = patch[field as keyof typeof patch]
    // `null` means "unstate this", which both callers spell as an explicit `undefined`.
    // An absent key means "leave it alone", so the two cannot be collapsed.
    writes[field] = value ?? undefined
    changed.push(describeChanged(field, value))
  }

  const formed = (value: unknown): boolean =>
    typeof value === 'string' && value !== 'none' && value !== ''
  return {
    writes,
    changed,
    formingTurnedOn:
      patch.formworkType !== undefined &&
      formed(patch.formworkType) &&
      !formed(currentFormworkType),
  }
}

/**
 * One element as a formwork question sees it: what it is, and how it is built.
 *
 * The extent fields differ per kind because the concrete does — a wall runs between two
 * points, a column stands at one, a slab is a polygon — and the construction fields are
 * the same three kinds' shared ones. `formworkType` absent is the field to read first: it
 * is the difference between an element with no shutter and an element that needs none, and
 * that distinction is what makes a project total lower than a user expects.
 */
export interface CastableElementSummary {
  id: string
  kind: CastableKind
  parentId: string | null
  start?: readonly [number, number]
  end?: readonly [number, number]
  position?: readonly [number, number, number]
  crossSection?: string
  width?: number
  depth?: number
  radius?: number
  polygon?: ReadonlyArray<readonly [number, number]>
  holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
  elevation?: number
  thickness?: number
  height?: number
  edgeFaceCount?: number
  soffitHeightAboveSupport?: number
  formworkType?: string
  formworkMode?: string
  shutterMaterial?: string
  tieSpacing?: number
  walerSpacing?: number
  scaffoldRequired?: boolean
  castOrder?: number
  pourId?: string
  againstEarthSide?: string
  exposureClass?: string
  kickerMode?: string
  maxLiftHeight?: number
  maxPourLength?: number
  maxPourVolume?: number
  specifiedTieGridMm?: { columnsMm: number; rowsMm: number }
}

/**
 * The summary both AI surfaces list an element as.
 *
 * Shared rather than written per surface because the omissions are what carry meaning
 * here: a field left off one surface's list is a decision the model cannot see and will
 * therefore ask the user to restate, and a spacing shown on one and hidden on the other
 * is two different answers to "is this solved or stated".
 */
export function castableElementSummary(
  node: WallNode | ColumnNode | SlabNode | BeamNode,
): CastableElementSummary {
  const shared = {
    id: node.id as string,
    kind: node.type,
    parentId: (node.parentId as string | null) ?? null,
    formworkType: node.formworkType,
    formworkMode: node.formworkMode,
    shutterMaterial: node.shutterMaterial,
    tieSpacing: node.tieSpacing,
    walerSpacing: node.walerSpacing,
    scaffoldRequired: node.scaffoldRequired,
    castOrder: node.castOrder,
    pourId: node.pourId,
    againstEarthSide: node.againstEarthSide,
    exposureClass: node.exposureClass,
    kickerMode: node.kickerMode,
    maxLiftHeight: node.maxLiftHeight,
    maxPourLength: node.maxPourLength,
    maxPourVolume: node.maxPourVolume,
    specifiedTieGridMm: node.specifiedTieGridMm,
  }
  if (node.type === 'wall') {
    const { end, height, start, thickness } = node
    return { ...shared, start, end, thickness, height }
  }
  if (node.type === 'column') {
    const { crossSection, depth, height, position, radius, width } = node
    return { ...shared, position, crossSection, width, depth, radius, height }
  }
  if (node.type === 'beam') {
    const { depth, elevation, end, start, width } = node
    return { ...shared, start, end, width, depth, elevation, soffitHeightAboveSupport: elevation }
  }
  const { edgeFaceCount, elevation, holes, polygon, soffitHeightAboveSupport, thickness } = node
  return {
    ...shared,
    polygon,
    holes,
    elevation,
    thickness,
    edgeFaceCount,
    soffitHeightAboveSupport,
  }
}
