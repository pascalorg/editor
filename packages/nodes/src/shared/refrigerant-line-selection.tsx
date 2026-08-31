'use client'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type Cursor,
  type LinesetNode,
  type LiquidLineNode,
  type PortConnectivity,
  pauseSceneHistory,
  resolveConnectivityUpdates,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { DimensionPill, swallowNextClick, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { collectScenePorts, findNearestPortXZ, REFRIGERANT_PORT_SYSTEMS } from './ports'
import { HandleCube, MoveChevron } from './selection-handles'

type RefrigerantLineKind = 'lineset' | 'liquid-line'
type RefrigerantLineNode = LinesetNode | LiquidLineNode
type Point = [number, number, number]
type DragKind =
  | { axis: 'y'; along?: boolean }
  | { axis: 'horizontal'; dir: [number, number]; along: boolean }
type EndpointArrow = {
  key: string
  index: number
  kind: DragKind
  position: Point
  rotationY: number
  vertical?: 'up' | 'down'
  cursor: Cursor
}

const PORT_SNAP_RADIUS_M = 0.4
const ARROW_GAP = 0.28
const ARROW_MIN_OFFSET = 0.4
const INCHES_TO_METERS = 0.0254
const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function lineRadiusM(line: RefrigerantLineNode): number {
  if (line.type === 'lineset') {
    return (Math.max(line.suctionDiameter, line.liquidDiameter) * INCHES_TO_METERS) / 2
  }
  return (line.diameter * INCHES_TO_METERS) / 2
}

function selectedLineOfKind(
  kind: RefrigerantLineKind,
  id: AnyNodeId | undefined,
): RefrigerantLineNode | null {
  if (!id) return null
  const node = useScene.getState().nodes[id]
  if (kind === 'lineset' && node?.type === 'lineset') return node as LinesetNode
  if (kind === 'liquid-line' && node?.type === 'liquid-line') return node as LiquidLineNode
  return null
}

export function createRefrigerantLineSelectionAffordance(kind: RefrigerantLineKind) {
  const RefrigerantLineSelectionAffordance = () => {
    const selectedIds = useViewer((s) => s.selection.selectedIds)
    const selectedId = selectedIds.length === 1 ? (selectedIds[0] as AnyNodeId) : undefined
    const line = useScene(() => selectedLineOfKind(kind, selectedId))

    const lineId = line?.id ?? null
    const [target, setTarget] = useState<Object3D | null>(null)
    useEffect(() => {
      if (!lineId) {
        setTarget(null)
        return
      }
      let frameId = 0
      const resolve = () => {
        const next = sceneRegistry.nodes.get(lineId as AnyNodeId) ?? null
        setTarget((cur) => (cur === next ? cur : next))
        if (!next) frameId = window.requestAnimationFrame(resolve)
      }
      resolve()
      return () => window.cancelAnimationFrame(frameId)
    }, [lineId])

    if (!line || !target) return null
    const mount = target.parent ?? target
    return createPortal(
      <RefrigerantLineEndpointHandles line={line} target={target} />,
      mount,
      undefined,
    )
  }

  return RefrigerantLineSelectionAffordance
}

function RefrigerantLineEndpointHandles({
  line,
  target,
}: {
  line: RefrigerantLineNode
  target: Object3D
}) {
  const { camera, gl } = useThree()
  const outerRef = useRef<Group>(null)
  useFrame(() => {
    const outer = outerRef.current
    if (!outer) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })

  const unit = useViewer((s) => s.unit)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [openCluster, setOpenCluster] = useState<number | null>(null)
  const toggleCluster = (index: number) => setOpenCluster((cur) => (cur === index ? null : index))
  const dragRef = useRef<{
    index: number
    initialPath: Point[]
    current: Point
    cleanup: () => void
    connectivity: PortConnectivity | null
    detached: boolean
  } | null>(null)

  const followUpdates = (
    connectivity: PortConnectivity | null,
    path: Point[],
  ): { id: AnyNodeId; data: Partial<AnyNode> }[] => {
    if (!connectivity) return []
    const preview = { ...(line as unknown as Record<string, unknown>), path } as AnyNode
    return resolveConnectivityUpdates(connectivity, preview).filter(
      (u) => useScene.getState().nodes[u.id],
    )
  }

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

  const intersectVerticalY = (
    clientX: number,
    clientY: number,
    anchorWorld: Vector3,
  ): number | null => {
    const forward = camera.getWorldDirection(new Vector3())
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1)
    forward.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(forward, anchorWorld)
    const hit = intersect(clientX, clientY, plane)
    return hit ? toLocal(hit)[1] : null
  }

  const swingHorizontal = (event: PointerEvent, pivot: Point, startPoint: Point): Point | null => {
    const r = Math.hypot(
      startPoint[0] - pivot[0],
      startPoint[1] - pivot[1],
      startPoint[2] - pivot[2],
    )
    if (r < 1e-6) return null
    const verticalN = (startPoint[1] - pivot[1]) / r
    const horizN = Math.sqrt(Math.max(0, 1 - verticalN * verticalN))
    const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(pivot))
    const hit = intersect(event.clientX, event.clientY, plane)
    if (!hit) return null
    const local = toLocal(hit)
    const bx = local[0] - pivot[0]
    const bz = local[2] - pivot[2]
    const blen = Math.hypot(bx, bz)
    if (blen < 1e-6) return null
    return [(bx / blen) * horizN, verticalN, (bz / blen) * horizN]
  }

  const swingVertical = (event: PointerEvent, pivot: Point, startPoint: Point): Point | null => {
    let hx = startPoint[0] - pivot[0]
    let hz = startPoint[2] - pivot[2]
    let hlen = Math.hypot(hx, hz)
    if (hlen < 1e-6) {
      const forward = camera.getWorldDirection(new Vector3())
      hx = forward.x
      hz = forward.z
      hlen = Math.hypot(hx, hz)
      if (hlen < 1e-6) {
        hx = 0
        hz = 1
        hlen = 1
      }
    }
    const headingWorld = new Vector3(hx / hlen, 0, hz / hlen)
    const normal = new Vector3().crossVectors(UP, headingWorld).normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, toWorld(pivot))
    const hit = intersect(event.clientX, event.clientY, plane)
    if (!hit) return null
    const local = toLocal(hit)
    const ax = local[0] - pivot[0]
    const ay = local[1] - pivot[1]
    const az = local[2] - pivot[2]
    const len = Math.hypot(ax, ay, az)
    if (len < 1e-6) return null
    return [ax / len, ay / len, az / len]
  }

  const toWorld = (p: Point): Vector3 => target.localToWorld(new Vector3(p[0], p[1], p[2]))
  const toLocal = (world: Vector3): Point => {
    const local = target.worldToLocal(world.clone())
    return [local.x, local.y, local.z]
  }

  const onHandleDown = (index: number, kind: DragKind) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = line.path.map((p) => [...p] as Point)
    const startPoint = initialPath[index]!
    const connectivity = analyzePortConnectivity(line as AnyNode, useScene.getState().nodes)
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = kind.axis === 'y' ? 'ns-resize' : 'grabbing'
    setDraggingIndex(index)

    const isEndpoint = index === 0 || index === initialPath.length - 1
    const swings = kind.axis === 'y' ? kind.along !== true : !kind.along
    const neighborIndex = index === 0 ? 1 : index === initialPath.length - 1 ? index - 1 : null
    const pivot = neighborIndex !== null ? initialPath[neighborIndex]! : null
    const radius = pivot
      ? Math.hypot(startPoint[0] - pivot[0], startPoint[1] - pivot[1], startPoint[2] - pivot[2])
      : 0
    const canSwing = swings && isEndpoint && pivot !== null && radius > 1e-6

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      const detached = event.altKey
      let next: Point | null = null
      if (canSwing && pivot) {
        const aim =
          kind.axis === 'y'
            ? swingVertical(event, pivot, startPoint)
            : swingHorizontal(event, pivot, startPoint)
        if (aim) {
          next = [
            snap(pivot[0] + aim[0] * radius, step),
            Math.max(0, snap(pivot[1] + aim[1] * radius, step)),
            snap(pivot[2] + aim[2] * radius, step),
          ]
        }
      } else if (kind.axis === 'y') {
        const y = intersectVerticalY(event.clientX, event.clientY, toWorld(startPoint))
        if (y !== null) next = [startPoint[0], Math.max(0, snap(y, step)), startPoint[2]]
      } else {
        const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(startPoint))
        const hit = intersect(event.clientX, event.clientY, plane)
        if (hit) {
          const local = toLocal(hit)
          const [dx, dz] = kind.dir
          const t = snap((local[0] - startPoint[0]) * dx + (local[2] - startPoint[2]) * dz, step)
          next = [startPoint[0] + t * dx, startPoint[1], startPoint[2] + t * dz]
        }
      }
      if (!next) return
      if (isEndpoint) {
        const port = findNearestPortXZ(
          [next[0], next[1], next[2]],
          collectScenePorts({ excludeNodeId: line.id, systems: REFRIGERANT_PORT_SYSTEMS }),
          PORT_SNAP_RADIUS_M,
        )
        if (port) next = [port.position[0], port.position[1], port.position[2]]
      }
      if (next[0] === drag.current[0] && next[1] === drag.current[1] && next[2] === drag.current[2])
        return
      drag.current = next
      drag.detached = detached
      if (step > 0) triggerSFX('sfx:grid-snap')
      const path = line.path.map((p, i) => (i === drag.index ? next! : p)) as Point[]
      useScene
        .getState()
        .updateNodes([
          { id: line.id as AnyNodeId, data: { path } as Partial<AnyNode> },
          ...(detached ? [] : followUpdates(drag.connectivity, path)),
        ])
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      swallowNextClick()
      drag.cleanup()
      dragRef.current = null
      setDraggingIndex(null)
      const detached = drag.detached
      const finalPath = drag.initialPath.map((p, i) =>
        i === drag.index ? drag.current : p,
      ) as Point[]
      const revert = detached
        ? []
        : (drag.connectivity?.connections ?? []).map((conn) =>
            conn.kind === 'rigid-node'
              ? { id: conn.nodeId, data: { position: conn.startPosition } as Partial<AnyNode> }
              : { id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> },
          )
      useScene
        .getState()
        .updateNodes([
          { id: line.id as AnyNodeId, data: { path: drag.initialPath } as Partial<AnyNode> },
          ...revert.filter((u) => useScene.getState().nodes[u.id]),
        ])
      resumeSceneHistory(useScene)
      const moved = finalPath[drag.index]!.some(
        (v, axis) => v !== drag.initialPath[drag.index]![axis],
      )
      if (moved) {
        useScene
          .getState()
          .updateNodes([
            { id: line.id as AnyNodeId, data: { path: finalPath } as Partial<AnyNode> },
            ...(detached ? [] : followUpdates(drag.connectivity, finalPath)),
          ])
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
    }

    dragRef.current = {
      index,
      initialPath,
      current: startPoint,
      cleanup,
      connectivity,
      detached: false,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const endpointArrows = useMemo(() => getEndpointArrows(line), [line])
  const endpointIndices = useMemo(() => {
    if (line.path.length < 2) return []
    const last = line.path.length - 1
    return last === 0 ? [0] : [0, last]
  }, [line.path.length])

  return (
    <group ref={outerRef}>
      {draggingIndex === null &&
        endpointIndices.map((index) => {
          const point = line.path[index]!
          return (
            <group key={`line-end-${index}`}>
              <HandleCube
                active={openCluster === index}
                onClick={() => toggleCluster(index)}
                position={point as Point}
                rotationY={vertexYaw(line, index)}
              />
              {openCluster === index &&
                endpointArrows
                  .filter((a) => a.index === index)
                  .map((a) => (
                    <MoveChevron
                      cursor={a.cursor}
                      key={a.key}
                      onPointerDown={onHandleDown(a.index, a.kind)}
                      position={a.position}
                      rotationY={a.rotationY}
                      vertical={a.vertical}
                    />
                  ))}
            </group>
          )
        })}
      {draggingIndex !== null &&
        line.path[draggingIndex] &&
        (() => {
          const point = line.path[draggingIndex]!
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

function getEndpointArrows(line: RefrigerantLineNode): EndpointArrow[] {
  const arrows: EndpointArrow[] = []
  const base = Math.max(lineRadiusM(line) + ARROW_GAP, ARROW_MIN_OFFSET)
  const last = line.path.length - 1
  if (last < 1) return arrows
  for (const i of [0, last]) {
    const p = line.path[i]!
    const tangentXZ = vertexTangentXZ(line, i)
    const verticalTangentY = tangentXZ ? null : vertexTangentY(line, i)
    const t = tangentXZ ?? ([1, 0] as [number, number])
    const runYaw = Math.atan2(-t[1], t[0])
    const dirs: { dir: [number, number]; along: boolean }[] = tangentXZ
      ? [
          { dir: [t[0], t[1]], along: true },
          { dir: [-t[0], -t[1]], along: true },
          { dir: [-t[1], t[0]], along: false },
          { dir: [t[1], -t[0]], along: false },
        ]
      : [
          { dir: [1, 0], along: false },
          { dir: [-1, 0], along: false },
          { dir: [0, 1], along: false },
          { dir: [0, -1], along: false },
        ]
    const inward: [number, number] | null =
      tangentXZ && i === 0 ? [t[0], t[1]] : tangentXZ && i === last ? [-t[0], -t[1]] : null
    for (const { dir, along } of dirs) {
      const [dx, dz] = dir
      if (inward && dx * inward[0] + dz * inward[1] > 0.999) continue
      arrows.push({
        key: `pt${i}-${dx.toFixed(3)}:${dz.toFixed(3)}`,
        index: i,
        kind: { axis: 'horizontal', dir: [dx, dz], along },
        position: [p[0] + dx * base, p[1], p[2] + dz * base],
        rotationY: Math.atan2(-dz, dx),
        cursor: 'grab',
      })
    }
    const inwardY =
      verticalTangentY && i === 0
        ? verticalTangentY
        : verticalTangentY && i === last
          ? -verticalTangentY
          : null
    for (const sign of [1, -1] as const) {
      if (inwardY === sign) continue
      arrows.push({
        key: `pt${i}-${sign > 0 ? 'up' : 'down'}`,
        index: i,
        kind: { axis: 'y', along: verticalTangentY !== null },
        position: [p[0], p[1] + sign * base, p[2]],
        rotationY: runYaw,
        vertical: sign > 0 ? 'up' : 'down',
        cursor: 'ns-resize',
      })
    }
  }
  return arrows
}

function vertexTangentXZ(line: RefrigerantLineNode, i: number): [number, number] | null {
  const path = line.path
  const last = path.length - 1
  if (last < 1) return null
  const neighbor = i === 0 ? path[1]! : path[last - 1]!
  const point = path[i]!
  const dx = i === 0 ? neighbor[0] - point[0] : point[0] - neighbor[0]
  const dz = i === 0 ? neighbor[2] - point[2] : point[2] - neighbor[2]
  const len = Math.hypot(dx, dz)
  return len < 1e-6 ? null : [dx / len, dz / len]
}

function vertexTangentY(line: RefrigerantLineNode, i: number): 1 | -1 | null {
  const path = line.path
  const last = path.length - 1
  if (last < 1) return null
  const neighbor = i === 0 ? path[1]! : path[last - 1]!
  const point = path[i]!
  const dx = i === 0 ? neighbor[0] - point[0] : point[0] - neighbor[0]
  const dy = i === 0 ? neighbor[1] - point[1] : point[1] - neighbor[1]
  const dz = i === 0 ? neighbor[2] - point[2] : point[2] - neighbor[2]
  if (Math.hypot(dx, dz) > 1e-6 || Math.abs(dy) < 1e-6) return null
  return dy > 0 ? 1 : -1
}

function vertexYaw(line: RefrigerantLineNode, i: number): number {
  const t = vertexTangentXZ(line, i)
  return t ? Math.atan2(-t[1], t[0]) : 0
}
