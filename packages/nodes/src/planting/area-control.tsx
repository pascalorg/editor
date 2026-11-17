'use client'

import { PLANTING_LIMITS, PlantingNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'
import { useCallback, useRef, useState } from 'react'

/** Area bounds alone cannot guarantee an outline fits the Site coordinate bounds. */
export function plantingAreaPatch(node: PlantingNode, area: number): Partial<PlantingNode> | null {
  if (node.area === undefined || !PlantingNode.safeParse({ ...node, area }).success) return null
  return { area }
}

export function PlantingAreaControl({
  node,
  onUpdate,
}: {
  node: PlantingNode
  onUpdate: (patch: Partial<PlantingNode>) => void
}) {
  const latest = useRef({ node, onUpdate })
  latest.current = { node, onUpdate }
  const [error, setError] = useState<string | null>(null)
  const clear = useCallback(() => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const candidate = useCallback(
    (area: number) => {
      const stored = useScene.getState().nodes[node.id]
      const current = stored?.type === 'planting' ? stored : latest.current.node
      const patch = plantingAreaPatch(current, area)
      setError(patch ? null : 'This area would put the outline outside the supported Site bounds.')
      return patch
    },
    [node.id],
  )
  const preview = useCallback(
    (area: number) => {
      const patch = candidate(area)
      if (!patch) return
      useLiveNodeOverrides.getState().set(node.id, patch)
      useScene.getState().markDirty(node.id)
    },
    [candidate, node.id],
  )
  const commit = useCallback(
    (area: number) => {
      const patch = candidate(area)
      if (patch) latest.current.onUpdate(patch)
      clear()
    },
    [candidate, clear],
  )
  return (
    <div>
      <SliderControl
        label="Area"
        max={PLANTING_LIMITS.maxArea}
        min={PLANTING_LIMITS.minArea}
        onCancel={clear}
        onChange={preview}
        onCommit={commit}
        precision={2}
        restoreOnCommit={false}
        step={0.25}
        unit="m²"
        value={node.area ?? PLANTING_LIMITS.minArea}
      />
      {error && (
        <p className="mt-1 text-xs text-amber-700" role="status">
          {error}
        </p>
      )}
    </div>
  )
}
