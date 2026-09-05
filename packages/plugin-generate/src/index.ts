/**
 * @pascal-app/plugin-generate — complete houses from a seed or a template.
 *
 * Ctrl+K → "Generate house" rolls an L1/L2 plan document (rooms, adjacency,
 * front door, roof and style intent) from the panel's seed and options and
 * builds it into the open scene: walls with assemblies, seated doors, egress
 * windows, zones, slab, roof — placed on the parcel square to the street at
 * the front setback. Templates (Poppy…) are the same documents authored by
 * hand. The builder is pure and headless; see build.ts.
 *
 * The plugin declares no node kinds; it is commands + a rail panel.
 */
import type { Plugin } from '@pascal-app/core'
import { type CommandAction, type EditorHostPanel, useCommandRegistry } from '@pascal-app/editor'
import { generateHouse, generateTemplate } from './run'
import { useGenerate } from './store'
import { TEMPLATES } from './templates/poppy'

const GENERATE_ICON = {
  kind: 'url',
  // a house with a die — 64px, inline so the package needs no asset pipeline
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 30 32 10l24 20" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M14 27v25h36V27" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><rect x="24" y="32" width="16" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="37" r="1.8" fill="currentColor"/><circle cx="35" cy="43" r="1.8" fill="currentColor"/><circle cx="35" cy="37" r="1.8" fill="currentColor"/><circle cx="29" cy="43" r="1.8" fill="currentColor"/></svg>`,
    ),
} as const

export const generatePlugin = {
  id: 'pascal:generate',
  apiVersion: 1,
  nodes: [],
} satisfies Plugin

export const generateHostPanel = {
  id: 'pascal:generate:panel',
  label: 'Generate',
  icon: GENERATE_ICON,
  component: () => import('./panel'),
  pluginId: generatePlugin.id,
  description: 'Roll a complete house — rooms, walls, openings, roof — from a seed, or build one of the authored templates.',
  creator: { name: 'Pascal', url: 'https://pascal.app' },
  defaultInstalled: true,
} satisfies EditorHostPanel

let commandsRegistered = false

/** Register the Ctrl+K commands. Idempotent (HMR-safe). */
export function registerGenerateCommands(): void {
  if (commandsRegistered || typeof window === 'undefined') return
  commandsRegistered = true
  const actions: CommandAction[] = [
    {
      id: 'generate.house',
      label: 'Generate house',
      group: 'Generate',
      keywords: ['roll', 'random', 'plan', 'floor plan', 'procedural', 'plancrafters'],
      execute: () => {
        generateHouse()
      },
    },
    {
      id: 'generate.random',
      label: 'Generate house (new seed)',
      group: 'Generate',
      keywords: ['reroll', 'random', 'dice'],
      execute: () => {
        useGenerate.getState().reroll()
        generateHouse()
      },
    },
    ...TEMPLATES.map<CommandAction>((t) => ({
      id: `generate.template.${t.id}`,
      label: `Generate house from template: ${t.label}`,
      group: 'Generate',
      keywords: ['template', 'adu', t.id],
      execute: () => {
        generateTemplate(t.id)
      },
    })),
  ]
  useCommandRegistry.getState().register(actions)
}

export { buildHouse, GENERATED_BY } from './build'
export type { BuildResult, NodeOp, Placement } from './build'
export { normalizeDocument, type PlanDocument, validateDocument } from './document'
export { rollDocument, type RollOptions } from './roll'
export { generateHouse, generateTemplate, removeGenerated } from './run'
export { useGenerate } from './store'
export { STYLES } from './styles'
export { POPPY, TEMPLATES } from './templates/poppy'
