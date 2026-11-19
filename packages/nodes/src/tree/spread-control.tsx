'use client'

import {
  resolveTreeParameters,
  TreeNode,
  useLiveNodeOverrides,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'
import { useCallback } from 'react'

export function TreeSpreadControl({
  node,
  onUpdate,
}: {
  node: TreeNode
  onUpdate: (patch: Partial<TreeNode>) => void
}) {
  const i18n = usePascalI18n()
  const clear = useCallback(() => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const preview = useCallback(
    (spreadM: number) => {
      if (!TreeNode.safeParse({ ...node, spreadM }).success) return
      useLiveNodeOverrides.getState().set(node.id, { spreadM })
      useScene.getState().markDirty(node.id)
    },
    [node],
  )
  return (
    <SliderControl
      label={i18n._({ id: 'node.tree.spread.label', message: 'Spread' })}
      max={30}
      min={0.5}
      onCancel={clear}
      onChange={preview}
      onCommit={(spreadM) => {
        if (TreeNode.safeParse({ ...node, spreadM }).success) onUpdate({ spreadM })
        clear()
      }}
      precision={2}
      restoreOnCommit={false}
      step={0.1}
      unit="m"
      value={resolveTreeParameters(node).spreadM}
    />
  )
}
