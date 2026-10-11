import { z } from 'zod'
import { DoorType, WindowType } from '../../schema/nodes/opening-types'
import { FenceOrnamentSchema } from '../fence/fence-ornament'

/**
 * A facade unit is the minimal facade: one run from a corner or T-junction to
 * the next. It is a list of bays pinned to the run's two corners, and it
 * carries its own finish, so a saved unit reproduces the whole look.
 *
 * The constraint vocabulary mirrors a design tool's component panel: an anchor
 * across the run, a fixed or stretching size, and — the one addition those
 * tools do not have — a fixed-size repeat that keeps real dimensions and puts
 * the leftover space where the unit says. A repeating bay multiplies as one
 * piece, so an opening and its balcony never drift apart. A unit is plain data:
 * it survives a catalog round trip and resolves the same way in every viewer.
 */

/** Smallest opening or bay the resolver will place. */
export const FACADE_UNIT_MIN_OPENING = 0.3
/** Gap kept around an existing opening, and between balconies, before a bay is skipped. */
export const FACADE_UNIT_CLEARANCE = 0.15
/** Upper bound on one bay's repetition, so a thin end pier cannot stall the editor. */
export const FACADE_UNIT_MAX_REPEAT = 96
const MIN_BALCONY_WIDTH = 0.6

/** A paint reference, as on any node slot: `library:<id>` or `scene:<id>`. */
const MaterialRef = z.string().regex(/^(library|scene):.+/)

/** What the unit paints on the walls and openings it fills; an absent entry keeps theirs. */
export const FacadePaintSchema = z.object({
  /** The filled face of the wall. */
  wall: MaterialRef.optional(),
  /** Window and door frames, and door leaves. */
  frame: MaterialRef.optional(),
  /** Window and door glass. */
  glass: MaterialRef.optional(),
})
export type FacadePaint = z.infer<typeof FacadePaintSchema>

export const FacadeBayOpeningSchema = z.object({
  kind: z.enum(['window', 'door']).default('window'),
  /** Used unless the opening stretches across its bay. */
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  /** Floor-to-opening distance when anchored to the bottom, mirrored when to the top. */
  sill: z.number().finite().nonnegative().default(0),
  vertical: z.enum(['bottom', 'center', 'top']).default('bottom'),
  widthMode: z.enum(['fixed', 'stretch']).default('fixed'),
  heightMode: z.enum(['fixed', 'stretch']).default('fixed'),
  /** Shift from the bay centre, or the inset from both bay sides when stretching. */
  offsetX: z.number().finite().default(0),
  /** Shift from the vertical anchor, or the head clearance when stretching. */
  offsetY: z.number().finite().default(0),
  /** How a window opens. */
  windowType: WindowType.default('casement'),
  /** Pane grid of a window: equal columns (mullions) and rows (transoms). */
  columns: z.number().int().min(1).max(6).default(1),
  rows: z.number().int().min(1).max(4).default(1),
  /**
   * Unequal panes, as proportions: rows top to bottom, columns left to right. Given, they set the
   * count too. [0.6, 0.4]: an upper row taller than the lower, as on the Victor's windows.
   */
  rowRatios: z.array(z.number().finite().positive()).min(1).max(4).optional(),
  columnRatios: z.array(z.number().finite().positive()).min(1).max(6).optional(),
  /** How a door opens. French: glazed leaves, two when the opening is wide enough. */
  doorType: DoorType.default('french'),
  /**
   * How far the frame's outer face sits behind the wall face, in metres. Absent
   * centres the frame in the wall, as openings always were.
   */
  recess: z.number().finite().min(0).max(0.6).optional(),
  /** Depth of the sill ledge under a window; 0 leaves none. Absent keeps the window's own. */
  sillDepth: z.number().finite().min(0).max(0.6).optional(),
  frameDepth: z.number().finite().min(0.01).max(0.4).optional(),
  shape: z.enum(['rectangle', 'rounded', 'arch']).optional(),
  /** Rise of an arched head. */
  archHeight: z.number().finite().min(0).max(3).optional(),
})
export type FacadeBayOpening = z.infer<typeof FacadeBayOpeningSchema>
export type FacadeOpeningStyle = Pick<
  FacadeBayOpening,
  | 'windowType'
  | 'columns'
  | 'rows'
  | 'rowRatios'
  | 'columnRatios'
  | 'doorType'
  | 'recess'
  | 'sillDepth'
  | 'frameDepth'
  | 'shape'
  | 'archHeight'
>

/** What an opening of this bay looks like, apart from where it is and how big. */
const openingStyle = (opening: FacadeBayOpening): FacadeOpeningStyle => ({
  windowType: opening.windowType,
  columns: opening.columns,
  rows: opening.rows,
  rowRatios: opening.rowRatios,
  columnRatios: opening.columnRatios,
  doorType: opening.doorType,
  recess: opening.recess,
  sillDepth: opening.sillDepth,
  frameDepth: opening.frameDepth,
  shape: opening.shape,
  archHeight: opening.archHeight,
})

export const FacadeBayBalconySchema = z.object({
  /** Absent means the bay's full width. */
  width: z.number().finite().min(MIN_BALCONY_WIDTH).max(12).optional(),
  depth: z.number().finite().min(0.5).max(3).default(1.4),
  railing: z.enum(['slat', 'rail', 'glass']).default('slat'),
  /**
   * One balcony per bay, or one continuous balcony (a *balcon filant*) from the
   * first repeat to the last.
   */
  span: z.enum(['bay', 'continuous']).default('bay'),
  deckMaterial: MaterialRef.optional(),
  /** Posts and rails; a glass railing keeps its glass. */
  railingMaterial: MaterialRef.optional(),
  /** Ironwork drawn between the railing's posts and rails instead of its slats. */
  ornament: FenceOrnamentSchema.optional(),
  /** Shift from the bay centre. */
  offsetX: z.number().finite().default(0),
})
export type FacadeBayBalcony = z.infer<typeof FacadeBayBalconySchema>

/** Cladding panels a bay lays out around its opening: their paint and how they sit on the face. */
export const FacadeCladdingSchema = z.object({
  material: MaterialRef,
  /** Panel depth. */
  thickness: z.number().finite().min(0.005).max(0.5).default(0.03),
  /** Gap between the wall face and the panel; positive stands it proud. */
  standoff: z.number().finite().min(0).max(1).default(0),
})
export type FacadeCladding = z.infer<typeof FacadeCladdingSchema>

