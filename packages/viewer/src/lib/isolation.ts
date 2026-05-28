'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import type { Object3D } from 'three'

// Marker stashed on each Object3D we touch during isolation so we can
// restore the original `.visible` flag. Stored under a `Symbol` so it
// can't collide with any kind's own userData fields.
const ORIGINAL_VISIBLE = Symbol('isolation:original-visible')

type IsolationCarrier = Object3D & { [ORIGINAL_VISIBLE]?: boolean }

/**
 * Build the set of node IDs that must remain visible to "isolate" the
 * provided ids — the ids themselves, every ancestor along the parent
 * chain (so containers stay rendered, otherwise the scene root would go
 * dark), and every descendant (so children of the isolated nodes still
 * render even after we explicitly toggle individual visibility flags).
 *
 * Pure / no I/O — exported for testing.
 */
export function computeIsolationVisibleSet(
  ids: ReadonlyArray<string>,
  nodes: Readonly<Record<string, { parentId?: string | null; children?: unknown }>>,
): Set<string> {
  const visible = new Set<string>(ids)

  for (const id of ids) {
    let parentId = nodes[id]?.parentId
    while (parentId) {
      visible.add(parentId)
      parentId = nodes[parentId]?.parentId
    }
  }

  const stack: string[] = [...ids]
  while (stack.length > 0) {
    const current = stack.pop()!
    const node = nodes[current]
    const children = node && Array.isArray(node.children) ? (node.children as string[]) : []
    for (const child of children) {
      if (!visible.has(child)) {
        visible.add(child)
        stack.push(child)
      }
    }
  }

  return visible
}

/**
 * Imperative visibility filter on the live `sceneRegistry`. Walks every
 * registered (id, Object3D) pair and toggles `obj.visible` so only nodes
 * inside the isolation set remain rendered. Stashes the original visible
 * flag under a private Symbol so {@link clearIsolation} can restore the
 * exact prior state — important because nodes may have been hidden by
 * other features (`useScene.nodes[id].visible === false`).
 *
 * Composite-visibility note: setting an ancestor group to `visible=true`
 * is necessary because Three.js culls every descendant when an ancestor
 * is hidden. The pre-image of the isolation set therefore includes both
 * the ancestor chain and the descendant tree of the requested IDs.
 *
 * Pass `null` to clear isolation (equivalent to calling
 * {@link clearIsolation}).
 */
export function applyIsolation(ids: ReadonlyArray<AnyNodeId> | null): void {
  if (ids == null || ids.length === 0) {
    clearIsolation()
    return
  }

  const visible = computeIsolationVisibleSet(
    ids as ReadonlyArray<string>,
    useScene.getState().nodes,
  )
  for (const [id, obj] of sceneRegistry.nodes) {
    const carrier = obj as IsolationCarrier
    if (carrier[ORIGINAL_VISIBLE] === undefined) {
      carrier[ORIGINAL_VISIBLE] = carrier.visible
    }
    carrier.visible = visible.has(id)
  }
}

export function clearIsolation(): void {
  for (const [, obj] of sceneRegistry.nodes) {
    const carrier = obj as IsolationCarrier
    if (carrier[ORIGINAL_VISIBLE] !== undefined) {
      carrier.visible = carrier[ORIGINAL_VISIBLE]
      delete carrier[ORIGINAL_VISIBLE]
    }
  }
}
