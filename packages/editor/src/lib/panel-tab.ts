import { categoryOf } from '@pascal-app/core'

export type ElementPanelTab = 'structure' | 'furnish'

/**
 * Which of the site panel's Structure / Furnish tabs a level child belongs to.
 * Zones have their own tab and are filtered out before this runs. Furnish is
 * `categoryOf(kind) === 'furnish'` — the host item / cabinet / shelf and every
 * warehouse plugin kind; everything else that is not furnish falls to Structure.
 * The two tabs are complementary, so a kind is never listed under both (the bug
 * this fixes: plugin objects appeared under Structure *and* Furnish).
 */
export function elementBelongsToPanelTab(kind: string, tab: ElementPanelTab): boolean {
  const isFurnish = categoryOf(kind) === 'furnish'
  return tab === 'furnish' ? isFurnish : !isFurnish
}