export const FacadeInfillSchema = FacadeCladdingSchema.extend({
  /** Which sides of the opening are clad. */
  sides: z.enum(['both', 'left', 'right']).default('both'),
  /** Width of each side panel from the opening; absent fills to the bay's edge. */
  width: z.number().finite().min(0.05).max(6).optional(),
  /** Floor to ceiling, or only as tall as the opening beside it. */
  height: z.enum(['storey', 'opening']).default('storey'),
})
export type FacadeInfill = z.infer<typeof FacadeInfillSchema>

export const FacadeSpandrelSchema = FacadeCladdingSchema.extend({
  /** Below the opening, above it, or both. */
  parts: z.enum(['both', 'below', 'above']).default('both'),
})
export type FacadeSpandrel = z.infer<typeof FacadeSpandrelSchema>

/** A frame round the opening — jambs and a head — standing proud of the infill and spandrels. */
export const FacadeSurroundSchema = FacadeCladdingSchema.extend({
  thickness: z.number().finite().min(0.005).max(0.5).default(0.06),
  /** Width of the frame. */
  width: z.number().finite().min(0.04).max(0.6).default(0.15),
  /** A plain head or one capped by a small cornice; an arched opening takes a keystone instead. */
  head: z.enum(['plain', 'cornice']).default('plain'),
})
export type FacadeSurround = z.infer<typeof FacadeSurroundSchema>

/** Cladding over the piers between the bays, prouder than their panels: brick piers, say. */
export const FacadePiersSchema = FacadeCladdingSchema.extend({
  thickness: z.number().finite().min(0.005).max(0.5).default(0.06),
})
export type FacadePiers = z.infer<typeof FacadePiersSchema>

/** A variant changes only what it names; nothing here has a default, so it never resets the bay. */
const FacadeOpeningPatchSchema = z.object({
  kind: z.enum(['window', 'door']).optional(),
  width: z.number().finite().min(FACADE_UNIT_MIN_OPENING).optional(),
  height: z.number().finite().min(FACADE_UNIT_MIN_OPENING).optional(),
  sill: z.number().finite().nonnegative().optional(),
  windowType: WindowType.optional(),
  columns: z.number().int().min(1).max(6).optional(),
  rows: z.number().int().min(1).max(4).optional(),
  rowRatios: z.array(z.number().finite().positive()).min(1).max(4).optional(),
  columnRatios: z.array(z.number().finite().positive()).min(1).max(6).optional(),
  doorType: DoorType.optional(),
  recess: z.number().finite().min(0).max(0.6).optional(),
  sillDepth: z.number().finite().min(0).max(0.6).optional(),
  frameDepth: z.number().finite().min(0.01).max(0.4).optional(),
  shape: z.enum(['rectangle', 'rounded', 'arch']).optional(),
  archHeight: z.number().finite().min(0).max(3).optional(),
})
const FacadeBalconyPatchSchema = z.object({
  width: z.number().finite().min(MIN_BALCONY_WIDTH).max(12).optional(),
  depth: z.number().finite().min(0.5).max(3).optional(),
  railing: z.enum(['slat', 'rail', 'glass']).optional(),
  span: z.enum(['bay', 'continuous']).optional(),
  deckMaterial: MaterialRef.optional(),
  railingMaterial: MaterialRef.optional(),
  ornament: FenceOrnamentSchema.optional(),
  offsetX: z.number().finite().optional(),
})
const FacadeCladdingPatchSchema = z.object({
  material: MaterialRef.optional(),
  thickness: z.number().finite().min(0.005).max(0.5).optional(),
  standoff: z.number().finite().min(0).max(1).optional(),
})
const FacadeSurroundPatchSchema = FacadeCladdingPatchSchema.extend({
  width: z.number().finite().min(0.04).max(0.6).optional(),
  head: z.enum(['plain', 'cornice']).optional(),
})

/**
 * One look a bay can take, drawn per column so it stacks down the facade: its
 * opening, balcony (null takes it away), infill and spandrel (null too), as
 * changes to the bay. An empty variant is the bay as it is.
 */
export const FacadeBayVariantSchema = z.object({
  weight: z.number().finite().min(0).default(1),
  opening: FacadeOpeningPatchSchema.optional(),
  balcony: FacadeBalconyPatchSchema.nullable().optional(),
  infill: FacadeCladdingPatchSchema.nullable().optional(),
  spandrel: FacadeCladdingPatchSchema.nullable().optional(),
  surround: FacadeSurroundPatchSchema.nullable().optional(),
})
export type FacadeBayVariant = z.infer<typeof FacadeBayVariantSchema>

export const FacadeBaySchema = z.object({
  /** Stable identity inside the unit; also seeds the keys of what it generates. */
  key: z.string().min(1),
  name: z.string().optional(),
  width: z.number().finite().positive(),
  horizontal: z.enum(['left', 'center', 'right']).default('center'),
  widthMode: z.enum(['fixed', 'stretch', 'repeat']).default('repeat'),
  /** Inset from the anchored corner (fixed), or from both corners (stretch). */
  offsetX: z.number().finite().default(0),
  /** The pier kept at each end of the run, before the first and after the last repeat. */
  endPier: z.number().finite().nonnegative().default(0.2),
  /** The pier between two repeats, on top of `width`. */
  pier: z.number().finite().nonnegative().default(1),
  /** Where a repeat puts the space its bays do not use. */
  remainder: z.enum(['center', 'widen-piers', 'align-to-anchor']).default('center'),
  /**
   * `locked`: the bay is `width` wide and its infill fills beside the opening.
   * `content`: the bay hugs its children like CSS `fit-content` — infill, opening,
   * infill laid side by side — so a wider panel pushes the bay and the run re-flows.
   */
  fit: z.enum(['locked', 'content']).default('locked'),
  opening: FacadeBayOpeningSchema.optional(),
  balcony: FacadeBayBalconySchema.optional(),
  /** Beside the opening, floor to ceiling; the whole bay when it has no opening. */
  infill: FacadeInfillSchema.optional(),
  /** Below and above the opening, across its width. */
  spandrel: FacadeSpandrelSchema.optional(),
  /** A frame round the opening. */
  surround: FacadeSurroundSchema.optional(),
  /** Looks drawn per column from the unit's seed; absent, every repeat looks the same. */
  variants: z.array(FacadeBayVariantSchema).max(8).optional(),
})
export type FacadeBay = z.infer<typeof FacadeBaySchema>

/** Infill beside each side of the opening, in metres, when the bay hugs its content. */
function hugSides(bay: FacadeBay): { left: number; right: number } | null {
  if (bay.fit !== 'content' || bay.widthMode === 'stretch') return null
  if (bay.opening && bay.opening.widthMode !== 'fixed') return null
  const { infill } = bay
  const side = (which: 'left' | 'right') =>
    infill && infill.sides !== (which === 'left' ? 'right' : 'left') ? (infill.width ?? 0) : 0
  return { left: side('left'), right: side('right') }
}

