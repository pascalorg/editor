'use client'

import { type AnyNode, type RoofSegmentNode, RoofSegmentNode as RoofSegmentNodeSchema, type RoofType, useScene, type AnyNodeId } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { Copy, Trash2, Move } from 'lucide-react'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { SegmentedControl } from '../controls/segmented-control'
import { MetricControl } from '../controls/metric-control'
import { ActionButton, ActionGroup } from '../controls/action-button'

const ROOF_TYPE_OPTIONS: { label: string; value: RoofType }[] = [
  { label: 'Hip', value: 'hip' },
  { label: 'Gable', value: 'gable' },
  { label: 'Shed', value: 'shed' },
  { label: 'Flat', value: 'flat' },
]

const ROOF_TYPE_OPTIONS_2: { label: string; value: RoofType }[] = [
  { label: 'Gambrel', value: 'gambrel' },
  { label: 'Dutch', value: 'dutch' },
  { label: 'Mansard', value: 'mansard' },
]

export function RoofSegmentPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as RoofSegmentNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<RoofSegmentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
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
    if (!node || !node.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    
    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }
    // Offset slightly so it's visible
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1
    ]

    try {
      const duplicate = RoofSegmentNodeSchema.parse(duplicateInfo)
      useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
      setSelection({ selectedIds: [] })
      setMovingNode(duplicate)
    } catch (e) {
      console.error('Failed to duplicate roof segment', e)
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
    if (!selectedId || !node) return
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

  if (!node || node.type !== 'roof-segment' || selectedIds.length !== 1) return null

  return (
    <PanelWrapper
      title={node.name || 'Roof Segment'}
      icon="/icons/roof.png"
      onClose={handleClose}
      onBack={handleBack}
      width={300}
    >
      <PanelSection title="Roof Type">
        <SegmentedControl
          value={node.roofType}
          onChange={(v) => handleUpdate({ roofType: v })}
          options={ROOF_TYPE_OPTIONS}
        />
        <SegmentedControl
          value={node.roofType}
          onChange={(v) => handleUpdate({ roofType: v })}
          options={ROOF_TYPE_OPTIONS_2}
        />
      </PanelSection>

      <PanelSection title="Footprint">
        <SliderControl
          label="Width"
          value={Math.round(node.width * 100) / 100}
          onChange={(v) => handleUpdate({ width: v })}
          min={0.5}
          max={25}
          precision={2}
          step={0.5}
          unit="m"
        />
        <SliderControl
          label="Depth"
          value={Math.round(node.depth * 100) / 100}
          onChange={(v) => handleUpdate({ depth: v })}
          min={0.5}
          max={25}
          precision={2}
          step={0.5}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Heights">
        <SliderControl
          label="Wall"
          value={Math.round(node.wallHeight * 100) / 100}
          onChange={(v) => handleUpdate({ wallHeight: v })}
          min={0}
          max={5}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label="Roof"
          value={Math.round(node.roofHeight * 100) / 100}
          onChange={(v) => handleUpdate({ roofHeight: v })}
          min={0}
          max={15}
          precision={2}
          step={0.1}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Structure">
        <SliderControl
          label="Wall Thick."
          value={Math.round(node.wallThickness * 100) / 100}
          onChange={(v) => handleUpdate({ wallThickness: v })}
          min={0.05}
          max={1}
          precision={2}
          step={0.05}
          unit="m"
        />
        <SliderControl
          label="Deck Thick."
          value={Math.round(node.deckThickness * 100) / 100}
          onChange={(v) => handleUpdate({ deckThickness: v })}
          min={0.04}
          max={0.3}
          precision={2}
          step={0.01}
          unit="m"
        />
        <SliderControl
          label="Overhang"
          value={Math.round(node.overhang * 100) / 100}
          onChange={(v) => handleUpdate({ overhang: v })}
          min={0}
          max={1}
          precision={2}
          step={0.05}
          unit="m"
        />
        <SliderControl
          label="Shingle Thick."
          value={Math.round(node.shingleThickness * 100) / 100}
          onChange={(v) => handleUpdate({ shingleThickness: v })}
          min={0.02}
          max={0.3}
          precision={2}
          step={0.01}
          unit="m"
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
          step={0.05}
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
          step={0.05}
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
          step={0.05}
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
          <ActionButton icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" onClick={handleDuplicate} />
          <ActionButton
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
            className="hover:bg-red-500/20"
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
