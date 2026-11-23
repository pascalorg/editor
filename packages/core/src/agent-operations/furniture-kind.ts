import { foldRoomName } from '../building/room-use'
import { getScaledDimensions, type ItemNode, LOW_PROFILE_ITEM_SURFACE_MAX_HEIGHT } from '../schema'

/** How a piece of furniture stands in a room, read from what the catalog calls it. */
export type FurnitureKind = 'chair' | 'free' | 'wall'

type Named = { id: string; name?: string | undefined }

const read = (asset: Named) => `${asset.id} ${asset.name ?? ''}`.toLowerCase().replace(/[_]+/g, ' ')

/** An armchair is a free-standing seat of the living group, not a chair of a table. */
const ARMCHAIR = /arm ?chair|living ?room|lounge|rocking|recliner/
const CHAIR = /(?:^|[^a-z])(?:chair|stool)(?![a-z])/
/** A bedside table stands against the wall like the bed it serves, whatever the word "table" says. */
const BEDSIDE = /bedside|night ?stand/
/** A bar, island or peninsula is walked around, and utensils sit on other pieces: none stands against a wall. */
const WALKED_AROUND = /(?:^|[^a-z])(?:island|peninsula|bar)(?![a-z])|utensil/
const FREE = /table|rug|carpet|plant|lamp|ottoman|pouf/
const WALL =
  /fridge|refrigerator|counter|kitchen|stove|oven|cooktop|sink|tv[ -]?(?:stand|unit)|television|dresser|wardrobe|closet|sofa|couch|loveseat|(?:^|[^a-z])bed(?![a-z])|toilet|bath|shower|bookcase|bookshelf|cabinet|washing|washer|dryer|coat/

/** What the catalogue (or the agent) filed a floor covering under, English or French, folded. */
const RUG_CATEGORY = /^(?:rugs?|carpets?|tapis|(?:floor|parking)[ -]?mats?)$/
/** The words that name one when the category says nothing: the asset's id and name, folded. */
const RUG_WORD = /(?:^|[^a-z])(?:rugs?|carpets?|tapis|(?:floor|parking)[ -]?mats?)(?![a-z])/

/** What the catalogue (or the agent) filed a vehicle under, English or French, folded. */
const VEHICLE_CATEGORY = /^(?:vehicles?|cars?|automobiles?|voitures?)$/
/** The words that name one when the category says nothing: the asset's id and name, folded. */
const VEHICLE_WORD =
  /(?:^|[^a-z])(?:cars?|hatchbacks?|sedans?|suvs?|utes?|vehicles?|voitures?)(?![a-z])/

/**
 * A car, a ute: filed as a vehicle, or named as one when nothing is filed. What stands in a garage
 * to be driven out of it, so the garage door's opening is its way and not a thing it obstructs.
 */
export function isVehicle(item: ItemNode): boolean {
  const category = foldRoomName(item.asset.category ?? '')
  if (category) return VEHICLE_CATEGORY.test(category)
  return VEHICLE_WORD.test(foldRoomName(read(item.asset)))
}

/**
 * Only a flat floor covering is nonblocking, never an arbitrary short solid or low top surface. It is
 * a rug by what it is filed under (its category: "rug", "rugs", "tapis"), else by what it is called
 * in English or French, and in both cases it must lie flat on the floor.
 */
export function isFloorUnderlay(item: ItemNode): boolean {
  const category = foldRoomName(item.asset.category ?? '')
  const filedAsRug = RUG_CATEGORY.test(category)
  const text = foldRoomName(read(item.asset))
  if (
    !(filedAsRug || RUG_WORD.test(text)) ||
    (!filedAsRug &&
      (WALL.test(text) || CHAIR.test(text) || /table|desk|ottoman|pouf/.test(text))) ||
    item.asset.attachTo
  )
    return false
  const dims = getScaledDimensions(item)
  if (
    ![...item.position, ...item.rotation, ...item.scale, ...dims].every(Number.isFinite) ||
    !item.scale.every((value) => value > 0) ||
    dims[0] <= 0 ||
    dims[2] <= 0 ||
    Math.abs(item.position[1]) > 1e-6 ||
    Math.abs(item.rotation[0]) > 1e-6 ||
    Math.abs(item.rotation[2]) > 1e-6
  )
    return false
  const bounds = item.source?.manifest.bounds
  const bottom = bounds ? bounds.min[1] * item.scale[1] : 0
  const top = bounds ? bounds.max[1] * item.scale[1] : dims[1]
  return (
    Number.isFinite(bottom) &&
    Number.isFinite(top) &&
    bottom >= -1e-6 &&
    top >= bottom &&
    top <= LOW_PROFILE_ITEM_SURFACE_MAX_HEIGHT
  )
}

/** What the catalogue (or the agent) files wall panelling and trim under, English or French, folded. */
const WALL_DRESSING_CATEGORY =
  /^(?:trim|paneling|panelling|wainscot(?:ing)?|boiseries?|(?:wall ?)?panels?|moulding|molding)$/

/**
 * Wall panelling and trim are the wall's own surface: an item filed under them is read by its strips
 * (its box is the room's) in a collision and in a door's clearance. A piece beside it keeps the gap
 * it keeps from anything else.
 */
export function isWallDressing(item: ItemNode): boolean {
  return WALL_DRESSING_CATEGORY.test(foldRoomName(item.asset.category ?? ''))
}

/** The pieces that are designed to stand together, a few centimetres apart (see `designedTogether`). */
type PairRole = 'bed' | 'bedside' | 'seat' | 'worktop' | 'sofa' | 'sidetable'

