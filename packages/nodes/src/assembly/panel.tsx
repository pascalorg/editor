'use client'

import { type AnyNode, type AnyNodeId, type AssemblyNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { LogOut, Move, Pencil, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

const POSITION_NUDGE = 0.1
const ROTATION_NUDGE_DEGREES = 45
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

function rounded(value: number, precision = 2) {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

export default function AssemblyPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const editingAssemblyId = useEditor((s) => s.editingAssemblyId)
  const setEditingAssemblyId = useEditor((s) => s.setEditingAssemblyId)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as AssemblyNode | undefined) : undefined,
  )
  const childCount = useScene((s) => {
    const selectedNode = selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as AssemblyNode | undefined)
      : undefined
    return selectedNode?.children
      ? selectedNode.children.filter((childId) => Boolean(s.nodes[childId as AnyNodeId])).length
      : 0
  })

  const handleUpdate = useCallback(
    (updates: Partial<AssemblyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    if (node && editingAssemblyId === node.id) {
      setEditingAssemblyId(null)
    }
    setSelection({ selectedIds: [] })
  }, [editingAssemblyId, node, setEditingAssemblyId, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setEditingAssemblyId(null)
    setSelection({ selectedIds: [] })
  }, [deleteNode, node, selectedId, setEditingAssemblyId, setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setEditingAssemblyId(null)
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setEditingAssemblyId, setMovingNode, setSelection])

  const handleTogglePartEdit = useCallback(() => {
    if (!node) return
    const isEditing = editingAssemblyId === node.id
    setEditingAssemblyId(isEditing ? null : (node.id as AnyNodeId))
    if (!isEditing) {
      setSelection({ selectedIds: [node.id as AnyNodeId] })
    }
  }, [editingAssemblyId, node, setEditingAssemblyId, setSelection])

  const handleNudgeY = useCallback(
    (delta: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const position = [...node.position] as [number, number, number]
      position[1] = rounded(position[1] + delta)
      handleUpdate({ position })
    },
    [handleUpdate, node],
  )

  const handleNudgeRotation = useCallback(
    (degrees: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const rotation = [...node.rotation] as [number, number, number]
      rotation[1] = rounded(rotation[1] + degrees * DEG_TO_RAD, 4)
      handleUpdate({ rotation })
    },
    [handleUpdate, node],
  )

  if (!(node && node.type === 'assembly' && selectedId && selectedCount === 1)) return null

  const isEditingParts = editingAssemblyId === node.id
  const angleDegrees = Math.round((node.rotation[1] ?? 0) * RAD_TO_DEG)

  return (
    <PanelWrapper
      icon={isEditingParts ? <Pencil className="h-4 w-4" /> : '/icons/cube.png'}
      onClose={handleClose}
      title={node.name || 'Assembly'}
      width={300}
    >
      <PanelSection title="Assembly">
        <div className="rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-muted-foreground text-xs leading-5">
          {childCount} part{childCount === 1 ? '' : 's'} grouped. Select the assembly to move,
          rotate, or raise the whole object; enter part edit to select a single child.
        </div>
        <ActionGroup>
          <ActionButton
            icon={
              isEditingParts ? (
                <LogOut className="h-3.5 w-3.5" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )
            }
            label={isEditingParts ? 'Exit part edit' : 'Edit parts'}
            onClick={handleTogglePartEdit}
          />
        </ActionGroup>
      </PanelSection>

      <PanelSection title="Whole transform">
        <MetricControl
          label="Height"
          max={50}
          min={-50}
          onChange={(value) => {
            const position = [...node.position] as [number, number, number]
            position[1] = value
            handleUpdate({ position })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={rounded(node.position[1])}
        />
        <div className="flex items-center gap-1.5">
          <ActionButton label="Down" onClick={() => handleNudgeY(-POSITION_NUDGE)} />
          <ActionButton label="Up" onClick={() => handleNudgeY(POSITION_NUDGE)} />
        </div>
        <SliderControl
          label="Angle"
          max={180}
          min={-180}
          onChange={(degrees) => {
            const rotation = [...node.rotation] as [number, number, number]
            rotation[1] = degrees * DEG_TO_RAD
            handleUpdate({ rotation })
          }}
          precision={0}
          step={1}
          unit="°"
          value={angleDegrees}
        />
        <div className="flex items-center gap-1.5">
          <ActionButton label="-45°" onClick={() => handleNudgeRotation(-ROTATION_NUDGE_DEGREES)} />
          <ActionButton label="+45°" onClick={() => handleNudgeRotation(ROTATION_NUDGE_DEGREES)} />
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label="Move whole"
            onClick={handleMove}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
