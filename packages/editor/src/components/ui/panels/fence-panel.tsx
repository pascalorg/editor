'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FenceNode,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  type MaterialSchema,
  normalizeWallCurveOffset,
  useScene,
} from '@pascal-app/core'

import { useViewer } from '@pascal-app/viewer'
import { Move, Spline } from 'lucide-react'
import { useCallback, useRef } from 'react'

import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MaterialPicker } from '../controls/material-picker'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
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
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setCurvingFence = useEditor((s) => s.setCurvingFence)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as FenceNode | undefined) : undefined,
  )

  // Mirror the latest node into a ref so the slider handlers below have
  // stable identities across re-renders. Without this, every store tick
  // (one per pointermove during a slider drag) rebuilt the handler
  // refs, which destabilised SliderControl's pointer-capture listeners
  // and combined with float drift in `getWallCurveLength` produced a
  // "Maximum update depth exceeded" cascade.
  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Partial<FenceNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId],
  )

  const handleUpdateLength = useCallback(
    (newLength: number) => {
      const n = nodeRef.current
      if (!n || newLength <= 0) return

      const dx = n.end[0] - n.start[0]
      const dz = n.end[1] - n.start[1]
      const currentLength = Math.sqrt(dx * dx + dz * dz)
      if (currentLength === 0) return

      const dirX = dx / currentLength
      const dirZ = dz / currentLength
      const newEnd: [number, number] = [
        n.start[0] + dirX * newLength,
        n.start[1] + dirZ * newLength,
      ]

      handleUpdate({ end: newEnd })
    },
    [handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (!(node && node.type === 'fence' && selectedId && selectedCount === 1)) return null

  const length = getWallCurveLength(node)
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)

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
        <ToggleControl
          checked={node.showInfill ?? true}
          className="mt-2"
          label="Fence Infill"
          onChange={(checked) => handleUpdate({ showInfill: checked })}
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
          label="Curve"
          max={Math.max(0.01, maxCurveOffset)}
          min={-Math.max(0.01, maxCurveOffset)}
          onChange={(value) => handleUpdate({ curveOffset: normalizeWallCurveOffset(node, value) })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(curveOffset * 100) / 100}
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
    </PanelWrapper>
  )
}
