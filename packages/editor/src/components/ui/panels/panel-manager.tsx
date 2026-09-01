'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type ChimneyNode,
  type ColumnNode,
  type DoorNode,
  type DormerNode,
  type ElevatorNode,
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
import { useTranslations } from '../../../lib/i18n'
import { shouldShowEditingControls } from '../../../lib/interaction/overlay-policy'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { deleteSelection, duplicateSelectionAndPickUp, startGroupPickUp } from '../../editor/group-actions'
import { resolveHomogeneousSelection } from './homogeneous-selection'
import { MobilePanelSheet } from './mobile-panel-sheet'
import { MobileSelectionBar } from './mobile-selection-bar'
import { MultiParametricInspector } from './multi-parametric-inspector'
import { MultiSelectionPanel } from './multi-selection-panel'
import { getNodeDisplay, getTypeDisplay } from './node-display'
import { resetDesktopInspectorCollapsed } from './panel-wrapper'
import { ParametricInspector } from './parametric-inspector'
import { ReferencePanel } from './reference-panel'
import { formatSelectionBreakdown } from './selection-breakdown'

type MovableNode =
  | ItemNode
  | WindowNode
  | DoorNode
  | ElevatorNode
  | CeilingNode
  | ChimneyNode
  | ColumnNode
  | DormerNode
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
  'elevator',
  'ceiling',
  'chimney',
  'column',
  'dormer',
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

function panelForType(type: string | null, footer?: React.ReactNode) {
  if (!type) return null
  // Every kind now renders through `<ParametricInspector>`, which either
  // composes auto-derived editors from `parametrics.groups` or lazy-
  // loads the kind-owned panel via `parametrics.customPanel`. The
  // hardcoded switch is gone — all per-kind panel layout lives in
  // `nodes/src/<kind>/panel.tsx`. The `type` arg is preserved for
  // future cases where we might want a non-registry fallback (e.g.
  // reference scale, paint mode); leave the function shape intact.
  void type
  return <ParametricInspector footer={footer} />
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
  const t = useTranslations()
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

  const display = getNodeDisplay(node, t)

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

function MobileMultiPanelLayer({
  breakdown,
  panel,
  type,
}: {
  breakdown: string
  panel: React.ReactNode
  type: string | null
}) {
  const t = useTranslations()
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const display = type ? getTypeDisplay(type, t) : { icon: '/icons/select.webp', label: t('panel.selection') }
  const title = breakdown || display.label

  useEffect(() => {
    setIsSheetOpen(false)
  }, [breakdown])

  return (
    <>
      <MobileSelectionBar
        icon={display.icon}
        label={title}
        node={null}
        onDelete={() => deleteSelection()}
        onDuplicate={() => duplicateSelectionAndPickUp()}
        onEdit={() => setIsSheetOpen((v) => !v)}
        onMove={() => startGroupPickUp()}
      />
      <MobilePanelSheet
        icon={display.icon}
        onClose={() => setIsSheetOpen(false)}
        open={isSheetOpen}
        title={title}
      >
        {panel}
      </MobilePanelSheet>
    </>
  )
}

export function PanelManager({
  inspectorFooter,
  multiSelectionFooter,
}: {
  inspectorFooter?: React.ReactNode
  multiSelectionFooter?: React.ReactNode
}) {
  const t = useTranslations()
  const isMobile = useIsMobile()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedZoneId = useViewer((s) => s.selection.zoneId)
  const setSelection = useViewer((s) => s.setSelection)
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const readOnly = useScene((s) => s.readOnly)
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
  const homogeneousType = useScene((s) =>
    selectedIds.length > 1 ? resolveHomogeneousSelection(selectedIds, s.nodes) : null,
  )
  const multiBreakdown = useScene((s) =>
    selectedIds.length > 1
      ? formatSelectionBreakdown(
          selectedIds.map((id) => s.nodes[id as AnyNodeId]?.type),
          t,
        )
      : '',
  )

  // Node and reference selection are mutually exclusive: selecting a guide
  // clears the node selection (handleGuideSelect), but node selection never
  // cleared a lingering reference — so clicking a wall with a floorplan
  // selected kept showing the reference panel. Clear the stale reference the
  // moment a scene selection appears.
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  useEffect(() => {
    if (selectedIds.length > 0 || selectedZoneId) {
      setSelectedReferenceId(null)
    }
  }, [selectedIds, selectedZoneId, setSelectedReferenceId])

  // The inspector's expanded state is shared across panel swaps, but a fresh
  // selection after everything was deselected should open collapsed again.
  const hasAnySelection = selectedIds.length > 0 || Boolean(selectedZoneId) || Boolean(selectedReferenceId)
  useEffect(() => {
    if (!hasAnySelection) {
      resetDesktopInspectorCollapsed()
    }
  }, [hasAnySelection])

  if (!shouldShowEditingControls(readOnly)) return null

  if (isMobile) {
    if (selectedReferenceId) {
      return <MobilePanelLayer isReference={true} node={null} panel={<ReferencePanel />} />
    }
    if (selectedIds.length > 1) {
      return (
        <MobileMultiPanelLayer
          breakdown={multiBreakdown}
          panel={
            homogeneousType ? (
              <MultiParametricInspector footer={multiSelectionFooter} />
            ) : (
              <MultiSelectionPanel footer={multiSelectionFooter} />
            )
          }
          type={homogeneousType}
        />
      )
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

  if (selectedZoneId && selectedIds.length === 0) {
    return (
      <ParametricInspector
        footer={inspectorFooter}
        key={selectedZoneId}
        nodeId={selectedZoneId as AnyNodeId}
        onClose={() => setSelection({ zoneId: null })}
      />
    )
  }

  // Multi-selection: parametric inspector when every resolved id shares a type,
  // otherwise the actions-only panel. Mobile uses the same panels in a sheet.
  if (selectedIds.length > 1) {
    if (homogeneousType) {
      return <MultiParametricInspector footer={multiSelectionFooter} />
    }
    return <MultiSelectionPanel footer={multiSelectionFooter} />
  }

  return panelForType(selectedNodeType, inspectorFooter)
}
