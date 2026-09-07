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
import { type Plugin, useScene } from '@pascal-app/core'
import { type CommandAction, type EditorHostPanel, useCommandRegistry } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { followRoofOf, levelsWithWallChanges } from './follow'
import { rebuildAutoRoof, refollowAutoRoof, setAutoRoofFollow } from './run'
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

/** How long after the last wall edit the roof re-derives — a drag emits many. */
const FOLLOW_DEBOUNCE_MS = 150

/**
 * The derived roof follows the walls: every scene change that reshapes a
 * wall (moved, stretched, added, removed) schedules its level's roof to
 * re-derive from the walls as they now stand. One subscription; the
 * rebuild writes segments and wall METADATA, which `levelsWithWallChanges`
 * does not count, so it cannot feed itself. On by default for every
 * derived roof; `roof.follow` switches it per roof.
 */
function subscribeRoofFollow(): void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  useScene.subscribe((state, previous) => {
    if (state.nodes === previous.nodes) return
    const levels = levelsWithWallChanges(previous.nodes as never, state.nodes as never)
    for (const levelId of levels) {
      if (!followRoofOf(state.nodes as never, levelId)) continue
      const timer = pending.get(levelId)
      if (timer) clearTimeout(timer)
      pending.set(
        levelId,
        setTimeout(() => {
          pending.delete(levelId)
          refollowAutoRoof(levelId)
        }, FOLLOW_DEBOUNCE_MS),
      )
    }
  })
}

/** Register the Ctrl+K commands and the follow subscription. Idempotent (HMR-safe). */
export function registerRoofCommands(): void {
  if (commandsRegistered || typeof window === 'undefined') return
  commandsRegistered = true
  subscribeRoofFollow()
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
    {
      id: 'roof.follow',
      label: 'Auto roof: follow the walls on / off',
      group: 'Roof',
      keywords: ['roof', 'auto', 'follow', 'walls', 'live', 'update'],
      execute: () => {
        const levelId = useViewer.getState().selection.levelId ?? null
        if (!levelId) return
        const nodes = useScene.getState().nodes as never
        const following = followRoofOf(nodes, levelId) !== null
        setAutoRoofFollow(levelId, !following)
      },
    },
  ]
  useCommandRegistry.getState().register(actions)
}

export { type AutoRoofResult, type AutoRoofSegment, deriveRoof, type RoofForm, type RoofIntent, type WallRoofRole } from './derive'
export { type Pt, type WallInput } from './geometry'
export { followRoofOf, intentOfRoof, levelsWithWallChanges } from './follow'
export { AUTO_ROOF, frontDirOfLevel, plateOfLevel, rebuildAutoRoof, refollowAutoRoof, roofNodesFor, setAutoRoofFollow, wallsOfLevel } from './run'
export { useAutoRoof } from './store'
export { STYLE_ROOF_FORMS, styleRoofForm } from './styles'
