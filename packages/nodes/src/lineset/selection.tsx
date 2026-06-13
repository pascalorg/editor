'use client'

import {
  type AnyNodeId,
  type LinesetNode,
  pauseSceneHistory,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { DimensionPill, EDITOR_LAYER, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { collectScenePorts, findNearestPortXZ, REFRIGERANT_PORT_SYSTEMS } from '../shared/ports'

const HANDLE_RADIUS = 0.08
const PORT_SNAP_RADIUS_M = 0.4

const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

type Point = [number, number, number]

/**
 * Selection-time editing for committed lineset runs: one draggable handle
 * per path point. Mirrors the duct-segment path-handle system, but dragged
 * run endpoints snap onto refrigerant ports only.
 *
 * Handles are PORTALED into the lineset's registered scene group so they
 * share its exact frame. Drag raycasts run in world space and convert hits
 * back into the group's local frame before writing the path.
 */
const LinesetSelectionAffordance = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const lineset = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const node = s.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'lineset' ? (node as LinesetNode) : null
  })

  const linesetId = lineset?.id ?? null
  const [target, setTarget] = useState<Object3D | null>(null)
  useEffect(() => {
    if (!linesetId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(linesetId as AnyNodeId) ?? null
      setTarget((cur) => (cur === next ? cur : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [linesetId])

  if (!lineset || !target) return null
  return createPortal(<LinesetPointHandles lineset={lineset} target={target} />, target, undefined)
}

const LinesetPointHandles = ({ lineset, target }: { lineset: LinesetNode; target: Object3D }) => {
  const { camera, gl } = useThree()
  const unit = useViewer((s) => s.unit)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const dragRef = useRef<{
    index: number
    initialPath: Point[]
    current: Point
    cleanup: () => void
  } | null>(null)

  const makeRay = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new Raycaster()
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray
  }

  const intersect = (clientX: number, clientY: number, plane: Plane): Vector3 | null => {
    const hit = new Vector3()
    return makeRay(clientX, clientY).intersectPlane(plane, hit) ? hit : null
  }

  const projectOntoAxis = (
    clientX: number,
    clientY: number,
    anchorWorld: Vector3,
    axisWorld: Vector3,
  ): number | null => {
    const ray = makeRay(clientX, clientY)
    const w0 = new Vector3().subVectors(ray.origin, anchorWorld)
    const b = ray.direction.dot(axisWorld)
    const denom = 1 - b * b
    if (Math.abs(denom) < 1e-6) return null
    const d0 = ray.direction.dot(w0)
    const e0 = axisWorld.dot(w0)
    return (e0 - b * d0) / denom
  }

  const toWorld = (p: Point): Vector3 => target.localToWorld(new Vector3(p[0], p[1], p[2]))
  const toLocal = (world: Vector3): Point => {
    const local = target.worldToLocal(world.clone())
    return [local.x, local.y, local.z]
  }

  const onHandleDown = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = lineset.path.map((p) => [...p] as Point)
    const startPoint = initialPath[index]!
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'grabbing'
    setDraggingIndex(index)

    const isEndpoint = index === 0 || index === initialPath.length - 1

    const neighbor = initialPath[index === 0 ? 1 : index - 1]!
    const axisLocal = new Vector3(
      startPoint[0] - neighbor[0],
      startPoint[1] - neighbor[1],
      startPoint[2] - neighbor[2],
    )
    if (axisLocal.lengthSq() < 1e-9) axisLocal.set(1, 0, 0)
    axisLocal.normalize()
    const anchorWorldStart = toWorld(startPoint)
    const axisWorld = toWorld([
      startPoint[0] + axisLocal.x,
      startPoint[1] + axisLocal.y,
      startPoint[2] + axisLocal.z,
    ])
      .sub(anchorWorldStart)
      .normalize()

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const current = drag.current
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      let next: Point | null = null
      if (event.altKey) {
        const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(current))
        const hit = intersect(event.clientX, event.clientY, plane)
        if (hit) {
          const local = toLocal(hit)
          next = [snap(local[0], step), current[1], snap(local[2], step)]
          if (isEndpoint) {
            const port = findNearestPortXZ(
              [local[0], current[1], local[2]],
              collectScenePorts({ excludeNodeId: lineset.id, systems: REFRIGERANT_PORT_SYSTEMS }),
              PORT_SNAP_RADIUS_M,
            )
            if (port) next = [port.position[0], port.position[1], port.position[2]]
          }
        }
      } else {
        const t = projectOntoAxis(event.clientX, event.clientY, anchorWorldStart, axisWorld)
        if (t !== null) {
          const dist = snap(t, step)
          next = [
            startPoint[0] + axisLocal.x * dist,
            Math.max(0, startPoint[1] + axisLocal.y * dist),
            startPoint[2] + axisLocal.z * dist,
          ]
        }
      }
      if (!next) return
      if (next[0] === current[0] && next[1] === current[1] && next[2] === current[2]) return
      drag.current = next
      const path = lineset.path.map((p, i) => (i === drag.index ? next! : p)) as Point[]
      useScene.getState().updateNode(lineset.id, { path })
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      drag.cleanup()
      dragRef.current = null
      setDraggingIndex(null)
      const finalPath = drag.initialPath.map((p, i) =>
        i === drag.index ? drag.current : p,
      ) as Point[]
      useScene.getState().updateNode(lineset.id, { path: drag.initialPath })
      resumeSceneHistory(useScene)
      const moved = finalPath[drag.index]!.some(
        (v, axis) => v !== drag.initialPath[drag.index]![axis],
      )
      if (moved) useScene.getState().updateNode(lineset.id, { path: finalPath })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
    }

    dragRef.current = { index, initialPath, current: startPoint, cleanup }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <group>
      {lineset.path.map((p, i) => {
        const active = draggingIndex === i
        const hovered = hoverIndex === i
        return (
          <mesh
            key={`lineset-handle-${i}`}
            layers={EDITOR_LAYER}
            onPointerDown={onHandleDown(i)}
            onPointerEnter={(e) => {
              e.stopPropagation()
              setHoverIndex(i)
              if (draggingIndex === null) document.body.style.cursor = 'grab'
            }}
            onPointerLeave={() => {
              setHoverIndex((prev) => (prev === i ? null : prev))
              if (draggingIndex === null) document.body.style.cursor = ''
            }}
            position={p as Point}
          >
            <sphereGeometry args={[HANDLE_RADIUS, 16, 12]} />
            <meshBasicMaterial
              color={active || hovered ? '#d68a5a' : '#b06b3f'}
              depthTest={false}
              opacity={active ? 1 : 0.85}
              transparent
            />
          </mesh>
        )
      })}
      {draggingIndex !== null &&
        lineset.path[draggingIndex] &&
        (() => {
          const point = lineset.path[draggingIndex]!
          const origin = dragRef.current?.initialPath[draggingIndex] ?? point
          const deltas = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]]
          const axes = ['x', 'y', 'z'] as const
          const primary = axes.reduce((best, axis, i) =>
            Math.abs(deltas[i]!) > Math.abs(deltas[axes.indexOf(best)]!) ? axis : best,
          )
          return (
            <Html
              center
              position={[point[0], point[1] + 0.35, point[2]]}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
              zIndexRange={[100, 0]}
            >
              <DimensionPill
                parts={axes.map((axis, i) => ({
                  key: axis,
                  prefix: axis.toUpperCase(),
                  value: deltas[i]!,
                  signed: true,
                }))}
                primary={primary}
                unit={unit}
              />
            </Html>
          )
        })()}
    </group>
  )
}

export default LinesetSelectionAffordance
