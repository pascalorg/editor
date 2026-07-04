'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AssemblyNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SemanticEquipmentAssemblySection,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { LogOut, Move, Pencil, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { TransformPanelSection } from '../shared/transform-panel-section'

type Vector3 = [number, number, number]

function rounded(value: number, precision = 2) {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

function normalizeScale(scale: Vector3 | undefined): Vector3 {
  return scale ?? [1, 1, 1]
}

function signedMagnitude(value: number, magnitude: number) {
  return (value < 0 ? -1 : 1) * magnitude
}

function syncAssemblyObject(nodeId: AnyNodeId | undefined, updates: Partial<AssemblyNode>) {
  if (!nodeId) return
  useLiveTransforms.getState().clear(nodeId)
  const object = sceneRegistry.nodes.get(nodeId)
  if (!object) return
  if (updates.position) object.position.set(...updates.position)
  if (updates.rotation) object.rotation.set(...updates.rotation)
  if (updates.scale) object.scale.set(...updates.scale)
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
      syncAssemblyObject(selectedId as AnyNodeId, updates)
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const updateScale = useCallback(
    (value: number) => {
      if (!node) return
      const magnitude = Math.max(0.01, rounded(value))
      const scale = normalizeScale(node.scale)
      handleUpdate({
        scale: [
          signedMagnitude(scale[0], magnitude),
          signedMagnitude(scale[1], magnitude),
          signedMagnitude(scale[2], magnitude),
        ],
      })
    },
    [handleUpdate, node],
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

  if (!(node && node.type === 'assembly' && selectedId && selectedCount === 1)) return null
  const isEditingParts = editingAssemblyId === node.id
  const scale = normalizeScale(node.scale)
  const uniformScale = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]))

  return (
    <PanelWrapper
      icon={isEditingParts ? <Pencil className="h-4 w-4" /> : '/icons/cube.webp'}
      onClose={handleClose}
      title={node.name || '\u7ec4\u5408'}
      width={300}
    >
      <PanelSection title={'\u7ec4\u5408'}>
        <div className="rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-muted-foreground text-xs leading-5">
          {'\u5df2\u7ec4\u5408'} {childCount}{' '}
          {
            '\u4e2a\u90e8\u4ef6\u3002\u9009\u62e9\u7ec4\u5408\u53ef\u6574\u4f53\u79fb\u52a8\u3001\u65cb\u8f6c\u6216\u62ac\u9ad8\uff1b\u8fdb\u5165\u90e8\u4ef6\u7f16\u8f91\u53ef\u5355\u72ec\u9009\u62e9\u5b50\u7269\u4ef6\u3002'
          }
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
            label={
              isEditingParts ? '\u9000\u51fa\u90e8\u4ef6\u7f16\u8f91' : '\u7f16\u8f91\u90e8\u4ef6'
            }
            onClick={handleTogglePartEdit}
          />
        </ActionGroup>
      </PanelSection>
      <SemanticEquipmentAssemblySection nodeId={selectedId as AnyNodeId} />
      <PanelSection title={'\u7f29\u653e'}>
        <div className="space-y-2">
          <SliderControl
            label={'\u7b49\u6bd4\u7f29\u653e'}
            max={10}
            min={0.01}
            onChange={updateScale}
            precision={2}
            step={0.05}
            value={rounded(uniformScale)}
          />
          <div className="rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-muted-foreground text-xs leading-5">
            {
              '\u7f29\u653e\u5199\u5728\u7ec4\u5408\u6839\u8282\u70b9\u4e0a\uff0c\u5b50\u7269\u4ef6\u4fdd\u6301\u5c40\u90e8\u5750\u6807\uff0c\u7b49\u6bd4\u653e\u5927\u7f29\u5c0f\u4e0d\u4f1a\u6539\u6563\u90e8\u4ef6\u4f4d\u7f6e\u3002'
            }
          </div>
        </div>
      </PanelSection>
      <TransformPanelSection
        node={node}
        nodeId={selectedId as AnyNode['id']}
        onUpdate={handleUpdate}
      />

      <PanelSection title={'\u64cd\u4f5c'}>
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={'\u6574\u4f53\u79fb\u52a8'}
            onClick={handleMove}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={'\u5220\u9664'}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