/** What each role is filed under, folded, with hyphens as spaces: the category says it first. */
const ROLE_CATEGORY: Record<PairRole, RegExp> = {
  bedside: /^(?:night ?stands?|bedside(?: tables?)?|night tables?|chevets?)$/,
  bed: /^(?:(?:double|single|twin|king|queen|bunk|kids?) )?(?:beds?|lits?)$/,
  seat: /^(?:(?:dining|desk|office|kitchen|bar|counter|outdoor|garden|terrace|work|accent) )?(?:chairs?|stools?)$|^(?:chaises?|tabourets?)$/,
  worktop:
    /^(?:desks?|bureaux?|(?:dining|kitchen|outdoor|garden|terrace|work|writing|office|meeting|conference|picnic) tables?)$/,
  sofa: /^(?:(?:corner|sectional|leather|fabric) )?(?:sofas?|couch(?:es)?|loveseats?|canapes?)$/,
  sidetable: /^(?:(?:side|end|accent|occasional|lamp) tables?|side|gueridons?)$/,
}

/** A category that says nothing about what the piece is (or only "table"): its id and name decide. */
const GENERIC_CATEGORY =
  /^(?:furniture|furnishings?|other|misc\w*|custom|objects?|items?|home|interior|seating|tables?)?$/

/** The words that name each role, English or French, folded: only for a piece whose category does not. */
const ROLE_WORDS: Record<PairRole, RegExp> = {
  bedside: /chevets?|bedside|night ?stands?|night tables?/,
  bed: /(?:^|[^a-z])(?:beds?|lits?)(?![a-z])/,
  seat: /(?:^|[^a-z])(?:chairs?|stools?|chaises?|tabourets?)(?![a-z])/,
  worktop: /(?:^|[^a-z])(?:tables?|desks?|bureaux?)(?![a-z])/,
  sofa: /(?:^|[^a-z])(?:sofas?|couch(?:es)?|canapes?|loveseats?)(?![a-z])/,
  sidetable: /gueridons?|(?:side|end) tables?|bout de canape|d'appoint/,
}
/** "Bout de lit" is a bench, "coffee table" and "console" are not tables to sit at. */
const ROLE_NOT: Partial<Record<PairRole, RegExp>> = {
  bed: /(?:\bde|\bdu|\bof|\bfor|\bd') (?:beds?|lits?)\b/,
  worktop: /basse|coffee|chevet|bedside|night|console|gueridon|appoint|side table|end table/,
}
const PAIR_ROLES: PairRole[] = ['bedside', 'bed', 'seat', 'sidetable', 'sofa', 'worktop']

function pairRole(item: ItemNode): PairRole | null {
  const category = foldRoomName(item.asset.category ?? '').replace(/[-_]+/g, ' ')
  const filed = PAIR_ROLES.find((role) => ROLE_CATEGORY[role].test(category))
  if (filed) return filed
  if (!GENERIC_CATEGORY.test(category)) return null
  const text = foldRoomName(read(item.asset))
  if (ARMCHAIR.test(text)) return null
  return (
    PAIR_ROLES.find((role) => ROLE_WORDS[role].test(text) && !ROLE_NOT[role]?.test(text)) ?? null
  )
}

const DESIGNED_PAIRS: readonly [PairRole, PairRole][] = [
  ['bed', 'bedside'],
  ['seat', 'worktop'],
  ['sofa', 'sidetable'],
]

/**
 * Whether two items are designed to stand together, a few centimetres apart: a nightstand beside a
 * bed, a chair or stool at a desk or table, a sofa beside a side table. Such a pair being close is
 * the design, not a finding; two of them overlapping is still one. Read from what each is filed
 * under (its category), by its words only where the category says nothing.
 */
export function designedTogether(a: ItemNode, b: ItemNode): boolean {
  const roles = [pairRole(a), pairRole(b)]
  return DESIGNED_PAIRS.some(
    ([first, second]) =>
      (roles[0] === first && roles[1] === second) || (roles[0] === second && roles[1] === first),
  )
}

/**
 * Wall-bound pieces (a fridge, a counter, a bed, a sofa) stand against a wall and never in the
 * middle of a room; free-standing ones (a dining table, a rug, a plant) may take the middle; a chair
 * is placed around its table. A name the table does not know is free-standing.
 */
export function furnitureKind(asset: Named): FurnitureKind {
  const text = read(asset)
  if (ARMCHAIR.test(text)) return 'free'
  if (CHAIR.test(text)) return 'chair'
  if (BEDSIDE.test(text)) return 'wall'
  if (WALKED_AROUND.test(text)) return 'free'
  if (FREE.test(text)) return 'free'
  return WALL.test(text) ? 'wall' : 'free'
}

/** A sofa stands off the wall on its rug and stools stand at an island: in an open plan neither is in the middle of the room. */
const FLOATS_IN_OPEN_PLAN = /sofa|couch|loveseat|stool/

/**
 * The word that makes a piece wall-bound ("fridge", "counter"), for a piece that is judged to stand
 * against a wall; null for every other piece, a sofa or stools that float by design included.
 */
export function wallBoundWord(asset: Named): string | null {
  const text = read(asset)
  if (furnitureKind(asset) !== 'wall' || FLOATS_IN_OPEN_PLAN.test(text)) return null
  return WALL.exec(text)?.[0].trim() ?? BEDSIDE.exec(text)?.[0] ?? 'piece'
}

/**
 * What a piece faces when it does not stand against a wall, as a pattern for the name of the item
 * it belongs with: the coffee table and the TV face the sofa, a chair faces its table.
 */
export function anchorOf(asset: Named): string | null {
  const text = read(asset)
  if (ARMCHAIR.test(text) || /coffee[ -]?table|tv[ -]?(?:stand|unit)/.test(text))
    return 'sofa|couch'
  if (CHAIR.test(text)) return 'table|desk'
  return null
}
