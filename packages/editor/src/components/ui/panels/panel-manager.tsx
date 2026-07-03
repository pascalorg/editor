'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AssemblyNode,
  type BuildingNode,
  type CeilingNode,
  type ColumnNode,
  type DoorNode,
  type ElevatorNode,
  type FenceNode,
  type ItemNode,
  type LadderNode,
  type RoofNode,
  type RoofSegmentNode,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  type SteelBeamNode,
  type SteelFrameNode,
  useScene,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { useCallback, useEffect, useState } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { duplicateNodeSubtree } from '../../../lib/subtree-duplication'
import useEditor from '../../../store/use-editor'
import { MobilePanelSheet } from './mobile-panel-sheet'
import { MobileSelectionBar } from './mobile-selection-bar'
import { getNodeDisplay } from './node-display'
import { PaintPanel } from './paint-panel'
import { ParametricInspector } from './parametric-inspector'
import { ReferencePanel } from './reference-panel'

type MovableNode =
  | AssemblyNode
  | ItemNode
  | WindowNode
  | DoorNode
  | ElevatorNode
  | CeilingNode
  | ColumnNode
  | SlabNode
  | WallNode
  | FenceNode
  | RoofNode
  | RoofSegmentNode
  | StairNode
  | StairSegmentNode
  | LadderNode
  | SteelBeamNode
  | SteelFrameNode
  | BuildingNode

const MOVABLE_TYPES = new Set<string>([
  'assembly',
  'item',
  'window',
  'door',
  'elevator',
  'ceiling',
  'column',
  'slab',
  'wall',
  'fence',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'ladder',
  'steel-beam',
  'steel-frame',
  'building',
])

function isMovableNode(node: AnyNode | null): node is MovableNode {
  return !!node && MOVABLE_TYPES.has(node.type)
}

function hasChildren(node: AnyNode): node is AnyNode & { children: AnyNodeId[] } {
  return 'children' in node && Array.isArray(node.children) && node.children.length > 0
}

function panelForType(type: string | null) {
  if (!type) return null
  // Every kind now renders through `<ParametricInspector>`, which either
  // composes auto-derived editors from `parametrics.groups` or lazy-
  // loads the kind-owned panel via `parametrics.customPanel`. The
  // hardcoded switch is gone — all per-kind panel layout lives in
  // `nodes/src/<kind>/panel.tsx`. The `type` arg is preserved for
  // future cases where we might want a non-registry fallback (e.g.
  // reference scale, paint mode); leave the function shape intact.
  void type
  return <ParametricInspector />
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
    setSelection({ selectedIds: [], zoneId: null })
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

    if (hasChildren(node)) {
      try {
        const { root } = duplicateNodeSubtree(node.id as AnyNodeId, { markRootNew: true })
        if (isMovableNode(root)) {
          setMovingNode(root)
          clearSelection()
        }
      } catch (error) {
        console.error('Failed to duplicate selected subtree', error)
      }
      return
    }

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
  const selectedZoneId = useViewer((s) => s.selection.zoneId)
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const isPaintPanelOpen = useEditor((s) => s.isPaintPanelOpen)
  const mode = useEditor((s) => s.mode)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  // Only subscribe to the *type* of the single-selected node — string primitive
  // so we don't re-render on unrelated scene mutations.
  const selectedNodeType = useScene((s) => {
    if (selectedIds.length > 1) return null
    const id = selectedIds[0] ?? selectedZoneId
    return id ? (s.nodes[id as AnyNodeId]?.type ?? null) : null
  })
  const selectedNode = useScene((s) => {
    if (selectedIds.length > 1) return null
    const id = selectedIds[0] ?? selectedZoneId
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

  return panelForType(selectedNodeType)
}
