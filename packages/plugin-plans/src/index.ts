/**
 * @pascal-app/plugin-plans — Plans inside Pascal.
 *
 * Ctrl+K → "Generate plans": the open scene goes to the Plans API
 * (site + parcel → code checks → the full construction set) and the set
 * opens in the editor, in the editor's own theme. A sidebar panel offers
 * the same button and the last run's summary.
 *
 * The plugin declares no node kinds; it is a command + a surface.
 */
import type { Plugin } from '@pascal-app/core'
import { type CommandAction, type EditorHostPanel, useCommandRegistry } from '@pascal-app/editor'
import { mountPlansOverlay } from './overlay'
import { generatePlans } from './run'
import { usePlans } from './store'

const PLANS_ICON = {
  kind: 'url',
  // a rolled drawing — 64px, inline so the package needs no asset pipeline
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="10" y="12" width="44" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M10 22h44M22 22v30M34 30h14M34 38h14M16 44h4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    ),
} as const

export const plansPlugin = {
  id: 'pascal:plans',
  apiVersion: 1,
  nodes: [],
} satisfies Plugin

export const plansHostPanel = {
  id: 'pascal:plans:panel',
  label: 'Plans',
  icon: PLANS_ICON,
  component: () => import('./panel'),
  pluginId: plansPlugin.id,
  description: 'Generate a permit-ready construction set from the open scene and read it here.',
  creator: { name: 'PlanCrafters', url: 'https://plancrafters.com' },
  pluginUrl: 'https://plancrafters.com',
  defaultInstalled: true,
} satisfies EditorHostPanel

let commandsRegistered = false

/** Register the Ctrl+K commands + mount the overlay root. Idempotent (HMR-safe). */
export function registerPlansCommands(): void {
  if (commandsRegistered || typeof window === 'undefined') return
  commandsRegistered = true
  mountPlansOverlay()
  const actions: CommandAction[] = [
    {
      id: 'plans.generate',
      label: 'Generate plans',
      group: 'Plans',
      keywords: ['sheets', 'construction set', 'permit', 'drawings', 'plan set', 'plancrafters'],
      execute: () => {
        void generatePlans()
      },
    },
    {
      id: 'plans.open',
      label: 'Open plan set',
      group: 'Plans',
      keywords: ['sheets', 'drawings', 'viewer'],
      when: () => usePlans.getState().sheets.length > 0,
      execute: () => usePlans.getState().setOpen(true),
    },
  ]
  useCommandRegistry.getState().register(actions)
}

export { usePlans } from './store'
export { generatePlans } from './run'
