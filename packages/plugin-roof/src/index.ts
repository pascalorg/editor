/**
 * @pascal-app/plugin-roof — the auto roof.
 *
 * The roof is derived from the exterior walls, PlanCrafters' way: the wall
 * loop becomes masses, each mass a segment seated on the plate, gable or hip
 * by the style's vocabulary and the massing, a shed rising away from the
 * street, a coverage gate that never leaves a house roofless. Generate calls
 * the same engine; the rail panel rebuilds the roof on any level.
 *
 * The plugin declares no node kinds; it is an engine + commands + a panel.
 */
import type { Plugin } from '@pascal-app/core'
import { type CommandAction, type EditorHostPanel, useCommandRegistry } from '@pascal-app/editor'
import { rebuildAutoRoof } from './run'
import { useAutoRoof } from './store'
import { styleRoofForm } from './styles'

const ROOF_ICON = {
  kind: 'url',
  // a gable over a wall line — inline so the package needs no asset pipeline
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M6 34 32 12l26 22" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M14 30v22M50 30v22M8 52h48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M32 12v22" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/></svg>`,
    ),
} as const

export const roofPlugin = {
  id: 'pascal:roof',
  apiVersion: 1,
  nodes: [],
} satisfies Plugin

export const roofHostPanel = {
  id: 'pascal:roof:panel',
  label: 'Auto roof',
  icon: ROOF_ICON,
  component: () => import('./panel'),
  pluginId: roofPlugin.id,
  description: 'Derive the roof from the walls: masses, gable or hip by style and massing, sheds rising away from the street — seated on the plate with every wall told what it carries.',
  creator: { name: 'Pascal', url: 'https://pascal.app' },
  defaultInstalled: true,
} satisfies EditorHostPanel

let commandsRegistered = false

/** Register the Ctrl+K command. Idempotent (HMR-safe). */
export function registerRoofCommands(): void {
  if (commandsRegistered || typeof window === 'undefined') return
  commandsRegistered = true
  const actions: CommandAction[] = [
    {
      id: 'roof.auto',
      label: 'Auto roof: rebuild from the walls',
      group: 'Roof',
      keywords: ['roof', 'auto', 'gable', 'hip', 'shed', 'derive', 'plancrafters'],
      execute: () => {
        rebuildAutoRoof(useAutoRoof.getState().options, styleRoofForm)
      },
    },
  ]
  useCommandRegistry.getState().register(actions)
}

export { type AutoRoofResult, type AutoRoofSegment, deriveRoof, type RoofForm, type RoofIntent, type WallRoofRole } from './derive'
export { type Pt, type WallInput } from './geometry'
export { AUTO_ROOF, frontDirOfLevel, plateOfLevel, rebuildAutoRoof, roofNodesFor, wallsOfLevel } from './run'
export { useAutoRoof } from './store'
export { STYLE_ROOF_FORMS, styleRoofForm } from './styles'
