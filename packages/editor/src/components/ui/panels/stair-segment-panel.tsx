'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AttachmentSide,
  type MaterialSchema,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  type StairSegmentType,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MaterialPicker } from '../controls/material-picker'
import { MetricControl } from '../controls/metric-control'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

const SEGMENT_TYPE_OPTIONS: { label: string; value: StairSegmentType }[] = [
  { label: 'Flight', value: 'stair' },
  { label: 'Landing', value: 'landing' },
]

const ATTACHMENT_SIDE_OPTIONS: { label: string; value: AttachmentSide }[] = [
  { label: 'Front', value: 'front' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
]

export function StairSegmentPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as StairSegmentNode | undefined)
    : undefined

  // Check if this is the first segment in the parent stair
  const isFirstSegment = (() => {
    if (!node?.parentId) return true
    const parent = nodes[node.parentId as AnyNodeId]
    if (!parent || parent.type !== 'stair') return true
    const children = (parent as any).children ?? []
    return children[0] === node.id
  })()

  const handleUpdate = useCallback(
    (updates: Partial<StairSegmentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleMaterialChange = useCallback(
    (material: MaterialSchema) => {
      handleUpdate({ material, materialPreset: undefined })
    },
    [handleUpdate],
  )

  const handleMaterialPresetChange = useCallback(
    (materialPreset: string) => {
      handleUpdate({ materialPreset, material: undefined })
    },
    [handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.parentId) {
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node?.parentId, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    sfxEmitter.emit('sfx:item-pick')

    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1,
    ]

    try {
      const duplicate = StairSegmentNodeSchema.parse(duplicateInfo)
      useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
      setSelection({ selectedIds: [] })
      setMovingNode(duplicate)
    } catch (e) {
      console.error('Failed to duplicate stair segment', e)
    }
  }, [node, setSelection, setMovingNode])

  const handleMove = useCallback(() => {
    if (node) {
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
      setSelection({ selectedIds: [parentId] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, setSelection])

  if (!node || node.type !== 'stair-segment' || selectedIds.length !== 1) return null

  return (
    <PanelWrapper
      icon="/icons/stairs.png"
      onBack={handleBack}
      onClose={handleClose}
      title={node.name || 'Stair Segment'}
      width={300}
    >
      <PanelSection title="Type">
        <SegmentedControl
          onChange={(v) => {
            const updates: Partial<StairSegmentNode> = { segmentType: v }
            if (v === 'landing') {
              updates.height = 0
              updates.stepCount = 0
              updates.length = 1.0
            } else {
              updates.height = 2.5
              updates.stepCount = 10
              updates.length = 3.0
            }
            handleUpdate(updates)
          }}
          options={SEGMENT_TYPE_OPTIONS}
          value={node.segmentType}
        />
      </PanelSection>

      {!isFirstSegment && (
        <PanelSection title="Attachment">
          <SegmentedControl
            onChange={(v) => handleUpdate({ attachmentSide: v })}
            options={ATTACHMENT_SIDE_OPTIONS}
            value={node.attachmentSide}
          />
        </PanelSection>
      )}

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={5}
          min={0.5}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Length"
          max={10}
          min={0.5}
          onChange={(v) => handleUpdate({ length: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.length * 100) / 100}
        />
        {node.segmentType === 'stair' && (
          <>
            <SliderControl
              label="Height"
              max={10}
              min={0.5}
              onChange={(v) => handleUpdate({ height: v })}
              precision={2}
              step={0.1}
              unit="m"
              value={Math.round(node.height * 100) / 100}
            />
            <SliderControl
              label="Steps"
              max={30}
              min={2}
              onChange={(v) => handleUpdate({ stepCount: Math.round(v) })}
              precision={0}
              step={1}
              unit=""
              value={node.stepCount}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Structure">
        <div className="flex items-center justify-between px-1 py-1">
          <span className="text-muted-foreground text-xs">Fill to floor</span>
          <button
            className={`relative h-5 w-10 rounded-full transition-colors ${
              node.fillToFloor ? 'bg-blue-500' : 'bg-[#3e3e3e]'
            }`}
            onClick={() => handleUpdate({ fillToFloor: !node.fillToFloor })}
            type="button"
          >
            <div
              className={`absolute top-1 h-3 w-3 rounded-full bg-white transition-transform ${
                node.fillToFloor ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>
        {!node.fillToFloor && (
          <SliderControl
            label="Thickness"
            max={1}
            min={0.05}
            onChange={(v) => handleUpdate({ thickness: v })}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round((node.thickness ?? 0.25) * 100) / 100}
          />
        )}
      </PanelSection>

      <PanelSection title="Position">
        <MetricControl
          label="X"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <MetricControl
          label="Y"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <MetricControl
          label="Z"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => {
            handleUpdate({ rotation: (degrees * Math.PI) / 180 })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
      <PanelSection title="Material">
        <MaterialPicker
          nodeType="stair-segment"
          onChange={handleMaterialChange}
          onSelectMaterialPreset={handleMaterialPresetChange}
          selectedMaterialPreset={node.materialPreset}
          value={node.material}
        />
      </PanelSection>
    </PanelWrapper>
  )
}
