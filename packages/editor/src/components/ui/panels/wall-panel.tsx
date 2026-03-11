'use client'

import { type AnyNode, type AnyNodeId, type WallNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'

export function WallPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as WallNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<WallNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (!node || node.type !== 'wall' || selectedIds.length !== 1) return null

  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const length = Math.sqrt(dx * dx + dz * dz)

  const height = node.height ?? 2.5
  const thickness = node.thickness ?? 0.1

  return (
    <PanelWrapper
      title={node.name || "Wall"}
      icon="/icons/wall.png"
      onClose={handleClose}
      width={280}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Height"
          value={Math.round(height * 100) / 100}
          onChange={(v) => handleUpdate({ height: Math.max(0.1, v) })}
          min={0.1}
          max={6}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label="Thickness"
          value={Math.round(thickness * 1000) / 1000}
          onChange={(v) => handleUpdate({ thickness: Math.max(0.05, v) })}
          min={0.05}
          max={1}
          precision={3}
          step={0.01}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-sm text-muted-foreground">
          <span>Length</span>
          <span className="font-mono text-white">{length.toFixed(2)} m</span>
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}