/**
 * The width a bay takes in its run: its own `width` when locked, or the sum of
 * its children when it hugs them.
 */
export function bayWidth(bay: FacadeBay): number {
  const sides = hugSides(bay)
  if (!sides) return bay.width
  const content = sides.left + (bay.opening?.width ?? 0) + sides.right
  return content > 0 ? content : bay.width
}
export type FacadeUnitHorizontalAnchor = FacadeBay['horizontal']
export type FacadeUnitVerticalAnchor = FacadeBayOpening['vertical']
export type FacadeUnitWidthMode = FacadeBay['widthMode']
export type FacadeUnitHeightMode = FacadeBayOpening['heightMode']
export type FacadeUnitRemainder = FacadeBay['remainder']

export const FacadeUnitSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1),
    /** In precedence order: a later bay yields to the space an earlier one took. */
    bays: z.array(FacadeBaySchema).default([]),
    paint: FacadePaintSchema.default({}),
    /** Draws the bays' variants; the same seed always gives the same facade. */
    seed: z.number().int().optional(),
    /** Chance, per storey and column, that a draw breaks from the column's. */
    imperfection: z.number().finite().min(0).max(1).optional(),
    /**
     * `room`: every wall meeting the facade from inside restarts the rhythm (one
     * rhythm per room). `side`: one rhythm from corner to corner; those walls
     * become obstacles nothing lands on. Absent means room.
     */
    rhythm: z.enum(['room', 'side']).optional(),
    /** Cladding over the piers between the bays, standing proud of them. */
    piers: FacadePiersSchema.optional(),
    /**
     * An opening landing on an interior wall or an opening already there: skipped, or shifted
     * aside within its bay just far enough to clear it. `room`: moved into the room holding most
     * of its bay and narrowed to fit it, and every habitable room on the facade gets a window.
     * Absent means skipped.
     */
    obstacles: z.enum(['skip', 'shift', 'room']).optional(),
    /**
     * `building`: the repeating bay keeps one column grid per face of the building, laid on its
     * typical storey, so the windows stack from floor to floor. Absent: each run centres its own.
     */
    grid: z.enum(['run', 'building']).optional(),
  })
  .refine((unit) => new Set(unit.bays.map((m) => m.key)).size === unit.bays.length, {
    message: 'Each bay in a unit needs its own key.',
  })
export type FacadeUnit = z.infer<typeof FacadeUnitSchema>

/**
 * A unit that only paints the wall: no opening, balcony, panel or pier, which are laid along a
 * straight line. Paint follows any curve, so this one also goes on an arc.
 */
export function isPaintOnlyUnit(input: unknown): boolean {
  const unit = FacadeUnitSchema.parse(input)
  if (unit.piers) return false
  return unit.bays.every((bay) =>
    [bay, ...(bay.variants ?? [])].every(
      (part) => !(part.opening || part.balcony || part.infill || part.spandrel || part.surround),
    ),
  )
}

/** A centred row of 1.4 × 1.6 m windows on a 0.8 m sill, 1 m apart, 0.2 m clear of each corner. */
export const DEFAULT_FACADE_UNIT: FacadeUnit = FacadeUnitSchema.parse({
  name: 'Window bay',
  bays: [
    {
      key: 'window',
      width: 1.4,
      widthMode: 'repeat',
      endPier: 0.2,
      pier: 1,
      remainder: 'center',
      opening: { width: 1.4, height: 1.6, sill: 0.8 },
    },
  ],
})

export type FacadeUnitRun = { width: number; height: number }
export type FacadeUnitObstacle = { left: number; right: number; bottom: number; top: number }
export type FacadeOpeningPlacement = FacadeUnitObstacle & {
  kind: FacadeBayOpening['kind']
  style: FacadeOpeningStyle
  x: number
  y: number
}
export type FacadeBalconyPlacement = {
  left: number
  right: number
} & Pick<FacadeBayBalcony, 'depth' | 'railing' | 'deckMaterial' | 'railingMaterial' | 'ornament'>
export type FacadeBayPlacement = {
  /** `<bay key>:<repeat index>`, stable while the bay keeps its place in the rhythm. */
  key: string
  bay: string
  /** The bay's variant this placement drew, when the bay has variants. */
  variant?: number
  left: number
  right: number
  opening?: FacadeOpeningPlacement
  balcony?: FacadeBalconyPlacement
}
export type FacadeUnitResolution = {
  placements: FacadeBayPlacement[]
  /**
   * Bay placements dropped because their opening met an existing opening or
   * an earlier one from this unit, or their balcony met an earlier balcony.
   */
  skipped: number
  /** With `obstacles: 'room'`: the habitable rooms left without an opening. */
  unlit?: FacadeRoomFrontage[]
}
/**
 * A room's stretch of the run, between the faces of the walls that bound it. `owed`: a habitable
 * room (bedroom, living, dining, a kitchen of its own), which the `room` mode gives a window.
 */
export type FacadeRoomFrontage = {
  left: number
  right: number
  name: string
  owed: boolean
  /** The room's zone: a room meeting the facade on two stretches is lit by either. */
  id?: string
}
/** A stretch of a run on a face's column grid: `origin` is where one column starts. */
export type FacadeGridRegion = { left: number; right: number; origin: number }
/** The narrowest window the `room` mode makes to light a room. */
export const FACADE_ROOM_MIN_OPENING = 0.9
/**
 * Where the resolver is on the building, so a variant is drawn per column and
 * stacks down every storey: the storey's level, and a column key for a bay
 * centred at a point of the run. Without it, columns count from the run's start.
 */
export type FacadeVariationContext = {
  level: number
  column: (bay: FacadeBay, centre: number) => string
}
export type FacadeUnitResolutionOptions = {
  clearance?: number
  maxRepeat?: number
  variation?: FacadeVariationContext
  /** The rooms along the run, for `obstacles: 'room'`. */
  rooms?: readonly FacadeRoomFrontage[]
  /**
   * For `grid: 'building'`: stretches of the run that follow a face's grid, each with where one of
   * its columns starts, along the run. The rest of the run centres its own columns.
   */
  grid?: { regions: readonly FacadeGridRegion[] }
}

/**
 * How finely columns are told apart: half the bay's pitch, so a storey a few
 * centimetres off still draws the same column as the storeys above it.
 */
export const facadeColumnBin = (bay: FacadeBay) => Math.max(0.2, (bayWidth(bay) + bay.pier) / 2)

