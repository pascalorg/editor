'use client'

import {
  type AnyNodeId,
  type CeilingNode,
  emitter,
  type GridEvent,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { CursorSphere, markToolCancelConsumed, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'

/**
 * Phase 5 Stage D — ceiling whole-move tool.
 *
 * Live-drag pattern: translate the ceiling MESH visually via
 * `sceneRegistry.nodes.get(id).position` + a mirror in
 * `useLiveTransforms`. No `scene.update` during the drag — polygon CSG
 * with holes isn't rebuilt per tick. On commit we write the translated
 * polygon to the scene once; the legacy `CeilingSystem` resets the
 * mesh's X/Z position on rebuild (`mesh.position.x = 0`,
 * `mesh.position.z = 0`) so the visual transitions smoothly.
 *
 * 0.5m grid snap (matches legacy).
 */
function snap(value: number) {
  return Math.round(value * 2) / 2
}

function translatePolygon(
  polygon: Array<[number, number]>,
  deltaX: number,
  deltaZ: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number])
}

function getPolygonCenter(polygon: Array<[number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let sumX = 0
  let sumZ = 0
  for (const [x, z] of polygon) {
    sumX += x
    sumZ += z
  }
  return [sumX / polygon.length, sumZ / polygon.length]
}

function setMeshOffset(id: AnyNodeId, deltaX: number, deltaZ: number, height: number): void {
  const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
  // CeilingSystem positions the mesh at height−0.01 on rebuild; we
  // preserve the Y while offsetting X/Z during the drag.
  if (mesh) mesh.position.set(deltaX, height - 0.01, deltaZ)
}

export const MoveCeilingTool: React.FC<{ node: CeilingNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalPolygonRef = useRef(node.polygon.map(([x, z]) => [x, z] as [number, number]))
  const originalHolesRef = useRef(
    (node.holes ?? []).map((hole) => hole.map(([x, z]) => [x, z] as [number, number])),
  )
  const originalCenterRef = useRef(getPolygonCenter(originalPolygonRef.current))
  const heightRef = useRef(node.height ?? 2.5)
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const deltaRef = useRef<[number, number]>([0, 0])

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const c = originalCenterRef.current
    return [c[0], heightRef.current, c[1]]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const originalPolygon = originalPolygonRef.current
    const originalHoles = originalHolesRef.current
    const originalCenter = originalCenterRef.current
    const height = heightRef.current
    const ceilingId = node.id

    let wasCommitted = false

    const applyPreview = (deltaX: number, deltaZ: number) => {
      deltaRef.current = [deltaX, deltaZ]
      setMeshOffset(ceilingId as AnyNodeId, deltaX, deltaZ, height)
      useLiveTransforms.getState().set(ceilingId, {
        position: [originalCenter[0] + deltaX, height, originalCenter[1] + deltaZ],
        rotation: 0,
      })
      setCursorLocalPos([originalCenter[0] + deltaX, height, originalCenter[1] + deltaZ])
    }

    const clearPreview = () => {
      const mesh = sceneRegistry.nodes.get(ceilingId as AnyNodeId) as THREE.Object3D | undefined
      if (mesh) {
        mesh.position.x = 0
        mesh.position.z = 0
        // Leave Y at whatever the CeilingSystem set it to.
      }
      useLiveTransforms.getState().clear(ceilingId)
    }

    const onGridMove = (event: GridEvent) => {
      const localX = snap(event.localPosition[0])
      const localZ = snap(event.localPosition[2])

      if (
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      applyPreview(localX - anchor[0], localZ - anchor[1])
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const [deltaX, deltaZ] = deltaRef.current
      wasCommitted = true

      if (deltaX !== 0 || deltaZ !== 0) {
        useScene.getState().updateNode(ceilingId, {
          polygon: translatePolygon(originalPolygon, deltaX, deltaZ),
          holes: originalHoles.map((h) => translatePolygon(h, deltaX, deltaZ)),
        })
        useScene.getState().markDirty(ceilingId as AnyNodeId)
      }
      useLiveTransforms.getState().clear(ceilingId)

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [ceilingId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      clearPreview()
      useViewer.getState().setSelection({ selectedIds: [ceilingId] })
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        clearPreview()
      } else {
        useLiveTransforms.getState().clear(ceilingId)
      }
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode, node.id])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

export default MoveCeilingTool
