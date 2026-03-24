'use client'

import { type AnyNode, type AnyNodeId, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function WallPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const selectedId = selectedIds[0]
  const node = selectedId ? (nodes[selectedId as AnyNode['id']] as WallNode | undefined) : undefined

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

  const height = node.height ?? 10
  const thickness = node.thickness ?? 0.5

  return (
    <PanelWrapper
      icon="/icons/wall.png"
      onClose={handleClose}
      title={node.name || 'Wall'}
      width={320}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          max={200}
          min={0.5}
          onChange={(v) => {
            const dx = node.end[0] - node.start[0]
            const dz = node.end[1] - node.start[1]
            let angle = Math.atan2(dz, dx)
            if (dx === 0 && dz === 0) angle = 0
            const newEnd = [
              node.start[0] + Math.cos(angle) * v,
              node.start[1] + Math.sin(angle) * v,
            ]
            handleUpdate({ end: newEnd as [number, number] })
          }}
          precision={2}
          step={0.1}
          unit="ft"
          value={Math.round(length * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={40}
          min={1}
          onChange={(v) => handleUpdate({ height: Math.max(1, v) })}
          precision={2}
          step={0.1}
          unit="ft"
          value={Math.round(height * 100) / 100}
        />
        <SliderControl
          label="Thickness"
          max={4}
          min={0.1}
          onChange={(v) => handleUpdate({ thickness: Math.max(0.1, v) })}
          precision={2}
          step={0.05}
          unit="ft"
          value={Math.round(thickness * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Position">
        <div className="grid grid-cols-2 gap-1.5">
          <SliderControl
            label="Start X"
            max={400}
            min={-400}
            onChange={(v) => handleUpdate({ start: [v, node.start[1]] })}
            precision={2}
            step={0.1}
            unit="ft"
            value={Math.round(node.start[0] * 100) / 100}
          />
          <SliderControl
            label="Start Z"
            max={400}
            min={-400}
            onChange={(v) => handleUpdate({ start: [node.start[0], v] })}
            precision={2}
            step={0.1}
            unit="ft"
            value={Math.round(node.start[1] * 100) / 100}
          />
          <SliderControl
            label="End X"
            max={400}
            min={-400}
            onChange={(v) => handleUpdate({ end: [v, node.end[1]] })}
            precision={2}
            step={0.1}
            unit="ft"
            value={Math.round(node.end[0] * 100) / 100}
          />
          <SliderControl
            label="End Z"
            max={400}
            min={-400}
            onChange={(v) => handleUpdate({ end: [node.end[0], v] })}
            precision={2}
            step={0.1}
            unit="ft"
            value={Math.round(node.end[1] * 100) / 100}
          />
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}
