import { ADJUSTABLE_COLUMN_CLAMPS, COLUMN_FORMS } from './columns'
import { FALSEWORK_BEAMS, PROP_TYPES, SHEATHING_TYPES } from './falsework'
import { SHEET_STOCK } from './sheets'
import { FORMWORK_SYSTEMS } from './systems'

/**
 * Every catalog part a yard could own, in one list.
 *
 * The list exists because ownership is recorded by catalog id, and both the settings
 * panel and the chat tool have to know which ids are real. Composed here rather than in
 * each of them: two hand-built lists would agree on the day they were written and drift
 * the first time a system is added to the catalog, and the way that failure shows up is
 * a project recording stock against an id no bill line can ever match — accepted,
 * stored, and silently changing no quantity at all.
 *
 * One flat list rather than a list per kind. What a stock editor needs is "does this id
 * name a real product", and grouping is presentation: the labels carry the family, and
 * a yard that owns two systems' panels does not think of them as two racks.
 */

/** A catalog part, as a stock editor needs to show it. */
export interface StockableCatalogPart {
  id: string
  label: string
  /** The manufacturer's system, for grouping a long list — "Framax Xlife", "Falsework". */
  family: string
  weightKg: number
}

/**
 * Everything with an id a bill line can carry, sorted by family then label.
 *
 * Sheathing and sheet stock are in it even though a cut piece of either is `consumed`
 * rather than returnable, because a yard buys and holds full sheets: what it owns is
 * stock, and what a pour makes of it is scrap. The bill's own `bespoke` provenance is
 * what keeps the cut piece off the rack, not this list.
 */
export const STOCKABLE_CATALOG_PARTS: readonly StockableCatalogPart[] = [
  // Seeded systems only: an unseeded registration carries no panels, corners,
  // fillers or ties, so there is nothing of it a bill line could carry and nothing
  // a yard could own.
  ...Object.values(FORMWORK_SYSTEMS)
    .filter((system) => system.seeded)
    .flatMap((system) =>
      [...system.panels, ...system.corners, ...system.fillers, ...system.ties].map((entry) => ({
        id: entry.id,
        label: entry.label,
        family: system.label,
        weightKg: entry.weightKg,
      })),
    ),
  ...COLUMN_FORMS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    family: 'Column forms',
    weightKg: entry.weightKg,
  })),
  ...ADJUSTABLE_COLUMN_CLAMPS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    family: 'Column clamps',
    weightKg: entry.weightKg,
  })),
  ...[...SHEATHING_TYPES, ...FALSEWORK_BEAMS, ...PROP_TYPES, ...SHEET_STOCK].map((entry) => ({
    id: entry.id,
    label: entry.label,
    family: 'Falsework and sheathing',
    weightKg: entry.weightKg,
  })),
].sort((a, b) => a.family.localeCompare(b.family) || a.label.localeCompare(b.label))

/** Whether an id names a real catalog part, so stock against it can reach a bill line. */
export function isStockableCatalogId(id: string): boolean {
  return STOCKABLE_CATALOG_PARTS.some((part) => part.id === id)
}