/**
 * A stable number in [0, 1) for a key: FNV-1a, then murmur3's finaliser, since
 * FNV alone barely moves its high bits when only the last character differs —
 * which is how neighbouring columns' keys differ.
 */
function hash01(key: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 0x100000000
}

/** The variant a bay centred at `centre` takes: one draw per column, broken per storey by imperfection. */
export function facadeBayVariantAt(
  unit: Pick<FacadeUnit, 'seed' | 'imperfection'>,
  bay: FacadeBay,
  centre: number,
  variation?: FacadeVariationContext,
): number | undefined {
  const variants = bay.variants
  if (!variants?.length) return undefined
  const column = variation
    ? variation.column(bay, centre)
    : String(Math.round(centre / facadeColumnBin(bay)))
  const seed = unit.seed ?? 0
  let draw = hash01(`${seed}|${bay.key}|${column}`)
  const imperfection = unit.imperfection ?? 0
  const level = variation?.level ?? 0
  if (imperfection > 0 && hash01(`${seed}|imperfect|${bay.key}|${column}|${level}`) < imperfection)
    draw = hash01(`${seed}|${bay.key}|${column}|${level}`)
  const total = variants.reduce((sum, v) => sum + v.weight, 0)
  if (total <= 0) return undefined
  let at = draw * total
  for (const [index, variant] of variants.entries()) {
    at -= variant.weight
    if (at < 0) return index
  }
  return variants.length - 1
}

/** The bay as a variant makes it. The resolver and the fill both read placements through this. */
export function bayVariant(bay: FacadeBay, index: number | undefined): FacadeBay {
  const variant = index === undefined ? undefined : bay.variants?.[index]
  if (!variant) return bay
  const patch = <T>(
    base: T | undefined,
    change: object | null | undefined,
    schema: z.ZodType<T>,
  ): T | undefined => {
    if (change === null) return undefined
    if (!change) return base
    const merged = schema.safeParse({ ...base, ...change })
    return merged.success ? merged.data : base
  }
  return {
    ...bay,
    opening: patch(bay.opening, variant.opening, FacadeBayOpeningSchema),
    balcony: patch(bay.balcony, variant.balcony, FacadeBayBalconySchema),
    infill: patch(bay.infill, variant.infill, FacadeInfillSchema),
    spandrel: patch(bay.spandrel, variant.spandrel, FacadeSpandrelSchema),
    surround: patch(bay.surround, variant.surround, FacadeSurroundSchema),
  }
}

type Span = { left: number; width: number }

/**
 * Resolve a unit across one run. Pure and deterministic: the same unit, run
 * and obstacles always produce the same placements, so a facade re-resolves
 * identically after a resize, a floor change or a reload.
 */
