'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type DoorNode,
  type FenceNode,
  type ItemNode,
  type RoofNode,
  type RoofSegmentNode,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  useScene,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useState } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CeilingPanel } from './ceiling-panel'
import { DoorPanel } from './door-panel'
import { FencePanel } from './fence-panel'
import { ItemPanel } from './item-panel'
import { MobilePanelSheet } from './mobile-panel-sheet'
import { MobileSelectionBar } from './mobile-selection-bar'
import { getNodeDisplay } from './node-display'
import { PaintPanel } from './paint-panel'
import { ReferencePanel } from './reference-panel'
import { RoofPanel } from './roof-panel'
import { RoofSegmentPanel } from './roof-segment-panel'
import { SlabPanel } from './slab-panel'
import { StairPanel } from './stair-panel'
import { StairSegmentPanel } from './stair-segment-panel'
import { WallPanel } from './wall-panel'
import { WindowPanel } from './window-panel'

type MovableNode =
  | ItemNode
  | WindowNode
  | DoorNode
  | CeilingNode
  | SlabNode
  | WallNode
  | FenceNode
  | RoofNode
  | RoofSegmentNode
  | StairNode
  | StairSegmentNode
  | BuildingNode

const MOVABLE_TYPES = new Set<string>([
  'item',
  'window',
  'door',
  'ceiling',
  'slab',
  'wall',
  'fence',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'building',
])

function isMovableNode(node: AnyNode | null): node is MovableNode {
  return !!node && MOVABLE_TYPES.has(node.type)
}

function panelForType(type: string | null) {
  if (!type) return null
  switch (type) {
    case 'item':
      return <ItemPanel />
    case 'roof':
      return <RoofPanel />
    case 'roof-segment':
      return <RoofSegmentPanel />
    case 'stair':
      return <StairPanel />
    case 'stair-segment':
      return <StairSegmentPanel />
    case 'slab':
      return <SlabPanel />
    case 'ceiling':
      return <CeilingPanel />
    case 'wall':
      return <WallPanel />
    case 'fence':
      return <FencePanel />
    case 'door':
      return <DoorPanel />
    case 'window':
      return <WindowPanel />
    default:
      return null
  }
}

function MobilePanelLayer({
  node,
  panel,
  isReference,
}: {
  node: AnyNode | null
  panel: React.ReactNode
  isReference: boolean
}) {
  const setSelection = useViewer((s) => s.setSelection)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  // Reset sheet open state when the selection changes / clears
  const selectionKey = node?.id ?? (isReference ? 'reference' : null)
  useEffect(() => {
    setIsSheetOpen(false)
  }, [selectionKey])

  const clearSelection = useCallback(() => {
    setSelection({ selectedIds: [] })
    setSelectedReferenceId(null)
  }, [setSelection, setSelectedReferenceId])

  const handleMove = useCallback(() => {
    if (!isMovableNode(node)) return
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node)
    clearSelection()
  }, [node, setMovingNode, clearSelection])

  const handleDuplicate = useCallback(() => {
    if (!isMovableNode(node)) return
    sfxEmitter.emit('sfx:item-pick')
    const cloned = structuredClone(node) as MovableNode & { id?: AnyNodeId }
    delete (cloned as { id?: AnyNodeId }).id
    const prevMeta =
      cloned.metadata && typeof cloned.metadata === 'object' && !Array.isArray(cloned.metadata)
        ? (cloned.metadata as Record<string, unknown>)
        : {}
    cloned.metadata = { ...prevMeta, isNew: true }
    setMovingNode(cloned as MovableNode)
    clearSelection()
  }, [node, setMovingNode, clearSelection])

  const handleDelete = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-delete')
    deleteNode(node.id)
    clearSelection()
  }, [node, deleteNode, clearSelection])

  if (!(node || isReference)) return null

  const display = getNodeDisplay(node)

  return (
    <>
      {node && (
        <MobileSelectionBar
          node={node}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onEdit={() => setIsSheetOpen((v) => !v)}
          onMove={handleMove}
        />
      )}
      <MobilePanelSheet
        icon={display.icon}
        onClose={() => setIsSheetOpen(false)}
        open={isSheetOpen}
        title={display.label}
      >
        {panel}
      </MobilePanelSheet>
    </>
  )
}

export function PanelManager() {
  const isMobile = useIsMobile()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const isPaintPanelOpen = useEditor((s) => s.isPaintPanelOpen)
  const mode = useEditor((s) => s.mode)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  // Only subscribe to the *type* of the single-selected node — string primitive
  // so we don't re-render on unrelated scene mutations.
  const selectedNodeType = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const id = selectedIds[0]
    return id ? (s.nodes[id as AnyNodeId]?.type ?? null) : null
  })
  const selectedNode = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const id = selectedIds[0]
    return id ? (s.nodes[id as AnyNodeId] ?? null) : null
  })

  if (isMobile) {
    if (selectedReferenceId) {
      return <MobilePanelLayer isReference={true} node={null} panel={<ReferencePanel />} />
    }
    return (
      <MobilePanelLayer
        isReference={false}
        node={selectedNode}
        panel={panelForType(selectedNodeType)}
      />
    )
  }

  // Show reference panel if a reference is selected
  if (selectedReferenceId) {
    return <ReferencePanel />
  }

  if (
    isPaintPanelOpen &&
    mode === 'material-paint' &&
    activePaintMaterial?.material?.properties &&
    !activePaintMaterial.materialPreset
  ) {
    return <PaintPanel />
  }

  // Show appropriate panel based on selected node type
  return panelForType(selectedNodeType)
}
