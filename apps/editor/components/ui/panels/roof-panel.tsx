'use client'

import { type AnyNode, type RoofNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { MetricControl } from '../controls/metric-control'
import { ActionButton } from '../controls/action-button'

export function RoofPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as RoofNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<RoofNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (!node || node.type !== 'roof' || selectedIds.length !== 1) return null

  const totalWidth = node.leftWidth + node.rightWidth

  return (
    <PanelWrapper
      title={node.name || "Roof"}
      icon="/icons/roof.png"
      onClose={handleClose}
      width={300}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          value={Math.round(node.length * 100) / 100}
          onChange={(v) => handleUpdate({ length: v })}
          min={0.5}
          max={20}
          precision={2}
          step={0.5}
          unit="m"
        />
        <SliderControl
          label="Height"
          value={Math.round(node.height * 100) / 100}
          onChange={(v) => handleUpdate({ height: v })}
          min={0.1}
          max={10}
          precision={2}
          step={0.1}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Slope Widths">
        <div className="flex items-center justify-between px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          <span>Widths</span>
          <span>Total: {totalWidth.toFixed(1)}m</span>
        </div>
        <SliderControl
          label="Left"
          value={Math.round(node.leftWidth * 100) / 100}
          onChange={(v) => handleUpdate({ leftWidth: v })}
          min={0.1}
          max={10}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label="Right"
          value={Math.round(node.rightWidth * 100) / 100}
          onChange={(v) => handleUpdate({ rightWidth: v })}
          min={0.1}
          max={10}
          precision={2}
          step={0.1}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label={<>R<sub className="text-[11px] ml-[1px] opacity-70">rot</sub></>}
          value={Math.round((node.rotation * 180) / Math.PI)}
          onChange={(degrees) => {
            const radians = (degrees * Math.PI) / 180
            handleUpdate({ rotation: radians })
          }}
          min={-180}
          max={180}
          precision={0}
          step={1}
          unit="°"
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton 
            label="-90°" 
            onClick={() => handleUpdate({ rotation: node.rotation - Math.PI / 2 })} 
          />
          <ActionButton 
            label="+90°" 
            onClick={() => handleUpdate({ rotation: node.rotation + Math.PI / 2 })} 
          />
        </div>
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label={<>X<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[0] * 100) / 100}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label={<>Y<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[1] * 100) / 100}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label={<>Z<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[2] * 100) / 100}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.1}
          unit="m"
        />
      </PanelSection>
    </PanelWrapper>
  )
}
