'use client'
import {
  emitter,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  markToolCancelConsumed,
  swallowNextClick,
  triggerSFX,
  useEditor,
  useInteractionScope,
  usePlacementPreview,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoxGeometry,
  EdgesGeometry,
  type Group,
  type LineBasicMaterial,
  type Mesh,
  type MeshBasicMaterial,
  Plane,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { createSlabFeaturePlacementSession } from './placement'

export function SlabFeatureGesture({
  node,
  moving = false,
}: {
  node: SlabFeatureNode
  moving?: boolean
}) {
  const { sceneApi, selectNode, isCameraDragging } = useRegistryToolContext()
  const { camera, gl, scene } = useThree()
  const ghost = useRef<Group>(null!),
    box = useRef<Mesh>(null!),
    label = useRef<Group>(null!),
    material = useRef<MeshBasicMaterial>(null!),
    edges = useRef<LineBasicMaterial>(null!)
  const edgeGeometry = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1)
    const geometry = new EdgesGeometry(box)
    box.dispose()
    return geometry
  }, [])
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry])
  const [error, setError] = useState<string | null>(null)
  const view = useInteractionScope((s) =>
    (s.scope.kind === 'placing' || s.scope.kind === 'moving') && s.scope.nodeId === node.id
      ? s.scope.view
      : null,
  )
  useFrame(() => {
    if (view !== '2d') return
    const preview = usePlacementPreview.getState().node
    if (preview?.type !== 'slab-feature' || preview.id !== node.id) {
      ghost.current.visible = false
      return
    }
    const p = resolveSlabFeaturePlacement(sceneApi.nodes(), preview)
    const root = sceneRegistry.nodes.get(p.slab.id)
    if (!root) return
    root.updateWorldMatrix(true, false)
    ghost.current.matrix.copy(root.matrixWorld)
    ghost.current.matrixWorldNeedsUpdate = true
    ghost.current.visible = true
    box.current.position.set(p.x, (p.mount + p.surface) / 2, p.z)
    box.current.scale.set(preview.width, preview.depth, preview.length)
    material.current.color.set('#8b5cf6')
    edges.current.color.copy(material.current.color)
  })
  useEffect(() => {
    if (view === '2d' && !moving) return
    const session = createSlabFeaturePlacementSession(node, sceneApi, moving)
    const raycaster = new Raycaster(),
      pointer = new Vector2(),
      ray = new Ray(),
      point = new Vector3()
    let ended = false,
      frame: number | null = null,
      last: PointerEvent | null = null,
      down: [number, number] | null = null
    const owns = () => {
      const s = useInteractionScope.getState().scope
      return (
        (s.kind === 'placing' || s.kind === 'moving') && s.nodeId === node.id && s.view !== '2d'
      )
    }
    const update = (event: PointerEvent) => {
      if (ended || !owns() || isCameraDragging()) return
      const p = resolveSlabFeaturePlacement(sceneApi.nodes(), node),
        root = sceneRegistry.nodes.get(p.slab.id)
      if (!root) return
      root.updateWorldMatrix(true, false)
      const rect = gl.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      ray.copy(raycaster.ray).applyMatrix4(root.matrixWorld.clone().invert())
      const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -p.mount), point)
      const proposal = session.update(hit ? [point.x, point.z] : null, event.altKey)
      usePlacementPreview.getState().set(proposal?.placement ? proposal.node : null)
      ghost.current.visible = !!hit
      setError(proposal?.error ?? null)
      ghost.current.matrix.copy(root.matrixWorld)
      ghost.current.matrixWorldNeedsUpdate = true
      const next = proposal?.placement
      material.current.color.set(next ? '#8b5cf6' : '#ef4444')
      edges.current.color.copy(material.current.color)
      const x = next?.x ?? point.x,
        z = next?.z ?? point.z
      box.current.position.set(x, next ? (next.mount + next.surface) / 2 : p.mount, z)
      label.current.position.set(x, p.mount + 0.25, z)
      box.current.scale.set(node.width, node.depth, node.length)
    }
    const clear = () => {
      session.cancel()
      usePlacementPreview.getState().clear()
      if (ghost.current) ghost.current.visible = false
    }
    const cancel = () => {
      if (ended) return
      ended = true
      clear()
      markToolCancelConsumed()
      if (owns()) {
        useInteractionScope.getState().end()
        if (moving) useEditor.getState().setMovingNode(null)
        else useEditor.getState().setTool(null)
      }
    }
    const queue = (event: PointerEvent) => {
      if (event.buttons & 6) return
      last = event
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (last) update(last)
      })
    }
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || !owns()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      down = [event.clientX, event.clientY]
    }
    const release = (event: PointerEvent) => {
      if (event.button !== 0 || !down || !owns()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const clicked = Math.hypot(event.clientX - down[0], event.clientY - down[1]) < 5
      down = null
      if (!clicked) return
      update(event)
      try {
        const id = session.commit()
        if (!id) return
        ended = true
        usePlacementPreview.getState().clear()
        swallowNextClick()
        selectNode(id)
        triggerSFX('sfx:item-place')
        useInteractionScope
          .getState()
          .endIf((s) => (s.kind === 'placing' || s.kind === 'moving') && s.nodeId === node.id)
        if (moving) useEditor.getState().setMovingNode(null)
        else useEditor.getState().setTool(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid feature placement.')
      }
    }
    const refresh = (event: KeyboardEvent) => {
      if (last && (event.key === 'Alt' || event.key === 'Shift'))
        update({
          clientX: last.clientX,
          clientY: last.clientY,
          altKey: event.altKey,
        } as PointerEvent)
    }
    const stop = useScene.subscribe((s) => {
      if (s.readOnly || !s.nodes[node.parentId as keyof typeof s.nodes]) cancel()
    })
    const canvas = gl.domElement
    canvas.addEventListener('pointermove', queue)
    canvas.addEventListener('pointerdown', press, true)
    canvas.addEventListener('pointerup', release, true)
    window.addEventListener('keyup', refresh)
    window.addEventListener('keydown', refresh)
    emitter.on('tool:cancel', cancel)
    return () => {
      ended = true
      if (frame !== null) cancelAnimationFrame(frame)
      clear()
      stop()
      canvas.removeEventListener('pointermove', queue)
      canvas.removeEventListener('pointerdown', press, true)
      canvas.removeEventListener('pointerup', release, true)
      window.removeEventListener('keyup', refresh)
      window.removeEventListener('keydown', refresh)
      emitter.off('tool:cancel', cancel)
    }
  }, [node, moving, view, sceneApi, selectNode, isCameraDragging, camera, gl])
  return createPortal(
    <group
      ref={ghost}
      matrixAutoUpdate={false}
      visible={false}
      userData={{ pascalExport: 'strip' }}
    >
      <mesh ref={box} layers={EDITOR_LAYER} raycast={() => {}}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          ref={material}
          color="#8b5cf6"
          transparent
          opacity={0.25}
          depthTest={false}
          depthWrite={false}
        />
        <lineSegments
          geometry={edgeGeometry}
          layers={EDITOR_LAYER}
          renderOrder={1}
          raycast={() => {}}
        >
          <lineBasicMaterial
            ref={edges}
            color="#8b5cf6"
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      </mesh>
      <group ref={label}>
        <Html center style={{ pointerEvents: 'none' }}>
          <p
            role="status"
            className="rounded bg-background p-2 text-xs text-destructive"
            hidden={!error}
          >
            {error}
          </p>
        </Html>
      </group>
    </group>,
    scene,
  )
}
export default function SlabFeatureTool() {
  const node = useInteractionScope((s) =>
    s.scope.kind === 'placing' && s.scope.node.type === 'slab-feature' ? s.scope.node : null,
  )
  return node ? <SlabFeatureGesture key={node.id} node={node} /> : null
}
