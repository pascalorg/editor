import { type AnyNodeId, useInteractive } from '@pascal-app/core'
import { type AnimationAction, LoopOnce, type Object3D } from 'three'
import type { ScriptedClipActions } from '../../systems/interactive/scripted-clips'

export function isGlbShutterHit(hit: Object3D, identity: Object3D): boolean {
  for (let part: Object3D | null = hit; part && part !== identity; part = part.parent) {
    if (part.name.startsWith('shutter-') || part.name.startsWith('window-roller-')) return true
  }
  return false
}

export function playGlbShutters(action: AnimationAction, open: boolean): void {
  action.enabled = true
  action.paused = false
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.timeScale = open ? 1 : -1
  action.play()
}

/** Own only the shutters part; the sash and other mechanisms keep their own state. */
export function bindGlbShutters(
  identity: ReadonlyMap<string, Object3D>,
  actions: ScriptedClipActions,
): () => void {
  const parts = new Map<AnyNodeId, AnimationAction>()
  for (const [id, object] of identity) {
    const extras = object.userData as {
      shutters?: boolean
      shuttersOpen?: number
      clips?: string[]
    }
    const name = extras.clips?.find((clip) => clip === `${id}: shutters`)
    const action = name ? actions[name] : undefined
    if (!extras.shutters || !action) continue
    const fraction = Math.max(0, Math.min(1, extras.shuttersOpen ?? 1))
    action.time = fraction * action.getClip().duration
    // Keep the baked rest pose until the first toggle, including separately saved roller poses.
    parts.set(id as AnyNodeId, action)
    useInteractive.getState().setMechanismPart(id as AnyNodeId, 'shutters', fraction > 0.5)
  }
  const unsubscribe = useInteractive.subscribe((state, previous) => {
    if (state.mechanismParts === previous.mechanismParts) return
    for (const [id, action] of parts) {
      const key = `${id}:shutters` as const
      if (state.mechanismParts[key] !== previous.mechanismParts[key])
        playGlbShutters(action, Boolean(state.mechanismParts[key]))
    }
  })
  return () => {
    unsubscribe()
    for (const [id, action] of parts) {
      action.stop()
      useInteractive.getState().removeMechanismPart(id, 'shutters')
    }
  }
}

export function toggleGlbShutters(node: Object3D): boolean {
  const { shutters, pascalId } = node.userData as { shutters?: boolean; pascalId?: AnyNodeId }
  if (!shutters || !pascalId) return false
  const state = useInteractive.getState()
  state.setMechanismPart(pascalId, 'shutters', !state.mechanismParts[`${pascalId}:shutters`])
  return true
}
