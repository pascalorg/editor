'use client'

import {
  type AnyNodeId,
  type CeilingNode,
  emitter,
  type GridEvent,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, Path, Shape, ShapeGeometry, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

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

export const MoveCeilingTool: React.FC<{ node: CeilingNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalPolygonRef = useRef(node.polygon.map(([x, z]) => [x, z] as [number, number]))
  const originalHolesRef = useRef(
    (node.holes ?? []).map((hole) => hole.map(([x, z]) => [x, z] as [number, number])),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const previousCursorPosRef = useRef<[number, number, number] | null>(null)
  const previousDeltaRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{
    polygon: Array<[number, number]>
    holes: Array<Array<[number, number]>>
  } | null>(null)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const center = getPolygonCenter(node.polygon)
    return [center[0], node.height ?? 2.5, center[1]]
  })
  const [previewPolygon, setPreviewPolygon] = useState<Array<[number, number]>>(node.polygon)
  const [previewHoles, setPreviewHoles] = useState<Array<Array<[number, number]>>>(node.holes ?? [])

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const originalPolygon = originalPolygonRef.current
    const originalHoles = originalHolesRef.current

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const applyPreview = (
      polygon: Array<[number, number]>,
      holes: Array<Array<[number, number]>>,
    ) => {
      previewRef.current = { polygon, holes }
      setPreviewPolygon(polygon)
      setPreviewHoles(holes)
      const center = getPolygonCenter(polygon)
      const nextCursorPos: [number, number, number] = [center[0], node.height ?? 2.5, center[1]]
      if (
        !previousCursorPosRef.current ||
        previousCursorPosRef.current[0] !== nextCursorPos[0] ||
        previousCursorPosRef.current[1] !== nextCursorPos[1] ||
        previousCursorPosRef.current[2] !== nextCursorPos[2]
      ) {
        previousCursorPosRef.current = nextCursorPos
        setCursorLocalPos(nextCursorPos)
      }
      useScene.getState().updateNode(node.id, { polygon, holes })
      useScene.getState().markDirty(node.id as AnyNodeId)
    }

    const restoreOriginal = () => {
      setPreviewPolygon(originalPolygon)
      setPreviewHoles(originalHoles)
      useScene.getState().updateNode(node.id, {
        holes: originalHoles,
        polygon: originalPolygon,
      })
      useScene.getState().markDirty(node.id as AnyNodeId)
    }

    const onGridMove = (event: GridEvent) => {
      const localX = snap(event.localPosition[0])
      const localZ = snap(event.localPosition[2])

      if (
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const deltaX = localX - anchor[0]
      const deltaZ = localZ - anchor[1]

      if (
        previousDeltaRef.current &&
        previousDeltaRef.current[0] === deltaX &&
        previousDeltaRef.current[1] === deltaZ
      ) {
        return
      }
      previousDeltaRef.current = [deltaX, deltaZ]

      applyPreview(
        translatePolygon(originalPolygon, deltaX, deltaZ),
        originalHoles.map((hole) => translatePolygon(hole, deltaX, deltaZ)),
      )
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const preview = previewRef.current ?? { polygon: originalPolygon, holes: originalHoles }

      wasCommitted = true

      // Restore original baseline while paused so the next resume+update
      // registers as a single tracked change (undo reverts to original).
      useScene.getState().updateNode(node.id, {
        polygon: originalPolygon,
        holes: originalHoles,
      })

      useScene.temporal.getState().resume()
      useScene.getState().updateNode(node.id, preview)
      useScene.getState().markDirty(node.id as AnyNodeId)
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode, node.height, node.id])

  const previewFillGeometry = useMemo(
    () => createCeilingPreviewGeometry(previewPolygon, previewHoles),
    [previewHoles, previewPolygon],
  )

  const previewOutlineGeometry = useMemo(
    () => createCeilingOutlineGeometry(previewPolygon),
    [previewPolygon],
  )

  return (
    <group>
      <mesh geometry={previewFillGeometry} position={[0, (node.height ?? 2.5) + 0.012, 0]}>
        <meshBasicMaterial
          color="#f5f5f4"
          depthWrite={false}
          opacity={0.3}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <threeLine geometry={previewOutlineGeometry} position={[0, (node.height ?? 2.5) + 0.02, 0]}>
        <lineBasicMaterial color="#ffffff" depthWrite={false} opacity={0.95} transparent />
      </threeLine>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

function createCeilingPreviewGeometry(
  polygon: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
): BufferGeometry {
  if (polygon.length < 3) return new BufferGeometry()

  const shape = new Shape()
  const [firstX, firstZ] = polygon[0]!
  shape.moveTo(firstX, -firstZ)

  for (let i = 1; i < polygon.length; i++) {
    const [x, z] = polygon[i]!
    shape.lineTo(x, -z)
  }
  shape.closePath()

  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue
    const hole = new Path()
    const [hx, hz] = holePolygon[0]!
    hole.moveTo(hx, -hz)
    for (let i = 1; i < holePolygon.length; i++) {
      const [x, z] = holePolygon[i]!
      hole.lineTo(x, -z)
    }
    hole.closePath()
    shape.holes.push(hole)
  }

  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

function createCeilingOutlineGeometry(polygon: Array<[number, number]>): BufferGeometry {
  const geometry = new BufferGeometry()
  if (polygon.length < 2) return geometry

  const points = polygon.map(([x, z]) => new Vector3(x, 0, z))
  const [firstX, firstZ] = polygon[0]!
  points.push(new Vector3(firstX, 0, firstZ))
  geometry.setFromPoints(points)
  return geometry
}
