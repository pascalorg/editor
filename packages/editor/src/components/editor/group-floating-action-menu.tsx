'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveOverlayPolicy } from '../../lib/interaction/overlay-policy'
import { canCreateSessionGroup, selectionIntersectsSessionGroup } from '../../lib/session-groups'
import useEditor from '../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../store/use-interaction-scope'
import useSessionGroups, {
  groupCurrentSelection,
  ungroupCurrentSelection,
} from '../../store/use-session-groups'
import { deleteSelection, duplicateSelectionAndPickUp, startGroupPickUp } from './group-actions'
import { classifyParticipant, computeGroupBox, expandToComponent } from './group-transform-shared'
import { NodeActionMenu } from './node-action-menu'
import { useMeshSettleEpoch } from './use-mesh-settle-epoch'

const REF_ORTHO_ZOOM = 50
const REF_CAMERA_DISTANCE = 12
const MIN_MENU_SCALE = 0.6
const MAX_MENU_SCALE = 1.4
const MENU_Y_OFFSET = 0.42

/**
 * Floating pill for MULTI-selection in 3D: Move, Group, Ungroup, Duplicate, Delete.
 * Group/Ungroup are session-only (Ctrl/Cmd+G / Ctrl/Cmd+Shift+G).
 */
export function GroupFloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const mode = useEditor((s) => s.mode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const movingNode = useMovingNode()
  const nodes = useScene((s) => s.nodes)
  const sessionGroups = useSessionGroups((s) => s.groups)
  const scope = useInteractionScope((s) => s.scope)
  const menuStepBack = resolveOverlayPolicy(scope).conflictingControls === 'hidden'

  const groupRef = useRef<THREE.Group>(null)
  const menuScaleRef = useRef<HTMLDivElement>(null)

  const participantIds = useMemo(
    () =>
      selectedIds.length > 1
        ? selectedIds.filter(
            (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
          )
        : [],
    [selectedIds, levelId, nodes],
  )

  const liveIds = useMemo(() => new Set(Object.keys(nodes)), [nodes])
  // Always offer Group when multi-select is not already exactly a session group.
  const showGroup = useMemo(
    () => canCreateSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )
  // Ungroup when any selected member is in a session group.
  const showUngroup = useMemo(
    () => selectionIntersectsSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )

  const meshEpoch = useMeshSettleEpoch(nodes)
  const anchor = useMemo(() => {
    void meshEpoch
    if (participantIds.length === 0) return null
    const fullIds = expandToComponent(participantIds, nodes, levelId)
    const box = computeGroupBox(fullIds)
    if (!box) return null
    return new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y + MENU_Y_OFFSET,
      (box.min.z + box.max.z) / 2,
    )
  }, [participantIds, nodes, levelId, meshEpoch])

  useFrame((state) => {
    if (!(menuScaleRef.current && groupRef.current)) return
    const raw =
      state.camera instanceof THREE.OrthographicCamera
        ? state.camera.zoom / REF_ORTHO_ZOOM
        : REF_CAMERA_DISTANCE /
          Math.max(state.camera.position.distanceTo(groupRef.current.position), 0.001)
    const scale = Math.min(MAX_MENU_SCALE, Math.max(MIN_MENU_SCALE, raw))
    menuScaleRef.current.style.transform = `scale(${scale})`
  })

  const stopPointer = useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])
  const handleMove = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    startGroupPickUp()
  }, [])
  const handleGroup = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    groupCurrentSelection()
  }, [])
  const handleUngroup = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    ungroupCurrentSelection()
  }, [])
  const handleDuplicate = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    duplicateSelectionAndPickUp()
  }, [])
  const handleDelete = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    deleteSelection()
  }, [])

  if (!anchor || mode === 'delete' || isFloorplanHovered || movingNode || menuStepBack) {
    return null
  }

  return (
    <group position={anchor} ref={groupRef}>
      <Html
        center
        style={{
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
        zIndexRange={[25, 0]}
      >
        <div className="relative" ref={menuScaleRef} style={{ transformOrigin: 'center center' }}>
          <NodeActionMenu
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            onGroup={showGroup ? handleGroup : undefined}
            onMove={handleMove}
            onPointerDown={stopPointer}
            onPointerUp={stopPointer}
            onUngroup={showUngroup ? handleUngroup : undefined}
          />
        </div>
      </Html>
    </group>
  )
}
