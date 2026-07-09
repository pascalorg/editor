'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveOverlayPolicy } from '../../lib/interaction/overlay-policy'
import useEditor from '../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../store/use-interaction-scope'
import { deleteSelection, duplicateSelectionAndPickUp, startGroupPickUp } from './group-actions'
import { classifyParticipant, computeGroupBox, expandToComponent } from './group-transform-shared'
import { NodeActionMenu } from './node-action-menu'
import { useMeshSettleEpoch } from './use-mesh-settle-epoch'

// Matches the single-node FloatingActionMenu's zoom-compensation constants.
const REF_ORTHO_ZOOM = 50
const REF_CAMERA_DISTANCE = 12
const MIN_MENU_SCALE = 0.6
const MAX_MENU_SCALE = 1.4
// Clearance above the group's bbox top so the pill doesn't sit on the meshes.
const MENU_Y_OFFSET = 0.42

/**
 * Floating Move / Duplicate / Delete pill for a MULTI-selection in the 3D
 * view — the group sibling of the single-node `FloatingActionMenu` (which is
 * sole-selection only). Anchored above the selection's bounding-box center;
 * every action targets the whole selection: Move picks the group up (it rides
 * the cursor until a click places it), Duplicate clones the selection and
 * picks the clones up, Delete removes everything selected.
 */
export function GroupFloatingActionMenu() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const mode = useEditor((s) => s.mode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const movingNode = useMovingNode()
  const nodes = useScene((s) => s.nodes)
  // Hard-hidden during any active interaction (drag, pick-up, reshape) so the
  // pill never competes with the live action — same policy as the 1-node menu.
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

  // World anchor above the group bbox. Depends on the scene (post-commit
  // positions), not the camera, and the menu hides during drags — so a
  // memo keyed on selection + nodes is enough, no per-frame box traversal.
  const meshEpoch = useMeshSettleEpoch(nodes)
  const anchor = useMemo(() => {
    if (participantIds.length === 0) return null
    const fullIds = expandToComponent(participantIds, nodes, levelId)
    const box = computeGroupBox(fullIds)
    if (!box) return null
    return new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y + MENU_Y_OFFSET,
      (box.min.z + box.max.z) / 2,
    )
    // biome-ignore lint/correctness/useExhaustiveDependencies: meshEpoch re-measures settled meshes
  }, [participantIds, nodes, levelId, meshEpoch])

  useFrame((state) => {
    // Scale the HTML pill with camera zoom / distance so it feels anchored to
    // the world — mirrors the single-node menu.
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
            onMove={handleMove}
            onPointerDown={stopPointer}
            onPointerUp={stopPointer}
          />
        </div>
      </Html>
    </group>
  )
}
