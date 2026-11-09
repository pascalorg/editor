'use client'
import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import type { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { usePlacementPreview } from '@pascal-app/editor'
import { useEffect } from 'react'
import ProceduralRenderer from './renderer'

export default function EditorProceduralRenderer({ node }: { node: ProceduralItemNode }) {
  const overrides = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const effective = { ...node, ...overrides } as ProceduralItemNode
  const cutKey = effective.recipe.cuts
    ? JSON.stringify([
        node.parentId,
        effective.position,
        effective.rotation,
        effective.parameters,
        effective.visible,
        effective.recipe.cuts,
        effective.recipe.surfaces,
        effective.recipe.mounting?.reference,
      ])
    : ''
  useEffect(() => {
    const parentId = node.parentId as AnyNodeId | null
    if (!(cutKey && parentId)) return
    const recut = (id: string | null | undefined = parentId) => {
      if (id && useScene.getState().nodes[id as AnyNodeId])
        useScene.getState().markDirty(id as AnyNodeId)
    }
    // A move preview of this design re-cuts its ceiling, and the ceiling it previews on, on
    // every step.
    const unsubscribe = usePlacementPreview.subscribe((state, previous) => {
      if (state.node?.id !== node.id && previous.node?.id !== node.id) return
      recut()
      for (const id of new Set([state.node?.parentId, previous.node?.parentId]))
        if (id !== parentId && useScene.getState().nodes[id as AnyNodeId]?.type === 'ceiling')
          recut(id)
    })
    return () => {
      unsubscribe()
      recut()
      const preview = usePlacementPreview.getState().node
      if (preview?.id === node.id && preview.parentId !== parentId) recut(preview.parentId)
    }
  }, [cutKey, node.parentId, node.id])
  return <ProceduralRenderer node={node} />
}
