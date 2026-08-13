'use client'

import { LocalizedContent } from '../../../../lib/i18n'
import { SunStudySection } from '../../panels/sun-study/sun-study-section'

/**
 * Sun study as its own sidebar panel.
 *
 * The controls used to sit inside the Scene panel above the building tree,
 * which buried a whole analysis under a navigation surface.
 *
 * No panel-level heading: the section already carries an icon, its name and
 * its on/off control in one row, and adding an `<h2>` above it would just say
 * "Sun study" twice.
 */
export function SunStudyPanel() {
  return (
    <LocalizedContent>
      <div className="flex h-full flex-col overflow-y-auto">
        <SunStudySection />
        <p className="px-3 py-3 text-[11px] text-sidebar-foreground/50">
          Latitude, longitude and north are saved with the project; the date and time are not —
          they describe the study, not the model.
        </p>
      </div>
    </LocalizedContent>
  )
}
