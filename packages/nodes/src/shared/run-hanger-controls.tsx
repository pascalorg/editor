'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { disposeObject3DResources } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { Mesh, MeshBasicMaterial } from 'three'
import { buildRunHangers, type SupportedRun } from './run-hangers'

export function RunHangerToggle({
  enabled,
  onChange,
  style,
  onStyleChange,
}: {
  style: 'single' | 'double'
  onStyleChange: (style: 'single' | 'double') => void
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-pressed={enabled}
        className="pointer-events-auto whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-1 text-[10px] text-foreground shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onChange(!enabled)
        }}
      >
        Auto hangers: {enabled ? 'On' : 'Off'}
      </button>
      {enabled && (
        <select
          aria-label="Hanger lines"
          className="pointer-events-auto rounded-full border border-border/60 bg-background/90 px-2 py-1 text-[10px] text-foreground"
          value={style}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onStyleChange(event.target.value === 'double' ? 'double' : 'single')}
        >
          <option value="single">Single line</option>
          <option value="double">Double line</option>
        </select>
      )}
    </span>
  )
}

export function RunHangerPreview({ run, levelId }: { run: SupportedRun; levelId: AnyNodeId }) {
  const nodes = useScene.getState().nodes
  const geometry = useMemo(() => {
    const group = buildRunHangers(
      { ...run, parentId: levelId },
      {
        resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
        children: [],
        siblings: [],
        parent: nodes[levelId] ?? null,
        sceneNodes: nodes,
      },
    )
    const material = new MeshBasicMaterial({
      color: '#818cf8',
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    })
    const disposed = new Set<object>()
    group.traverse((child) => {
      if (!(child instanceof Mesh)) return
      for (const previous of Array.isArray(child.material) ? child.material : [child.material]) {
        if (!disposed.has(previous)) {
          previous.dispose()
          disposed.add(previous)
        }
      }
      child.material = material
      child.layers.set(EDITOR_LAYER)
    })
    if (!group.children.length) material.dispose()
    return group
  }, [run, levelId, nodes])
  useEffect(() => () => disposeObject3DResources(geometry), [geometry])
  return <primitive object={geometry} />
}
