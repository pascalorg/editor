import { type AnyNodeId, useInteractive } from '@pascal-app/core'
import {
  type AnimationAction,
  Box3,
  LoopOnce,
  Matrix4,
  type Mesh,
  type Object3D,
  Ray,
  type Raycaster,
  Vector3,
} from 'three'
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

type OpeningHit = { object: Object3D; distance: number }

/** Keep the baked opening target stationary when its animated leaf leaves the reticle ray. */
export function createGlbOpeningRaycast(identity: ReadonlyMap<string, Object3D>) {
  const openings: { node: Object3D; bounds: Box3; rest: Matrix4 }[] = []
  const inverse = new Matrix4()
  const transform = new Matrix4()
  const box = new Box3()
  for (const node of identity.values()) {
    if (
      !node.userData.openable ||
      !node.userData.clips?.some((name: string) => name.endsWith(': open'))
    )
      continue
    node.updateWorldMatrix(true, true)
    inverse.copy(node.matrixWorld).invert()
    const bounds = new Box3()
    const visit = (object: Object3D) => {
      // Hosted identities have their own targets and must not enlarge this opening.
      if (object !== node && object.userData.pascalId) return
      const mesh = object as Mesh
      if (mesh.geometry) {
        mesh.geometry.computeBoundingBox()
        if (mesh.geometry.boundingBox) {
          transform.multiplyMatrices(inverse, object.matrixWorld)
          bounds.union(box.copy(mesh.geometry.boundingBox).applyMatrix4(transform))
        }
      }
      for (const child of object.children) visit(child)
    }
    visit(node)
    if (!bounds.isEmpty()) openings.push({ node, bounds, rest: node.matrix.clone() })
  }
  const ray = new Ray()
  const point = new Vector3()
  return (raycaster: Raycaster, hit?: OpeningHit): OpeningHit | undefined => {
    for (const { node, bounds, rest } of openings) {
      let visible = true
      let ownsHit = false
      for (let at: Object3D | null = node; at; at = at.parent) if (!at.visible) visible = false
      for (let at = hit?.object; at; at = at.parent ?? undefined) if (at === node) ownsHit = true
      if (!visible || ownsHit) continue
      // The identity itself may be animated; follow only its parent's current placement.
      if (node.parent) {
        node.parent.updateWorldMatrix(true, false)
        transform.multiplyMatrices(node.parent.matrixWorld, rest)
      } else transform.copy(rest)
      inverse.copy(transform).invert()
      ray.copy(raycaster.ray).applyMatrix4(inverse)
      if (!ray.intersectBox(bounds, point)) continue
      point.applyMatrix4(transform)
      const distance = point.distanceTo(raycaster.ray.origin)
      if (
        distance >= raycaster.near &&
        distance <= raycaster.far &&
        (!hit || distance < hit.distance)
      )
        hit = { object: node, distance }
    }
    return hit
  }
}
