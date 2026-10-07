'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { sceneRegistry } from '@pascal-app/core'
import type { Object3D, Scene } from 'three'
import { hideFromScene, showInScene } from './scene-visibility'

let isolatedIds: ReadonlyArray<AnyNodeId> | null = null
let heldObjects = new Set<Object3D>()
let liveScene: Object3D | undefined
const noop = () => {}

/** True while a subtree is isolated, including before its lazy meshes mount. */
export function isIsolationActive(): boolean {
  return isolatedIds !== null
}

/** Include synthesized meshes below a selected native root, including hosted openings. */
export function collectIsolationSubtree(ids: ReadonlyArray<string>): Set<Object3D> {
  const keep = new Set<Object3D>()
  for (const id of ids) {
    const root = sceneRegistry.nodes.get(id)
    root?.traverse((child) => {
      keep.add(child)
    })
  }
  return keep
}

/**
 * Select native subtrees without mutating the saved scene or cascading visibility
 * through their hosts. The next draw also filters unregistered presentation geometry.
 */
export function applyIsolation(ids: ReadonlyArray<AnyNodeId> | null): void {
  if (ids == null || ids.length === 0) {
    clearIsolation()
    return
  }
  isolatedIds = [...ids]
  refreshIsolation()
}

/**
 * Reconcile immediately before viewport or snapshot rendering. Environment, sky,
 * ground and instance batches can live outside sceneRegistry or mount asynchronously.
 * Lights/cameras remain usable; masks do not cascade, so an isolated door can still
 * render under its hidden wall. Collective renderers fall back to native geometry.
 * The returned cleanup restores fog after the synchronous draw, before atmosphere
 * owners can change it again. Do not hold this cleanup across async GPU readback.
 */
export function refreshIsolation(scene?: Object3D): () => void {
  if (!isolatedIds) return noop
  if (scene) liveScene = scene
  const keep = collectIsolationSubtree(isolatedIds)
  const visited = new Set<Object3D>()
  const hidden = new Set<Object3D>()
  const visit = (object: Object3D) => {
    if (visited.has(object)) return
    visited.add(object)
    const flags = object as Object3D & { isLight?: boolean; isCamera?: boolean }
    if (keep.has(object) || flags.isLight || flags.isCamera) return
    hideFromScene(object, 'isolated')
    hidden.add(object)
  }
  liveScene?.traverse(visit)
  // Also covers not-yet-attached registered roots and imperative callers without a scene.
  for (const object of sceneRegistry.nodes.values()) object.traverse(visit)
  for (const object of heldObjects) if (!hidden.has(object)) showInScene(object, 'isolated')
  heldObjects = hidden

  const atmosphere = scene as Scene | undefined
  if (!atmosphere?.isScene) return noop
  const { fog, fogNode } = atmosphere
  atmosphere.fog = null
  atmosphere.fogNode = null
  return () => {
    atmosphere.fog = fog
    atmosphere.fogNode = fogNode
  }
}

/** Restore even detached/unregistered meshes, without undoing solo or batching holds. */
export function clearIsolation(): void {
  for (const object of heldObjects) showInScene(object, 'isolated')
  heldObjects.clear()
  isolatedIds = null
  liveScene = undefined
}
