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

/** Only a named, flat floor covering is nonblocking, never an arbitrary short solid or low top surface. */
export function isFloorUnderlay(item: ItemNode): boolean {
  const text = read(item.asset)
  if (
    !/(?:^|[^a-z])(?:rug|carpet|(?:floor|parking)[ -]?mat)(?![a-z])/.test(text) ||
    WALL.test(text) ||
    CHAIR.test(text) ||
    /table|desk|ottoman|pouf/.test(text) ||
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
