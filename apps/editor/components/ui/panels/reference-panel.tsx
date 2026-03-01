'use client'

import { type AnyNode, type GuideNode, type ScanNode, useScene } from '@pascal-app/core'
import { Box, Image as ImageIcon } from 'lucide-react'
import { useCallback } from 'react'
import useEditor from '@/store/use-editor'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { MetricControl } from '../controls/metric-control'
import { ActionButton, ActionGroup } from '../controls/action-button'

type ReferenceNode = ScanNode | GuideNode

export function ReferencePanel() {
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const node = selectedReferenceId
    ? (nodes[selectedReferenceId as AnyNode['id']] as ReferenceNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<ReferenceNode>) => {
      if (!selectedReferenceId) return
      updateNode(selectedReferenceId as AnyNode['id'], updates)
    },
    [selectedReferenceId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelectedReferenceId(null)
  }, [setSelectedReferenceId])

  if (!node || (node.type !== 'scan' && node.type !== 'guide')) return null

  const isScan = node.type === 'scan'

  return (
    <PanelWrapper
      title={node.name || (isScan ? '3D Scan' : 'Guide Image')}
      icon={isScan ? undefined : undefined}
      onClose={handleClose}
      width={300}
    >
      <PanelSection title="Position">
        <SliderControl
          label={<>X<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[0] * 100) / 100}
          onChange={(value) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = value
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
          onChange={(value) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = value
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
          onChange={(value) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = value
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.1}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label={<>Y<sub className="text-[11px] ml-[1px] opacity-70">rot</sub></>}
          value={Math.round((node.rotation[1] * 180) / Math.PI)}
          onChange={(degrees) => {
            const radians = (degrees * Math.PI) / 180
            handleUpdate({
              rotation: [node.rotation[0], radians, node.rotation[2]],
            })
          }}
          min={-180}
          max={180}
          precision={0}
          step={1}
          unit="°"
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton 
            label="-45°" 
            onClick={() => handleUpdate({ rotation: [node.rotation[0], node.rotation[1] - Math.PI / 4, node.rotation[2]] })} 
          />
          <ActionButton 
            label="+45°" 
            onClick={() => handleUpdate({ rotation: [node.rotation[0], node.rotation[1] + Math.PI / 4, node.rotation[2]] })} 
          />
        </div>
      </PanelSection>

      <PanelSection title="Scale & Opacity">
        <SliderControl
          label={<>XYZ<sub className="text-[11px] ml-[1px] opacity-70">scale</sub></>}
          value={Math.round(node.scale * 100) / 100}
          onChange={(value) => {
            if (value > 0) {
              handleUpdate({ scale: value })
            }
          }}
          min={0.01}
          max={10}
          precision={2}
          step={0.1}
        />
        
        <SliderControl
          label="Opacity"
          value={node.opacity}
          onChange={(v) => handleUpdate({ opacity: v })}
          min={0}
          max={100}
          precision={0}
          step={1}
          unit="%"
        />
      </PanelSection>
    </PanelWrapper>
  )
}
