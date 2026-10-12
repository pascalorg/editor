'use client'
import { useScene, type WallFeatureNode } from '@pascal-app/core'
import { SelectControl, SliderControl } from '@pascal-app/editor'
import { useEffect, useMemo, useState } from 'react'
import { createWallFeaturePropertyPreview, wallFeatureEdit } from './editing'

export function WallFeatureInspector({
  node,
  onUpdate,
}: {
  node: WallFeatureNode
  onUpdate: (patch: Partial<WallFeatureNode>) => void
}) {
  const [error, setError] = useState('')
  const preview = useMemo(() => createWallFeaturePropertyPreview(node.id), [node.id])
  useEffect(() => () => preview.cancel(), [preview])
  const attempt = (action: () => void) => {
    try {
      action()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid feature edit.')
    }
  }
  const update = (patch: Partial<WallFeatureNode>) =>
    attempt(() => {
      onUpdate(wallFeatureEdit(useScene.getState().nodes, node, patch))
    })
  return (
    <div className="space-y-3">
      {error && (
        <p role="status" className="text-amber-500">
          {error}
        </p>
      )}
      <SelectControl<WallFeatureNode['mode']>
        label="Feature"
        value={node.mode}
        onChange={(mode) => update({ mode })}
        options={[
          { label: 'Niche', value: 'niche' },
          { label: 'Bump', value: 'bump' },
        ]}
      />
      {node.face && (
        <SelectControl<'a' | 'b'>
          label="Wall face"
          value={node.face}
          onChange={(face) => update({ face })}
          options={[
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ]}
        />
      )}
      {(['u', 'bottom', 'width', 'height', 'depth'] as const).map((key) => (
        <SliderControl
          key={key}
          label={
            {
              u: 'Along wall',
              bottom: 'Elevation',
              width: 'Width',
              height: 'Height',
              depth: 'Depth',
            }[key]
          }
          value={node[key]}
          unit="m"
          precision={3}
          step={0.01}
          min={key === 'u' ? undefined : key === 'bottom' ? 0 : Number.MIN_VALUE}
          onChange={(value) => attempt(() => preview.preview({ [key]: value }))}
          onCommit={(value) => attempt(() => preview.commit({ [key]: value }))}
          onCancel={() => preview.cancel()}
          previewWhileTyping
        />
      ))}
    </div>
  )
}
