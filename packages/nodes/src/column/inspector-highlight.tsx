'use client'

import type { AnyNodeId, ColumnNode, ColumnSlotId } from '@pascal-app/core'
import { OVERLAY_LAYER, useViewer } from '@pascal-app/viewer'
import { type ReactNode, type RefObject, useEffect, useMemo, useRef } from 'react'
import { Box3, BufferGeometry, type Group, LineSegments, Matrix4, Mesh, Vector3 } from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { create } from 'zustand'

type Target = { part: ColumnSlotId | 'all'; axis?: 'x' | 'y' | 'z' }
type Highlight = Target & { owner: symbol; nodeId: AnyNodeId }
export const useColumnInspectorHighlight = create<{ active: Highlight | null }>(() => ({
  active: null,
}))

export function clearColumnInspectorHighlight(owner: symbol) {
  const active = useColumnInspectorHighlight.getState().active
  if (active?.owner !== owner) return
  useColumnInspectorHighlight.setState({ active: null })
  if (useViewer.getState().hoveredId === active.nodeId) useViewer.getState().setHoveredId(null)
}

export function setColumnInspectorHighlight(owner: symbol, nodeId: AnyNodeId, target: Target) {
  const previous = useColumnInspectorHighlight.getState().active
  if (
    previous?.owner === owner &&
    previous.nodeId === nodeId &&
    previous.part === target.part &&
    previous.axis === target.axis
  )
    return
  useColumnInspectorHighlight.setState({ active: { owner, nodeId, ...target } })
  useViewer.getState().setHoveredId(nodeId)
}

function targetFor(element: EventTarget | null): Target | null {
  if (!(element instanceof Element)) return null
  const region = element.closest<HTMLElement>('[data-column-part]')
  if (!region) return null
  const part = region.dataset.columnPart
  if (
    part !== 'all' &&
    part !== 'base' &&
    part !== 'capital' &&
    part !== 'shaft' &&
    part !== 'frame'
  )
    return null
  const axis = element.closest<HTMLElement>('[data-column-axis]')?.dataset.columnAxis
  return { part, axis: axis === 'x' || axis === 'y' || axis === 'z' ? axis : undefined }
}

export function ColumnInspectorHover({
  nodeId,
  children,
}: {
  nodeId: AnyNodeId
  children: ReactNode
}) {
  const owner = useMemo(() => Symbol(`column-inspector:${nodeId}`), [nodeId])
  const pointer = useRef<Target | null>(null),
    focus = useRef<Target | null>(null)
  const update = () => {
    const target = pointer.current ?? focus.current
    if (target) setColumnInspectorHighlight(owner, nodeId, target)
    else clearColumnInspectorHighlight(owner)
  }
  useEffect(() => {
    pointer.current = null
    focus.current = null
    const clear = () => {
      pointer.current = null
      focus.current = null
      clearColumnInspectorHighlight(owner)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', onKeyDown)
      clear()
    }
  }, [owner])
  return (
    <div
      onPointerOver={(event) => {
        pointer.current = targetFor(event.target)
        update()
      }}
      onPointerCancel={() => {
        pointer.current = null
        focus.current = null
        clearColumnInspectorHighlight(owner)
      }}
      onPointerLeave={() => {
        pointer.current = null
        update()
      }}
      onFocusCapture={(event) => {
        focus.current = targetFor(event.target)
        update()
      }}
      onBlurCapture={(event) => {
        focus.current = event.currentTarget.contains(event.relatedTarget)
          ? targetFor(event.relatedTarget)
          : null
        update()
      }}
    >
      {children}
    </div>
  )
}

export function ColumnInspectorOverlay({
  nodeId,
  body,
  node,
  position,
  rotation,
}: {
  nodeId: AnyNodeId
  body: RefObject<Group | null>
  node: ColumnNode
  position: [number, number, number]
  rotation: number
}) {
  const overlay = useRef<Group>(null)
  const active = useColumnInspectorHighlight((state) =>
    state.active?.nodeId === nodeId ? state.active : null,
  )
  useEffect(() => {
    const source = body.current,
      target = overlay.current
    if (!active || !source || !target || node.id !== active.nodeId) return
    const fill = new MeshBasicNodeMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false,
    })
    const lineMaterial = new LineBasicNodeMaterial({
      color: '#0284c7',
      depthTest: false,
      depthWrite: false,
    })
    source.updateWorldMatrix(true, true)
    const inverse = new Matrix4().copy(source.matrixWorld).invert()
    const bounds = new Box3()
    source.traverse((object) => {
      if (!(object instanceof Mesh) || !object.visible) return
      if (active.part !== 'all' && object.userData.slotId !== active.part) return
      const matrix = new Matrix4().multiplyMatrices(inverse, object.matrixWorld)
      const mesh = new Mesh(object.geometry, fill)
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(matrix)
      mesh.layers.set(OVERLAY_LAYER)
      mesh.raycast = () => {}
      mesh.userData.pascalExport = 'strip'
      target.add(mesh)
      object.geometry.computeBoundingBox()
      if (object.geometry.boundingBox)
        bounds.union(object.geometry.boundingBox.clone().applyMatrix4(matrix))
    })
    let dimension: BufferGeometry | undefined
    if (active.axis && !bounds.isEmpty()) {
      const axis = active.axis,
        a = bounds.min.clone(),
        b = bounds.min.clone()
      b[axis] = bounds.max[axis]
      const offset = Math.max(0.06, bounds.getSize(new Vector3()).length() * 0.04)
      const side = axis === 'x' ? 'z' : 'x'
      a[side] -= offset
      b[side] -= offset
      const tick = new Vector3()
      tick[side] = offset * 0.3
      dimension = new BufferGeometry().setFromPoints([
        a,
        b,
        a.clone().sub(tick),
        a.clone().add(tick),
        b.clone().sub(tick),
        b.clone().add(tick),
      ])
      const line = new LineSegments(dimension, lineMaterial)
      line.layers.set(OVERLAY_LAYER)
      line.raycast = () => {}
      line.userData.pascalExport = 'strip'
      target.add(line)
    }
    return () => {
      target.clear()
      dimension?.dispose()
      fill.dispose()
      lineMaterial.dispose()
    }
  }, [active, body, node])
  return (
    <group
      name="column-inspector-highlight"
      position={position}
      rotation={[0, rotation, 0]}
      visible={node.visible}
      ref={overlay}
      dispose={null}
      userData={{ pascalExport: 'strip' }}
    />
  )
}
