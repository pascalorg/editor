'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveRoofSurfaceMaterial,
  type MaterialSchema,
  type RoofNode,
  type RoofSurfaceMaterialRole,
  RoofNode as RoofNodeSchema,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MaterialPicker } from '../controls/material-picker'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

function buildRoofSurfaceMaterialPatch(
  node: RoofNode,
  targetRole: RoofSurfaceMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<RoofNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextTop =
    targetRole === 'top' ? nextSurfaceMaterial : getEffectiveRoofSurfaceMaterial(node, 'top')
  const nextEdge =
    targetRole === 'edge' ? nextSurfaceMaterial : getEffectiveRoofSurfaceMaterial(node, 'edge')
  const nextWall =
    targetRole === 'wall' ? nextSurfaceMaterial : getEffectiveRoofSurfaceMaterial(node, 'wall')

  return {
    topMaterial: nextTop.material,
    topMaterialPreset: nextTop.materialPreset,
    edgeMaterial: nextEdge.material,
    edgeMaterialPreset: nextEdge.materialPreset,
    wallMaterial: nextWall.material,
    wallMaterialPreset: nextWall.materialPreset,
    material: undefined,
    materialPreset: undefined,
  }
}

export function RoofPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const selectedRoofMaterialTarget = useEditor((s) => s.selectedRoofMaterialTarget)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoofNode | undefined) : undefined,
  )
  // Shallow selector — only re-renders when the segment list content changes.
  const segments = useScene(
    useShallow((s) => {
      if (!node) return []
      return (node.children ?? [])
        .map((childId) => s.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
        .filter((n): n is RoofSegmentNode => n?.type === 'roof-segment')
    }),
  )

  const handleUpdate = useCallback(
    (updates: Partial<RoofNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const materialTargetRole =
    selectedRoofMaterialTarget && selectedRoofMaterialTarget.roofId === node?.id
      ? selectedRoofMaterialTarget.role
      : null
  const materialPickerValue =
    node && materialTargetRole ? getEffectiveRoofSurfaceMaterial(node, materialTargetRole) : {}

  const handleTargetedMaterialChange = useCallback(
    (material: MaterialSchema) => {
      if (!node || !materialTargetRole) return
      handleUpdate(buildRoofSurfaceMaterialPatch(node, materialTargetRole, material, undefined))
    },
    [handleUpdate, materialTargetRole, node],
  )

  const handleTargetedMaterialPresetChange = useCallback(
    (materialPreset: string) => {
      if (!node || !materialTargetRole) return
      handleUpdate(buildRoofSurfaceMaterialPatch(node, materialTargetRole, undefined, materialPreset))
    },
    [handleUpdate, materialTargetRole, node],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleAddSegment = useCallback(() => {
    if (!node) return
    const segment = RoofSegmentNodeSchema.parse({
      width: 6,
      depth: 6,
      wallHeight: 0.5,
      roofHeight: 2.5,
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

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    sfxEmitter.emit('sfx:item-pick')

    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }
    // Offset slightly so it's visible
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1,
    ]

    try {
      const duplicate = RoofNodeSchema.parse(duplicateInfo)
      useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)

      // Also duplicate all child segments
      const nodesState = useScene.getState().nodes
      const children = node.children || []

      for (const childId of children) {
        const childNode = nodesState[childId]
        if (childNode && childNode.type === 'roof-segment') {
          let childDuplicateInfo = structuredClone(childNode) as any
          delete childDuplicateInfo.id
          childDuplicateInfo.metadata = { ...childDuplicateInfo.metadata, isNew: true }
          const childDuplicate = RoofSegmentNodeSchema.parse(childDuplicateInfo)
          useScene.getState().createNode(childDuplicate, duplicate.id as AnyNodeId)
        }
      }

      setSelection({ selectedIds: [] })
      setMovingNode(duplicate)
    } catch (e) {
      console.error('Failed to duplicate roof', e)
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
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'roof' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onClose={handleClose}
      title={node.name || 'Roof'}
      width={300}
    >
      <PanelSection title="Segments">
        <div className="flex flex-col gap-1">
          {segments.map((seg, i) => (
            <button
              className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
              key={seg.id}
              onClick={() => handleSelectSegment(seg.id)}
              type="button"
            >
              <span className="truncate">{seg.name || `Segment ${i + 1}`}</span>
              <span className="text-muted-foreground text-xs capitalize">{seg.roofType}</span>
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
        <SliderControl
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
        <SliderControl
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
        <SliderControl
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
        {!materialTargetRole ? (
          <div className="mb-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-[11px] text-muted-foreground">
            Click the roof surface you want to edit. Materials apply to one target at a time.
          </div>
        ) : null}
        {materialTargetRole ? (
          <MaterialPicker
            hideSideControl
            nodeType="roof"
            onChange={handleTargetedMaterialChange}
            onSelectMaterialPreset={handleTargetedMaterialPresetChange}
            selectedMaterialPreset={materialPickerValue.materialPreset}
            value={materialPickerValue.material}
          />
        ) : null}
      </PanelSection>
    </PanelWrapper>
  )
}
