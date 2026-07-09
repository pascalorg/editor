'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import useEditor from '../../store/use-editor'
import { useMovingNode } from '../../store/use-interaction-scope'
import { useFloorplanGroupDrag } from '../editor-2d/floorplan-group-move'
import { armGroupMove3d } from './group-move-3d'
import {
  classifyParticipant,
  computeGroupBox,
  expandToComponent,
  levelFrame,
} from './group-transform-shared'
import { useMeshSettleEpoch } from './use-mesh-settle-epoch'

// Matches the 2D dashed selection box's stroke.
const BOX_COLOR = '#3b82f6'
// Small clearance so the dashes don't z-fight the selection's outer faces.
const BOX_PAD = 0.06

/**
 * 3D sibling of the 2D dashed group selection box: a dashed wireframe around
 * the multi-selection's transformable participants (expanded to the welded
 * wall/fence component) that doubles as the group's whole-volume drag
 * handle — move cursor across it, press-drag anywhere on it slides the group,
 * a plain click picks it up. Holding a selection modifier passes the press
 * through so members inside can still be toggled. Rides the live drag delta
 * so it tracks the group mid-gesture.
 */
export function GroupSelectionBox3D() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)
  const mode = useEditor((s) => s.mode)
  const movingNode = useMovingNode()
  const delta = useFloorplanGroupDrag((s) => s.delta)
  const { camera, raycaster, gl } = useThree()

  const participantIds = useMemo(
    () =>
      selectedIds.length > 1
        ? selectedIds.filter(
            (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
          )
        : [],
    [selectedIds, levelId, nodes],
  )

  // Re-measure once the meshes settle after a scene change (undo included).
  const meshEpoch = useMeshSettleEpoch(nodes)
  const box = useMemo(() => {
    if (participantIds.length === 0) return null
    const fullIds = expandToComponent(participantIds, nodes, levelId)
    const world = computeGroupBox(fullIds)
    if (!world) return null
    const size = new THREE.Vector3()
    world.getSize(size)
    const center = new THREE.Vector3()
    world.getCenter(center)
    return {
      size: [size.x + 2 * BOX_PAD, size.y + 2 * BOX_PAD, size.z + 2 * BOX_PAD] as [
        number,
        number,
        number,
      ],
      center,
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: meshEpoch re-measures settled meshes
  }, [participantIds, nodes, levelId, meshEpoch])

  // Dashed wireframe. Built per box size (rare — selection / commit changes)
  // because LineDashedMaterial measures dashes along the line, so scaling a
  // unit box would stretch them per axis.
  const edges = useMemo(() => {
    if (!box) return null
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...box.size))
    const line = new THREE.LineSegments(
      geometry,
      new THREE.LineDashedMaterial({
        color: BOX_COLOR,
        dashSize: 0.18,
        gapSize: 0.12,
        opacity: 0.9,
        transparent: true,
      }),
    )
    line.computeLineDistances()
    return line
  }, [box])
  useEffect(
    () => () => {
      if (edges) {
        edges.geometry.dispose()
        ;(edges.material as THREE.Material).dispose()
      }
    },
    [edges],
  )

  // Mid-drag the sessions publish a level-frame delta; map it to world so the
  // box rides the group (shared with the 2D box's store).
  const worldOffset = useMemo(() => {
    if (!delta) return null
    const { matrix } = levelFrame(levelId)
    const origin = new THREE.Vector3().applyMatrix4(matrix)
    return new THREE.Vector3(delta[0], 0, delta[1]).applyMatrix4(matrix).sub(origin)
  }, [delta, levelId])

  if (!box || !edges || movingNode || mode !== 'select') return null

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    const native = event.nativeEvent
    if (native.button !== 0) return
    // A selection modifier passes through so members inside the box can
    // still be toggled in and out of the selection.
    if (native.metaKey || native.ctrlKey || native.shiftKey || native.altKey) return
    const { selectedIds: currentIds, levelId: currentLevelId } = useViewer.getState().selection
    const sceneNodes = useScene.getState().nodes
    const anchor = currentIds.find(
      (id) => classifyParticipant(sceneNodes[id as AnyNodeId], currentLevelId, sceneNodes) !== null,
    )
    if (!anchor) return
    const armed = armGroupMove3d({
      nodeId: anchor as AnyNodeId,
      clientX: native.clientX,
      clientY: native.clientY,
      pointerId: native.pointerId,
      nativeEvent: native,
      camera,
      raycaster,
      domElement: gl.domElement,
    })
    // Own the press: deeper hits (members, ground) must not also select.
    if (armed) event.stopPropagation()
  }

  // Set on move (not just enter): the canvas may carry an app default
  // cursor, and member hovers inside the box write theirs — keep 'move'
  // asserted across the whole volume, except while a drag shows 'grabbing'.
  const applyMoveCursor = () => {
    const cursor = gl.domElement.style.cursor
    if (cursor !== 'move' && cursor !== 'grabbing') gl.domElement.style.cursor = 'move'
  }
  const handlePointerLeave = () => {
    if (gl.domElement.style.cursor === 'move') gl.domElement.style.cursor = ''
  }

  const position: [number, number, number] = [
    box.center.x + (worldOffset?.x ?? 0),
    box.center.y + (worldOffset?.y ?? 0),
    box.center.z + (worldOffset?.z ?? 0),
  ]

  return (
    <group position={position}>
      <primitive object={edges} />
      {/* Invisible whole-volume hit target — the box IS the drag handle. */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerEnter={applyMoveCursor}
        onPointerLeave={handlePointerLeave}
        onPointerMove={applyMoveCursor}
      >
        <boxGeometry args={box.size} />
        <meshBasicMaterial depthWrite={false} opacity={0} transparent />
      </mesh>
    </group>
  )
}
