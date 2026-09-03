/**
 * FIXTURE / APPLIANCE SCHEDULE — STUB. Rows from the placed `item` nodes of a
 * level (kitchen, bathroom and appliance categories) with the plumbing key
 * (H hot, C cold, W waste, T thermostatic valve) and electric/gas service.
 *
 * OWNER: notes/schedules workstream. Returns an empty table until it lands.
 */
import type { NodeMap } from './model'
import type { ScheduleTable } from './schedule'

export function buildFixtureSchedule(_nodes: NodeMap, _levelId: string): ScheduleTable {
  return {
    title: 'Fixture schedule',
    columns: [
      { key: 'mark', label: 'LABEL', weight: 0.7 },
      { key: 'description', label: 'DESCRIPTION', weight: 1.6 },
      { key: 'qty', label: 'QTY', weight: 0.5 },
      { key: 'info', label: 'INFO', weight: 1.6 },
      { key: 'status', label: 'STATUS', weight: 0.7 },
    ],
    rows: [],
    issues: [],
  }
}
