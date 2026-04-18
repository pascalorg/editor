'use client'

import { type AnyNode, type AnyNodeId, type FenceNode, type MaterialSchema, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { MaterialPicker } from '../controls/material-picker'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

type FenceStyleValue = 'slat' | 'rail' | 'privacy'
type FenceBaseStyleValue = 'grounded' | 'floating'

const FENCE_STYLE_OPTIONS: { label: string; value: FenceStyleValue }[] = [
  { label: 'Slat', value: 'slat' },
  { label: 'Rail', value: 'rail' },
  { label: 'Privacy', value: 'privacy' },
]

const FENCE_BASE_STYLE_OPTIONS: { label: string; value: FenceBaseStyleValue }[] = [
  { label: 'Grounded', value: 'grounded' },
  { label: 'Floating', value: 'floating' },
]

export function FencePanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as FenceNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<FenceNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleUpdateLength = useCallback(
    (newLength: number) => {
      if (!node || newLength <= 0) return

      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const currentLength = Math.sqrt(dx * dx + dz * dz)
      if (currentLength === 0) return

      const dirX = dx / currentLength
      const dirZ = dz / currentLength
      const newEnd: [number, number] = [
        node.start[0] + dirX * newLength,
        node.start[1] + dirZ * newLength,
      ]

      handleUpdate({ end: newEnd })
    },
    [node, handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMaterialPresetChange = useCallback(
    (materialPreset: string) => {
      handleUpdate({ materialPreset, material: undefined })
    },
    [handleUpdate],
  )

  const handleCustomMaterialChange = useCallback(
    (material: MaterialSchema) => {
      handleUpdate({ material, materialPreset: undefined })
    },
    [handleUpdate],
  )

  if (!(node && node.type === 'fence' && selectedId && selectedCount === 1)) return null

  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const length = Math.sqrt(dx * dx + dz * dz)

  return (
    <PanelWrapper
      icon="/icons/build.png"
      onClose={handleClose}
      title={node.name || 'Fence'}
      width={300}
    >
      <PanelSection title="Style">
        <SegmentedControl
          onChange={(value) => handleUpdate({ style: value })}
          options={FENCE_STYLE_OPTIONS}
          value={node.style}
        />
        <SegmentedControl
          className="mt-2"
          onChange={(value) => handleUpdate({ baseStyle: value })}
          options={FENCE_BASE_STYLE_OPTIONS}
          value={node.baseStyle}
        />
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          max={50}
          min={0.1}
          onChange={handleUpdateLength}
          precision={2}
          step={0.01}
          unit="m"
          value={length}
        />
        <SliderControl
          label="Height"
          max={4}
          min={0.4}
          onChange={(value) => handleUpdate({ height: Math.max(0.4, value) })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.height}
        />
        <SliderControl
          label="Thickness"
          max={0.5}
          min={0.03}
          onChange={(value) => handleUpdate({ thickness: Math.max(0.03, value) })}
          precision={3}
          step={0.005}
          unit="m"
          value={node.thickness}
        />
      </PanelSection>

      <PanelSection title="Structure">
        <SliderControl
          label="Base Height"
          max={1}
          min={0.04}
          onChange={(value) => handleUpdate({ baseHeight: Math.max(0.04, value) })}
          precision={3}
          step={0.01}
          unit="m"
          value={node.baseHeight}
        />
        <SliderControl
          label="Top Rail"
          max={0.25}
          min={0.01}
          onChange={(value) => handleUpdate({ topRailHeight: Math.max(0.01, value) })}
          precision={3}
          step={0.005}
          unit="m"
          value={node.topRailHeight}
        />
        <SliderControl
          label="Post Spacing"
          max={5}
          min={0.2}
          onChange={(value) => handleUpdate({ postSpacing: Math.max(0.2, value) })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.postSpacing}
        />
        <SliderControl
          label="Post Size"
          max={0.4}
          min={0.01}
          onChange={(value) => handleUpdate({ postSize: Math.max(0.01, value) })}
          precision={3}
          step={0.005}
          unit="m"
          value={node.postSize}
        />
        <SliderControl
          label="Ground Clear"
          max={0.6}
          min={0}
          onChange={(value) => handleUpdate({ groundClearance: Math.max(0, value) })}
          precision={3}
          step={0.005}
          unit="m"
          value={node.groundClearance}
        />
        <SliderControl
          label="Edge Inset"
          max={0.25}
          min={0.005}
          onChange={(value) => handleUpdate({ edgeInset: Math.max(0.005, value) })}
          precision={3}
          step={0.005}
          unit="m"
          value={node.edgeInset}
        />
      </PanelSection>

      <PanelSection title="Material">
        <MaterialPicker
          nodeType="fence"
          onChange={handleCustomMaterialChange}
          onSelectMaterialPreset={handleMaterialPresetChange}
          selectedMaterialPreset={node.materialPreset}
          value={node.material}
        />
      </PanelSection>
    </PanelWrapper>
  )
}
