'use client'

import { LocalizedContent } from '../../../../lib/i18n'
import { QuantitiesSection } from '../../panels/quantities/quantities-section'

/**
 * Quantity takeoff as its own sidebar panel.
 *
 * A takeoff runs long — one section per kind, several lines each — so it wants
 * the full panel height rather than a slot above the building tree.
 *
 * No panel-level heading, for the same reason as the sun study: the section's
 * own header row already names it and holds the CSV action.
 */
export function QuantitiesPanel() {
  return (
    <LocalizedContent>
      <div className="flex h-full flex-col overflow-y-auto">
        <QuantitiesSection />
        <p className="px-3 py-3 text-[11px] text-sidebar-foreground/50">
          Totals cover the active level and exclude hidden nodes. Wall face area is gross, before
          openings.
        </p>
      </div>
    </LocalizedContent>
  )
}