export function resolveFacadeUnit(
  unit: FacadeUnit,
  run: FacadeUnitRun,
  obstacles: readonly FacadeUnitObstacle[] = [],
  options: FacadeUnitResolutionOptions = {},
): FacadeUnitResolution {
  const clearance = options.clearance ?? FACADE_UNIT_CLEARANCE
  const maxRepeat = options.maxRepeat ?? FACADE_UNIT_MAX_REPEAT
  if (
    !Number.isFinite(run.width) ||
    !Number.isFinite(run.height) ||
    run.width <= 0 ||
    run.height <= 0
  )
    throw Error('Use a positive run width and height.')
  if (!Number.isFinite(clearance) || clearance < 0)
    throw Error('Use a non-negative opening clearance.')

  const placements: FacadeBayPlacement[] = []
  const openings: FacadeUnitObstacle[] = []
  const balconies: { left: number; right: number }[] = []
  let skipped = 0

  const rooms = options.rooms ?? []
  /** The clear stretch of a room: its frontage less the clearance from each wall face. */
  const clearOf = (room: FacadeRoomFrontage) => ({
    left: room.left + clearance,
    right: room.right - clearance,
  })
  /** An opening centred as near its place as the room allows, narrowed to fit, or none. */
  const fitInRoom = (opening: FacadeOpeningPlacement, room: FacadeRoomFrontage, at: number) => {
    const clear = clearOf(room)
    const width = Math.min(opening.right - opening.left, clear.right - clear.left)
    if (width < FACADE_ROOM_MIN_OPENING - 1e-9) return null
    const x = Math.min(Math.max(at, clear.left + width / 2), clear.right - width / 2)
    return { ...opening, left: x - width / 2, right: x + width / 2, x }
  }
  // A column on a partition moves into a room, past its bay's edge if it must: the Victor's B2
  // bedrooms were left dark when it could only shift within its bay. A habitable room it touches
  // takes it first, so a walk-in beside a bedroom stays dark; else the room holding most of its
  // bay, as any regular grid puts windows in kitchens and bathrooms. Moving only into habitable
  // rooms skipped every column on a wall between two apartments without rooms (2026-10-03).
  const intoRoom = (opening: FacadeOpeningPlacement, span: Span) => {
    const overlap = (room: FacadeRoomFrontage) =>
      Math.min(room.right, span.left + span.width) - Math.max(room.left, span.left)
    const touched = rooms.filter((room) => overlap(room) > 0)
    const byOverlap = (list: FacadeRoomFrontage[]) => list.sort((a, b) => overlap(b) - overlap(a))
    for (const room of [
      ...byOverlap(touched.filter((r) => r.owed)),
      ...byOverlap(touched.filter((r) => !r.owed)),
    ]) {
      const moved = fitInRoom(opening, room, opening.x)
      if (moved && !blockedRect(moved)) return moved
    }
    return null
  }
  const blockedRect = (rect: FacadeUnitObstacle) =>
    overlaps(rect, obstacles, clearance) || overlaps(rect, openings, clearance)
  const balconyCollides = (balcony: { left: number; right: number }) =>
    balconies.some((b) => balcony.left < b.right + clearance && balcony.right > b.left - clearance)
  const tryPlace = (
    bay: FacadeBay,
    span: Span,
    bounds: { left: number; right: number },
    index: number,
  ): FacadeBayPlacement | null => {
    const variant = facadeBayVariantAt(unit, bay, span.left + span.width / 2, options.variation)
    const look = bayVariant(bay, variant)
    const { opening } = look
    const vertical = opening ? verticalOf(look) : null
    let placedOpening =
      opening && vertical ? openingIn(span, opening, vertical, hugSides(look)?.left) : undefined
    if (opening && !placedOpening) {
      // A variant that cannot fit here is skipped; a bay that never fits contributes nothing.
      if (variant !== undefined) skipped++
      return null
    }
    // A continuous balcony is laid once every bay has its place (below).
    let balcony =
      look.balcony && look.balcony.span !== 'continuous'
        ? balconyIn(span, look.balcony, bounds)
        : undefined
    const blocked = (rect: FacadeUnitObstacle) =>
      overlaps(rect, obstacles, clearance) || overlaps(rect, openings, clearance)
    const moved =
      placedOpening && unit.obstacles === 'room' && rooms.length && blocked(placedOpening)
        ? intoRoom(placedOpening, span)
        : null
    // Where no room takes it, the column still tries to step aside within its bay.
    if (placedOpening && moved) {
      const step = moved.x - placedOpening.x
      placedOpening = moved
      if (balcony) {
        const left = Math.max(bounds.left, balcony.left + step)
        const right = Math.min(bounds.right, balcony.right + step)
        balcony = right - left >= MIN_BALCONY_WIDTH ? { ...balcony, left, right } : undefined
      }
    } else if (
      placedOpening &&
      (unit.obstacles === 'shift' || unit.obstacles === 'room') &&
      blocked(placedOpening)
    ) {
      const step = clearStep(placedOpening, span, [...obstacles, ...openings], clearance, blocked)
      if (step !== null) {
        placedOpening = shiftOpening(placedOpening, step)
        if (balcony) {
          const left = Math.max(bounds.left, balcony.left + step)
          const right = Math.min(bounds.right, balcony.right + step)
          balcony = right - left >= MIN_BALCONY_WIDTH ? { ...balcony, left, right } : undefined
        }
      }
    }
    if ((placedOpening && blocked(placedOpening)) || (balcony && balconyCollides(balcony))) {
      skipped++
      return null
    }
    const placement: FacadeBayPlacement = {
      key: `${bay.key}:${index}`,
      bay: bay.key,
      ...(variant === undefined ? {} : { variant }),
      left: span.left,
      right: span.left + span.width,
      ...(placedOpening ? { opening: placedOpening } : {}),
      ...(balcony ? { balcony } : {}),
    }
    placements.push(placement)
    if (placedOpening) openings.push(placedOpening)
    if (balcony) balconies.push(balcony)
    return placement
  }

  const verticalOf = (bay: FacadeBay) => {
    const { opening } = bay
    if (
      opening &&
      (opening.height < FACADE_UNIT_MIN_OPENING ||
        (opening.widthMode === 'fixed' && opening.width < FACADE_UNIT_MIN_OPENING))
    )
      throw Error('Openings must be at least 0.3 m wide and tall.')
    return opening ? resolveVertical(opening, run.height) : null
  }
  // A room's window when no column reached the run: the look of the first bay with an opening.
  const firstOpening = (centre: number) => {
    const bay = unit.bays.find((candidate) => candidate.opening && verticalOf(candidate))
    const vertical = bay && verticalOf(bay)
    if (!(bay?.opening && vertical)) return undefined
    const width = bay.opening.widthMode === 'stretch' ? bay.width : bay.opening.width
    return openingIn(
      { left: centre - width / 2, width },
      { ...bay.opening, widthMode: 'fixed', width, offsetX: 0 },
      vertical,
    )
  }

  // Pinned bays claim their span first, like fixed elements in a design tool;
  // repeating and stretching bays then fill the stretches left between them.
  // Bays pinned to the same side stack like flex items: each one's offset is
  // its gap from the previous bay pinned there, or from the corner if first.
  const whole = { left: 0, right: run.width }
  const taken: { left: number; right: number }[] = []
  let leftEdge = 0
  let rightEdge = run.width
  // A bay whose opening cannot fit this storey contributes nothing; with variants, each draw decides.
  const idle = (bay: FacadeBay) => !bay.variants?.length && !!bay.opening && !verticalOf(bay)
  for (const bay of unit.bays.filter((b) => b.widthMode === 'fixed')) {
    if (idle(bay)) continue
    const span =
      bay.horizontal === 'left'
        ? { left: leftEdge + bay.offsetX, width: bayWidth(bay) }
        : bay.horizontal === 'right'
          ? { left: rightEdge - bay.offsetX - bayWidth(bay), width: bayWidth(bay) }
          : resolveSpans(bay, run.width, maxRepeat)[0]
    if (!span || span.left < -1e-9 || span.left + span.width > run.width + 1e-9) {
      skipped++
      continue
    }
    if (!tryPlace(bay, span, whole, 0)) continue
    taken.push({ left: span.left, right: span.left + span.width })
    if (bay.horizontal === 'left') leftEdge = span.left + span.width
    if (bay.horizontal === 'right') rightEdge = span.left
  }
  const free = freeStretches(run.width, taken)
  for (const bay of unit.bays.filter((b) => b.widthMode !== 'fixed')) {
    if (idle(bay)) continue
    let index = 0
    const grid = unit.grid === 'building' && bay.widthMode === 'repeat' ? options.grid : undefined
    for (const stretch of free)
      for (const span of grid
        ? gridSpans(bay, stretch, grid.regions, maxRepeat)
        : resolveSpans(bay, stretch.right - stretch.left, maxRepeat))
        tryPlace(bay, { left: span.left + stretch.left, width: span.width }, stretch, index++)
  }

  // A continuous balcony (a *balcon filant*) runs along neighbouring placements
  // whose bays all want one — repeats of one bay, or a door bay and the window
  // bays beside it. Any other placement in between ends it.
  const bayOf = new Map(unit.bays.map((bay) => [bay.key, bay]))
  const lookOf = (placement: FacadeBayPlacement) =>
    bayVariant(bayOf.get(placement.bay)!, placement.variant)
  const inOrder = [...placements].sort((a, b) => a.left - b.left)
  let group: FacadeBayPlacement[] = []
  const layGroup = () => {
    const first = group[0]
    const look = first && lookOf(first).balcony
    if (first && look) {
      const balcony = { left: first.left, right: group.at(-1)!.right, ...balconyLook(look) }
      if (balcony.right - balcony.left < MIN_BALCONY_WIDTH || balconyCollides(balcony)) skipped++
      else {
        first.balcony = balcony
        balconies.push(balcony)
      }
    }
    group = []
  }
  for (const placement of inOrder) {
    if (lookOf(placement).balcony?.span === 'continuous') group.push(placement)
    else layGroup()
  }
  layGroup()

  if (unit.obstacles !== 'room' || !rooms.length) return { placements, skipped }
  // Every habitable room gets a window: one centred in a room no column reached, in the look of
  // the nearest window on the run.
  const lit = (room: FacadeRoomFrontage) =>
    openings.some((opening) => opening.right > room.left && opening.left < room.right)
  // A room is lit by any of its stretches of facade: one zone may meet it on two, split by a wall.
  const byRoom = new Map<string, FacadeRoomFrontage[]>()
  for (const room of rooms)
    if (room.owed)
      byRoom.set(room.id ?? room.name, [...(byRoom.get(room.id ?? room.name) ?? []), room])
  const unlit: FacadeRoomFrontage[] = []
  for (const stretches of byRoom.values()) {
    if (stretches.some(lit)) continue
    const widest = [...stretches].sort((a, b) => b.right - b.left - (a.right - a.left))
    let placed: { room: FacadeRoomFrontage; opening: FacadeOpeningPlacement } | null = null
    let nearest: FacadeBayPlacement | undefined
    for (const room of widest) {
      const centre = (room.left + room.right) / 2
      nearest = [...placements]
        .filter((placement) => placement.opening)
        .sort((a, b) => Math.abs(a.opening!.x - centre) - Math.abs(b.opening!.x - centre))[0]
      const look = nearest?.opening ?? firstOpening(centre)
      const opening = look && fitInRoom(look, room, centre)
      if (opening && !blockedRect(opening)) {
        placed = { room, opening }
        break
      }
    }
    if (!placed) {
      unlit.push(widest[0]!)
      continue
    }
    const { room, opening } = placed
    // Its own stretch of the run: the room's, short of any bay already laid there.
    const left = Math.max(
      room.left,
      ...placements.filter((p) => p.right <= opening.left + 1e-9).map((p) => p.right),
    )
    const right = Math.min(
      room.right,
      ...placements.filter((p) => p.left >= opening.right - 1e-9).map((p) => p.left),
    )
    const covered = left > opening.left + 1e-9 || right < opening.right - 1e-9
    const bay = nearest?.bay ?? unit.bays.find((candidate) => candidate.opening)!.key
    const placement: FacadeBayPlacement = {
      key: `${bay}:room:${room.name}`,
      bay,
      ...(nearest?.variant === undefined ? {} : { variant: nearest.variant }),
      left: covered ? opening.left : left,
      right: covered ? opening.right : right,
      opening,
    }
    placements.push(placement)
    openings.push(opening)
  }
  return { placements, skipped, unlit }
}

