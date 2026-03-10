'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { Plus } from 'lucide-react'

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
  const createNode = useScene((s) => s.createNode)

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

  const handleAddSegment = useCallback(() => {
    if (!node) return
    const segment = RoofSegmentNodeSchema.parse({
      width: 6,
      depth: 6,
      wallHeight: 4,
      roofHeight: 3,
      roofType: 'gable',
      position: [2, 0, 2],
    })
    createNode(segment, node.id as AnyNodeId)
  }, [node, createNode])

  const handleSelectSegment = useCallback(
    (segmentId: string) => {
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    },
    [setSelection],
  )

  if (!node || node.type !== 'roof' || selectedIds.length !== 1) return null

  const segments = (node.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
    .filter((n): n is RoofSegmentNode => n?.type === 'roof-segment')

  return (
    <PanelWrapper
      title={node.name || 'Roof'}
      icon="/icons/roof.png"
      onClose={handleClose}
      width={300}
    >
      <PanelSection title="Segments">
        <div className="flex flex-col gap-1">
          {segments.map((seg, i) => (
            <button
              key={seg.id}
              type="button"
              onClick={() => handleSelectSegment(seg.id)}
              className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-sm text-foreground transition-colors hover:bg-[#3e3e3e]"
            >
              <span className="truncate">{seg.name || `Segment ${i + 1}`}</span>
              <span className="text-xs text-muted-foreground capitalize">{seg.roofType}</span>
            </button>
          ))}
        </div>
        <ActionButton
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Add Segment"
          onClick={handleAddSegment}
        />
      </PanelSection>

      <PanelSection title="Position">
        <MetricControl
          label="X"
          value={Math.round(node.position[0] * 100) / 100}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.5}
          unit="m"
        />
        <MetricControl
          label="Y"
          value={Math.round(node.position[1] * 100) / 100}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.5}
          unit="m"
        />
        <MetricControl
          label="Z"
          value={Math.round(node.position[2] * 100) / 100}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          min={-50}
          max={50}
          precision={2}
          step={0.5}
          unit="m"
        />
        <SliderControl
          label="Rotation"
          value={Math.round((node.rotation * 180) / Math.PI)}
          onChange={(degrees) => {
            handleUpdate({ rotation: (degrees * Math.PI) / 180 })
          }}
          min={-180}
          max={180}
          precision={0}
          step={1}
          unit="°"
        />
      </PanelSection>
    </PanelWrapper>
  )
}
