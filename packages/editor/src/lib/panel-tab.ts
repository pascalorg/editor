import { categoryOf, isPluginContributedKind } from '@pascal-app/core'

export type ElementPanelTab = 'structure' | 'furnish' | 'assets'

/**
 * Which of the site panel's Structure / Furnish / Assets tabs a level child
 * belongs to. Zones have their own tab and are filtered out before this runs.
 *
 * The three are complementary — a kind is listed under exactly one — which is
 * the property the earlier two-tab version existed to establish (plugin objects
 * used to appear under Structure *and* Furnish). Assets is checked first
 * because a plugin kind is also `categoryOf === 'furnish'`, and it is the more
 * specific answer: a pallet rack is warehouse equipment before it is furniture,
 * and mixing a hall of racking into the same list as the host's chairs and
 * shelves buries both.
 */
export function elementBelongsToPanelTab(kind: string, tab: ElementPanelTab): boolean {
  if (isPluginContributedKind(kind)) return tab === 'assets'
  if (tab === 'assets') return false
  const isFurnish = categoryOf(kind) === 'furnish'
  return tab === 'furnish' ? isFurnish : !isFurnish
}