function resolveSpans(bay: FacadeBay, runWidth: number, maxRepeat: number): Span[] {
  if (bay.widthMode === 'stretch') {
    const width = runWidth - bay.offsetX * 2
    return width < FACADE_UNIT_MIN_OPENING ? [] : [{ left: bay.offsetX, width }]
  }
  if (bay.widthMode === 'fixed') {
    const width = bayWidth(bay)
    if (width > runWidth) return []
    const left =
      bay.horizontal === 'left'
        ? bay.offsetX
        : bay.horizontal === 'right'
          ? runWidth - width - bay.offsetX
          : (runWidth - width) / 2 + bay.offsetX
    return [{ left, width }]
  }
  return repeatSpans(bay, runWidth, maxRepeat)
}

/**
 * The columns of a stretch on the face's grid, relative to the stretch: in each grid region, the
 * grid's columns that fit inside its end piers; in the rest of the stretch, columns centred as
 * without a grid.
 */
function gridSpans(
  bay: FacadeBay,
  stretch: { left: number; right: number },
  regions: readonly FacadeGridRegion[],
  maxRepeat: number,
): Span[] {
  const width = bayWidth(bay)
  const pitch = width + bay.pier
  const spans: Span[] = []
  const covered: [number, number][] = []
  for (const region of regions) {
    const left = Math.max(stretch.left, region.left)
    const right = Math.min(stretch.right, region.right)
    if (right - left <= 1e-9) continue
    covered.push([left, right])
    let k = Math.ceil((left + bay.endPier - region.origin) / pitch - 1e-9)
    for (let at = region.origin + k * pitch; at + width <= right - bay.endPier + 1e-9; ) {
      spans.push({ left: at - stretch.left, width })
      if (spans.length > maxRepeat)
        throw Error(
          `This run would need more than ${maxRepeat} repeats. Increase their width or spacing.`,
        )
      k += 1
      at = region.origin + k * pitch
    }
  }
  covered.sort((a, b) => a[0] - b[0])
  let cursor = stretch.left
  for (const [left, right] of [...covered, [stretch.right, stretch.right] as [number, number]]) {
    if (left - cursor > 1e-9)
      for (const span of repeatSpans(bay, left - cursor, maxRepeat))
        spans.push({ left: span.left + cursor - stretch.left, width: span.width })
    cursor = Math.max(cursor, right)
  }
  return spans.sort((a, b) => a.left - b.left)
}

function repeatSpans(bay: FacadeBay, runWidth: number, maxRepeat: number): Span[] {
  const { endPier, pier } = bay
  const width = bayWidth(bay)
  const available = runWidth - endPier * 2
  const count = Math.floor((available + pier) / (width + pier))
  if (count < 1) return []
  if (count > maxRepeat)
    throw Error(
      `This run would need more than ${maxRepeat} repeats. Increase their width or spacing.`,
    )
  const total = count * width + (count - 1) * pier
  let step = width + pier
  let start = (runWidth - total) / 2
  if (bay.remainder === 'widen-piers' && count > 1) {
    step = (available - width) / (count - 1)
    start = endPier
  } else if (bay.remainder === 'align-to-anchor' && bay.horizontal !== 'center') {
    start = bay.horizontal === 'right' ? runWidth - endPier - total : endPier
  }
  return Array.from({ length: count }, (_, index) => ({ left: start + index * step, width }))
}

function resolveVertical(
  opening: FacadeBayOpening,
  runHeight: number,
): { bottom: number; height: number } | null {
  if (opening.heightMode === 'stretch') {
    const height = runHeight - opening.sill - opening.offsetY
    return height < FACADE_UNIT_MIN_OPENING ? null : { bottom: opening.sill, height }
  }
  const { height } = opening
  const bottom =
    opening.vertical === 'bottom'
      ? opening.sill + opening.offsetY
      : opening.vertical === 'top'
        ? runHeight - opening.sill - height - opening.offsetY
        : (runHeight - height) / 2 + opening.offsetY
  if (bottom < -1e-9 || bottom + height > runHeight + 1e-9) return null
  return { bottom, height }
}

function openingIn(
  span: Span,
  opening: FacadeBayOpening,
  vertical: { bottom: number; height: number },
  /** In a bay that hugs its content, the infill before the opening: children sit side by side. */
  lead?: number,
): FacadeOpeningPlacement | undefined {
  let left: number
  let width: number
  if (opening.widthMode === 'stretch') {
    width = span.width - opening.offsetX * 2
    if (width < FACADE_UNIT_MIN_OPENING) return undefined
    left = span.left + opening.offsetX
  } else {
    // An opening wider than its bay is a design error, not something to overflow.
    if (opening.width > span.width + 1e-9) return undefined
    width = opening.width
    left =
      lead === undefined ? span.left + (span.width - width) / 2 + opening.offsetX : span.left + lead
  }
  return {
    kind: opening.kind,
    style: openingStyle(opening),
    left,
    right: left + width,
    bottom: vertical.bottom,
    top: vertical.bottom + vertical.height,
    x: left + width / 2,
    y: vertical.bottom + vertical.height / 2,
  }
}

