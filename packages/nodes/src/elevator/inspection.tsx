import type { AnyNodeId, ElevatorNode, ElevatorSlotId } from '@pascal-app/core'
import { OVERLAY_LAYER } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { type ReactNode, type RefObject, useEffect, useRef } from 'react'
import { type Group, Matrix4, Mesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { create } from 'zustand'

export const useElevatorInspection = create<{
  nodeId: AnyNodeId | null
  cutaway: boolean
  part: ElevatorSlotId | null
}>(() => ({ nodeId: null, cutaway: false, part: null }))

export function ElevatorInspectorHover({
  nodeId,
  children,
}: {
  nodeId: AnyNodeId
  children: ReactNode
}) {
  useEffect(() => {
    useElevatorInspection.setState({ nodeId, part: null, cutaway: false })
    const clear = () => useElevatorInspection.setState({ part: null })
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', onEscape)
      useElevatorInspection.setState({ nodeId: null, part: null, cutaway: false })
    }
  }, [nodeId])
  const highlight = (element: EventTarget | null) => {
    const slot =
      element instanceof Element
        ? element.closest<HTMLElement>('[data-elevator-part]')?.dataset.elevatorPart
        : undefined
    useElevatorInspection.setState({
      part:
        slot === 'cab' || slot === 'doors' || slot === 'shaft' || slot === 'glass' ? slot : null,
    })
  }
  return (
    <div
      onPointerOver={(event) => highlight(event.target)}
      onPointerLeave={() => highlight(null)}
      onFocusCapture={(event) => highlight(event.target)}
      onBlurCapture={(event) => highlight(event.relatedTarget)}
    >
      {children}
    </div>
  )
}

export function ElevatorInspectionOverlay({
  node,
  source,
}: {
  node: ElevatorNode
  source: RefObject<Group | null>
}) {
  const ref = useRef<Group>(null)
  const part = useElevatorInspection((state) => (state.nodeId === node.id ? state.part : null))
  const copies = useRef<Array<{ source: Mesh; copy: Mesh }>>([])
  useEffect(() => {
    if (!part || !ref.current || !source.current || !node.id) return
    const target = ref.current
    const fill = new MeshBasicNodeMaterial({
      color: '#38bdf8',
      opacity: 0.3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    source.current.traverse((object) => {
      if (!(object instanceof Mesh) || object.userData.slotId !== part) return
      const copy = new Mesh(object.geometry, fill)
      copy.matrixAutoUpdate = false
      copy.layers.set(OVERLAY_LAYER)
      copy.raycast = () => {}
      copy.userData.pascalExport = 'strip'
      target.add(copy)
      copies.current.push({ source: object, copy })
    })
    return () => {
      target.clear()
      copies.current = []
      fill.dispose()
    }
  }, [part, source, node])
  useFrame(() => {
    if (!part || !ref.current) return
    ref.current.updateWorldMatrix(true, false)
    const inverse = new Matrix4().copy(ref.current.matrixWorld).invert()
    for (const pair of copies.current) {
      pair.source.updateWorldMatrix(true, false)
      pair.copy.matrix.multiplyMatrices(inverse, pair.source.matrixWorld)
    }
  })
  return (
    <group
      ref={ref}
      name="elevator-inspector-highlight"
      userData={{ pascalExport: 'strip' }}
      dispose={null}
    />
  )
}
