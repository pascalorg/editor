/**
 * @pascal-app/plugin-sheets — paper space, native to Pascal.
 *
 * Three node kinds (`sheets:project-record`, `sheets:sheet`,
 * `sheets:viewport`) plus a full-screen workspace that draws them. Every
 * viewport is rendered by Pascal's own SVG renderer from Pascal's own nodes;
 * there is no engine, no HTTP, and nothing imported.
 *
 * Ctrl+K → "Open sheets", or the Sheets panel in the rail.
 */
import type { Plugin } from '@pascal-app/core'
import {
  type CommandAction,
  type EditorHostPanel,
  useCommandRegistry,
} from '@pascal-app/editor'
import { sheetsNodeDefinitions } from './definitions'
import { generateDefaultSet } from './generate'
import { sceneNodes } from './model'
import { mountSheetsWorkspace, openSheets } from './overlay'
import { printSet } from './print'

const SHEETS_ICON = {
  kind: 'url',
  // a sheet of paper with a title block — inline so the package needs no
  // asset pipeline
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="14" width="48" height="36" rx="3" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M40 14v36M40 26h16M40 36h16M14 22h20M14 30h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    ),
} as const

export const sheetsPlugin = {
  id: 'pascal:sheets',
  apiVersion: 1,
  nodes: sheetsNodeDefinitions as never,
} satisfies Plugin

export const sheetsHostPanel = {
  id: 'pascal:sheets:panel',
  label: 'Sheets',
  icon: SHEETS_ICON,
  component: () => import('./panel'),
  pluginId: sheetsPlugin.id,
  description:
    'Paper space: live viewports drawn by Pascal, a title block from the project record, and one vector PDF for the whole set.',
  defaultInstalled: true,
} satisfies EditorHostPanel

let registered = false

/** Register the Ctrl+K commands + mount the workspace root. Idempotent. */
export function registerSheetsCommands(): void {
  if (registered || typeof window === 'undefined') return
  registered = true
  mountSheetsWorkspace()
  const actions: CommandAction[] = [
    {
      id: 'sheets.open',
      label: 'Open sheets',
      group: 'Sheets',
      keywords: ['paper', 'title block', 'construction set', 'drawings', 'plot', 'viewport'],
      execute: () => openSheets(),
    },
    {
      id: 'sheets.generate',
      label: 'Generate default sheet set',
      group: 'Sheets',
      keywords: ['cover', 'floor plan', 'elevations', 'schedules', 'permit'],
      execute: () => {
        generateDefaultSet(sceneNodes())
        openSheets()
      },
    },
    {
      id: 'sheets.print',
      label: 'Print sheets to PDF',
      group: 'Sheets',
      keywords: ['pdf', 'plot', 'export', 'construction set'],
      execute: () => {
        void printSet()
      },
    },
  ]
  useCommandRegistry.getState().register(actions)
}

export { sheetsNodeDefinitions } from './definitions'
export {
  NO_SECTION_MARKER_NOTE,
  registerSheetDrawingProvider,
  sectionMarkers,
  splitProvidedGeometry,
  type DrawingProvider,
  type DrawingResult,
} from './drawings'
export { generateDefaultSet, missingSheets, planDefaultSet, type Plan } from './generate'
export { composeAll, composeSheet, type ComposedSheet } from './page'
export { closeSheets, openSheets, shouldCloseOnEscape } from './overlay'
export { printSet } from './print'
export { coverFrontPose, findFrontDoor } from './pose'
export { buildSchedule, resolveMarks } from './schedule'
export * from './scale'
export * from './schema'
export { useSheets } from './store'
