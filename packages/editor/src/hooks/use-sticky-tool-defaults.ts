'use client'

import { type AnyNode, getStickyParams, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { type StickyParams, useStickyDefaults } from '../store/use-sticky-defaults'

/**
 * The subset of a node worth replaying onto the next instance of its kind,
 * per `capabilities.stickyParams`. Returns `null` for kinds that declare
 * none, and skips keys the instance leaves unset so an absent optional
 * (a wall with no explicit thickness) does not pin the memory to
 * `undefined`.
 */
export function stickyParamsOf(node: AnyNode): StickyParams | null {
  const definition = nodeRegistry.get(node.type)
  if (!definition) return null

  const keys = getStickyParams(definition)
  if (keys.length === 0) return null

  const params: Record<string, unknown> = {}
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (value !== undefined) params[key] = value
  }

  return Object.keys(params).length > 0 ? params : null
}

/**
 * Remembers the parameters of the node the user is working on, so the next
 * instance of that kind starts where the last one left off — draw a wall at
 * 0.25 m and the next one drafts at 0.25 m, switch a column to a plain
 * shaft and the next column places plain.
 *
 * Watches the *selected* node rather than diffing the whole scene: panel
 * edits and handle drags always target the selection, so the check is a
 * single reference comparison per scene mutation instead of a walk over
 * every node. It also gives the behaviour its shape — selecting a node
 * changes nothing (the node map is untouched), and a cascade that rewrites
 * some other node (wall re-mitering when its neighbour moves) is not
 * mistaken for an intentional setting.
 *
 * Moves are free of charge: `position` is never a sticky param, so a drag
 * produces an identical parameter set and the store short-circuits.
 */
export function useStickyToolDefaults(): void {
  useEffect(
    () =>
      useScene.subscribe((state, previous) => {
        if (state.nodes === previous.nodes) return

        const selectedIds = useViewer.getState().selection.selectedIds
        if (selectedIds.length !== 1) return

        const id = selectedIds[0] as AnyNode['id']
        const node = state.nodes[id]
        if (!node || node === previous.nodes[id]) return

        const params = stickyParamsOf(node)
        if (params) useStickyDefaults.getState().remember(node.type, params)
      }),
    [],
  )
}
