'use client'
import { createSceneApi, type SlabFeatureNode, useScene } from '@pascal-app/core'
import { SelectControl, SliderControl } from '@pascal-app/editor'
import { useEffect, useMemo, useState } from 'react'
import { createSlabFeaturePropertyPreview, slabFeatureEdit } from './editing'

export function SlabFeatureInspector({
  node,
  onUpdate,
}: {
  node: SlabFeatureNode
  onUpdate: (patch: Partial<SlabFeatureNode>) => void
}) {
  const [error, setError] = useState('')
  const preview = useMemo(() => createSlabFeaturePropertyPreview(node.id), [node.id])
  useEffect(() => () => preview.cancel(), [preview])
  const attempt = (action: () => void) => {
    try {
      action()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid feature edit.')
    }
  }
  return (
    <div className="space-y-3">
      {error && (
        <p role="status" className="text-amber-500">
          {error}
        </p>
      )}
      <SelectControl<SlabFeatureNode['mode']>
        label="Feature"
        value={node.mode}
        onChange={(mode) =>
          attempt(() => onUpdate(slabFeatureEdit(createSceneApi(useScene), node, { mode })))
        }
        options={[
          { label: 'Niche', value: 'niche' },
          { label: 'Bump', value: 'bump' },
        ]}
      />
      {(['x', 'z', 'width', 'length', 'depth'] as const).map((key) => (
        <SliderControl
          key={key}
          label={
            { x: 'Position X', z: 'Position Z', width: 'Width', length: 'Length', depth: 'Depth' }[
              key
            ]
          }
          value={node[key]}
          unit="m"
          precision={3}
          step={0.01}
          min={key === 'x' || key === 'z' ? undefined : Number.MIN_VALUE}
          onChange={(value) => attempt(() => preview.preview({ [key]: value }))}
          onCommit={(value) => attempt(() => preview.commit({ [key]: value }))}
          onCancel={preview.cancel}
          previewWhileTyping
        />
      ))}
    </div>
  )
}