/** Balconies stay inside their stretch: past a corner a deck would pierce the next wall, past a pinned bay it would cover it. */
function balconyIn(
  span: Span,
  balcony: FacadeBayBalcony,
  bounds: { left: number; right: number },
): FacadeBalconyPlacement | undefined {
  const width = balcony.width ?? span.width
  const centre = span.left + span.width / 2 + balcony.offsetX
  const left = Math.max(bounds.left, centre - width / 2)
  const right = Math.min(bounds.right, centre + width / 2)
  if (right - left < MIN_BALCONY_WIDTH) return undefined
  return { left, right, ...balconyLook(balcony) }
}

const balconyLook = ({
  depth,
  railing,
  deckMaterial,
  railingMaterial,
  ornament,
}: FacadeBayBalcony) => ({ depth, railing, deckMaterial, railingMaterial, ornament })

export type FacadeCladdingPart =
  | 'infill'
  | 'infill-left'
  | 'infill-right'
  | 'spandrel-below'
  | 'spandrel-above'
  | 'surround-left'
  | 'surround-right'
  | 'surround-head'
  | 'surround-cap'
  | 'surround-keystone'
export type FacadeCladdingRect = FacadeUnitObstacle & {
  part: FacadeCladdingPart
  cladding: FacadeCladding
}

/** Thinner strips than this are slivers, not panels. */
const MIN_CLADDING = 0.02

/**
 * The panels one bay placement lays out, in run coordinates: infill beside the
 * opening floor to ceiling, and spandrels below and above it.
 */
export function bayCladdingRects(
  bay: Pick<FacadeBay, 'infill' | 'spandrel' | 'surround'>,
  placement: Pick<FacadeBayPlacement, 'left' | 'right' | 'opening'>,
  runHeight: number,
): FacadeCladdingRect[] {
  const rects: FacadeCladdingRect[] = []
  const add = (
    part: FacadeCladdingPart,
    cladding: FacadeCladding,
    left: number,
    right: number,
    bottom: number,
    top: number,
  ) => {
    const clipped = Math.min(top, runHeight)
    if (right - left >= MIN_CLADDING && clipped - bottom >= MIN_CLADDING)
      rects.push({ part, cladding, left, right, bottom, top: clipped })
  }
  const { opening } = placement
  // An opening shifted past its bay still leaves the bay's own edges intact.
  const openingLeft = opening
    ? Math.min(Math.max(opening.left, placement.left), placement.right)
    : 0
  const openingRight = opening
    ? Math.min(Math.max(opening.right, placement.left), placement.right)
    : 0
  const { infill, spandrel } = bay
  if (infill) {
    if (!opening) add('infill', infill, placement.left, placement.right, 0, runHeight)
    else {
      const reach = infill.width ?? Number.POSITIVE_INFINITY
      const [bottom, top] =
        infill.height === 'opening' ? [opening.bottom, opening.top] : [0, runHeight]
      if (infill.sides !== 'right')
        add(
          'infill-left',
          infill,
          Math.max(placement.left, openingLeft - reach),
          openingLeft,
          bottom,
          top,
        )
      if (infill.sides !== 'left')
        add(
          'infill-right',
          infill,
          openingRight,
          Math.min(placement.right, openingRight + reach),
          bottom,
          top,
        )
    }
  }
  if (spandrel && opening) {
    if (spandrel.parts !== 'above')
      add('spandrel-below', spandrel, openingLeft, openingRight, 0, opening.bottom)
    if (spandrel.parts !== 'below')
      add('spandrel-above', spandrel, openingLeft, openingRight, opening.top, runHeight)
  }
  const { surround } = bay
  if (surround && opening) {
    const w = surround.width
    add('surround-left', surround, openingLeft - w, openingLeft, opening.bottom, opening.top)
    add('surround-right', surround, openingRight, openingRight + w, opening.bottom, opening.top)
    if (opening.style.shape === 'arch') {
      // A flat head would cut through the arch: a keystone marks its crown instead.
      const key = Math.min(w * 1.4, (openingRight - openingLeft) / 3)
      const centre = (openingLeft + openingRight) / 2
      add(
        'surround-keystone',
        surround,
        centre - key / 2,
        centre + key / 2,
        opening.top - w * 0.9,
        opening.top + w / 2,
      )
    } else {
      add(
        'surround-head',
        surround,
        openingLeft - w,
        openingRight + w,
        opening.top,
        opening.top + w,
      )
      if (surround.head === 'cornice')
        add(
          'surround-cap',
          { ...surround, thickness: surround.thickness * 1.8 },
          openingLeft - w * 1.6,
          openingRight + w * 1.6,
          opening.top + w,
          opening.top + w * 1.6,
        )
    }
  }
  return rects
}

/** The run minus the spans pinned bays took, in order. */
function freeStretches(
  runWidth: number,
  taken: readonly { left: number; right: number }[],
): { left: number; right: number }[] {
  const stretches: { left: number; right: number }[] = []
  let cursor = 0
  for (const span of [...taken].sort((a, b) => a.left - b.left)) {
    if (span.left > cursor) stretches.push({ left: cursor, right: Math.min(span.left, runWidth) })
    cursor = Math.max(cursor, span.right)
  }
  if (runWidth > cursor) stretches.push({ left: cursor, right: runWidth })
  return stretches.filter((stretch) => stretch.right - stretch.left > 1e-6)
}

/** An opening moved along the run. */
function shiftOpening(opening: FacadeOpeningPlacement, by: number): FacadeOpeningPlacement {
  return { ...opening, left: opening.left + by, right: opening.right + by, x: opening.x + by }
}

/**
 * The smallest step along the run that takes an opening clear of what it meets
 * while keeping it inside its bay, or null when no such step exists.
 */
function clearStep(
  opening: FacadeOpeningPlacement,
  span: Span,
  around: readonly FacadeUnitObstacle[],
  clearance: number,
  blocked: (rect: FacadeUnitObstacle) => boolean,
): number | null {
  const margin = 1e-7
  const steps = around
    .filter((o) => opening.bottom < o.top + clearance && opening.top > o.bottom - clearance)
    .flatMap((o) => [
      o.left - clearance - opening.right - margin,
      o.right + clearance - opening.left + margin,
    ])
    .sort((a, b) => Math.abs(a) - Math.abs(b))
  for (const step of steps) {
    const moved = shiftOpening(opening, step)
    if (moved.left < span.left - margin || moved.right > span.left + span.width + margin) continue
    if (!blocked(moved)) return step
  }
  return null
}

function overlaps(
  rect: FacadeUnitObstacle,
  obstacles: readonly FacadeUnitObstacle[],
  clearance: number,
): boolean {
  return obstacles.some(
    (obstacle) =>
      rect.left < obstacle.right + clearance &&
      rect.right > obstacle.left - clearance &&
      rect.bottom < obstacle.top + clearance &&
      rect.top > obstacle.bottom - clearance,
  )
}

/** An opening already on the facade, in run coordinates, that dress mode keeps. */
export type FacadeDressOpening = FacadeUnitObstacle & { id: string; kind: FacadeBayOpening['kind'] }
export type FacadeDressPlacement = FacadeBayPlacement & {
  openingId: string
  opening: FacadeOpeningPlacement
}
export type FacadeDressResolution = { placements: FacadeDressPlacement[]; skipped: number }

/** The bay of the opening's kind whose opening is closest in size; earlier bays win ties. */
function dressBay(unit: FacadeUnit, opening: FacadeDressOpening): FacadeBay | undefined {
  let best: FacadeBay | undefined
  let score = Number.POSITIVE_INFINITY
  for (const bay of unit.bays) {
    const own = bay.opening
    if (!own || own.kind !== opening.kind) continue
    const width =
      own.widthMode === 'fixed' ? Math.abs(own.width - (opening.right - opening.left)) : 0
    const height =
      own.heightMode === 'fixed' ? Math.abs(own.height - (opening.top - opening.bottom)) : 0
    if (width + height < score - 1e-9) {
      best = bay
      score = width + height
    }
  }
  return best
}

/**
 * Dress openings that are already there — from the plans, the interior or by
 * hand — with a unit, keeping each exactly where it is and as big as it is. Each
 * opening takes the bay of its kind and closest size; the bay is centred on it,
 * grows to hold an opening wider than itself, and yields half the overlap to a
 * neighbour. Its infill, spandrels and balcony are laid out around the opening
 * as in place mode. Pure and deterministic, like `resolveFacadeUnit`.
 */
export function dressFacadeUnit(
  unit: FacadeUnit,
  run: FacadeUnitRun,
  openings: readonly FacadeDressOpening[],
  options: Pick<FacadeUnitResolutionOptions, 'clearance' | 'variation'> = {},
): FacadeDressResolution {
  if (
    !Number.isFinite(run.width) ||
    !Number.isFinite(run.height) ||
    run.width <= 0 ||
    run.height <= 0
  )
    throw Error('Use a positive run width and height.')
  const clearance = options.clearance ?? FACADE_UNIT_CLEARANCE
  const matched = openings
    .filter((opening) => {
      const centre = (opening.left + opening.right) / 2
      return centre >= 0 && centre <= run.width
    })
    .sort((a, b) => a.left - b.left)
    .flatMap((opening) => {
      const base = dressBay(unit, opening)
      if (!base) return []
      const variant = facadeBayVariantAt(
        unit,
        base,
        (opening.left + opening.right) / 2,
        options.variation,
      )
      return [{ opening, bay: bayVariant(base, variant), variant }]
    })
  const spans = matched.map(({ opening, bay }) => {
    const sides = hugSides(bay)
    if (sides) return { left: opening.left - sides.left, right: opening.right + sides.right }
    const width = Math.max(bayWidth(bay), opening.right - opening.left)
    const shift = bay.opening!.widthMode === 'fixed' ? bay.opening!.offsetX : 0
    const centre = (opening.left + opening.right) / 2 - shift
    return { left: centre - width / 2, right: centre + width / 2 }
  })
  // Stay in the run, never cut into the opening, and split an overlap halfway between neighbours.
  spans.forEach((span, i) => {
    const { opening } = matched[i]!
    span.left = Math.min(Math.max(span.left, 0), opening.left)
    span.right = Math.max(Math.min(span.right, run.width), opening.right)
  })
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i]!
    const b = spans[i + 1]!
    if (a.right <= b.left) continue
    const boundary = (matched[i]!.opening.right + matched[i + 1]!.opening.left) / 2
    a.right = Math.max(Math.min(a.right, boundary), matched[i]!.opening.right)
    b.left = Math.min(Math.max(b.left, boundary), matched[i + 1]!.opening.left)
  }

  let skipped = 0
  const balconies: { left: number; right: number }[] = []
  const collides = (balcony: { left: number; right: number }) =>
    balconies.some((b) => balcony.left < b.right + clearance && balcony.right > b.left - clearance)
  const placements: FacadeDressPlacement[] = matched.map(({ opening, bay, variant }, i) => {
    const own = bay.opening!
    const span = spans[i]!
    return {
      key: `${bay.key}@${opening.id}`,
      bay: bay.key,
      ...(variant === undefined ? {} : { variant }),
      left: span.left,
      right: span.right,
      openingId: opening.id,
      opening: {
        kind: opening.kind,
        style: openingStyle(own),
        left: opening.left,
        right: opening.right,
        bottom: opening.bottom,
        top: opening.top,
        x: (opening.left + opening.right) / 2,
        y: (opening.bottom + opening.top) / 2,
      },
    }
  })
  // Continuous balconies join neighbouring dressed openings whose bays want one, as in place mode.
  let group: number[] = []
  const layGroup = () => {
    const first = group[0]
    const look = first !== undefined ? matched[first]!.bay.balcony : undefined
    if (first !== undefined && look) {
      const balcony = {
        left: placements[first]!.left,
        right: placements[group.at(-1)!]!.right,
        ...balconyLook(look),
      }
      if (balcony.right - balcony.left < MIN_BALCONY_WIDTH || collides(balcony)) skipped++
      else {
        placements[first]!.balcony = balcony
        balconies.push(balcony)
      }
    }
    group = []
  }
  matched.forEach(({ bay }, i) => {
    if (bay.balcony?.span === 'continuous') {
      group.push(i)
      return
    }
    layGroup()
    if (!bay.balcony) return
    const placement = placements[i]!
    const balcony = balconyIn(
      { left: placement.left, width: placement.right - placement.left },
      bay.balcony,
      { left: 0, right: run.width },
    )
    if (!balcony) return
    if (collides(balcony)) {
      skipped++
      return
    }
    placement.balcony = balcony
    balconies.push(balcony)
  })
  layGroup()
  return { placements, skipped }
}
