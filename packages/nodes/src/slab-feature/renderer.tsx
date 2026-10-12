'use client'
import {
  type AnyNodeId,
  getEffectiveNode,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
  sceneRegistry,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { type Group, Mesh, type Object3D } from 'three'
import { hasDescendantHit } from '../shared/descendant-hit'
import { slabFeatureRenderNodes } from './runtime'
import { slabFeatureLocalFrame } from './surfaces'

export default function SlabFeatureRenderer({ node }: { node: SlabFeatureNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, node.type, ref)
  const raw = useNodeEvents(node, node.type)
  const handlers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(raw).map(([key, fn]) => [
          key,
          (event: Parameters<typeof raw.onPointerDown>[0]) => {
            if (
              key !== 'onPointerLeave' &&
              ref.current &&
              hasDescendantHit(ref.current, event.intersections)
            )
              return
            fn(event)
          },
        ]),
      ),
    [raw],
  )
  useFrame(() => {
    const nodes = slabFeatureRenderNodes(useScene.getState().nodes)
    if (!ref.current) return
    try {
      const frame = slabFeatureLocalFrame(node, { nodes, planOnly: false })
      ref.current.position.set(...frame.position)
      ref.current.visible = node.visible !== false
    } catch {
      ref.current.visible = false
    }
  })
  return (
    <group ref={ref}>
      <mesh
        position={[0, ((node.mode === 'bump' ? 1 : -1) * node.depth) / 2, 0]}
        userData={{ pascalExport: 'strip' }}
        {...handlers}
        raycast={(raycaster, hits) => {
          let p
          try {
            p = resolveSlabFeaturePlacement(useScene.getState().nodes, node)
          } catch {
            return
          }
          const root = sceneRegistry.nodes.get(p.slab.id) as Object3D | undefined
          root?.traverse((object) => {
            const mesh = object as Mesh
            if (!mesh.isMesh || mesh.userData.slabFeatureId !== node.id || !mesh.visible) return
            const candidates: Parameters<Mesh['raycast']>[1] = []
            Mesh.prototype.raycast.call(mesh, raycaster, candidates)
            for (const hit of candidates)
              hits.push({
                ...hit,
                distance: Math.max(0, hit.distance - 0.000001),
                object: ref.current.children[0]!,
              })
          })
        }}
      >
        <boxGeometry args={[node.width, node.depth, node.length]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {node.children.map((id) => (
        <FeatureChild key={id} node={node} id={id} />
      ))}
    </group>
  )
}
function FeatureChild({ node, id }: { node: SlabFeatureNode; id: AnyNodeId }) {
  const ref = useRef<Group>(null!)
  useFrame(() => {
    if (!ref.current) return
    if (node.attachments[id] !== 'resting') {
      ref.current.position.set(0, 0, 0)
      return
    }
    const live = getEffectiveNode(node)
    ref.current.position.set(
      live.x - node.x,
      live.mode === 'bump' ? live.depth : -live.depth,
      live.z - node.z,
    )
  })
  return (
    <group ref={ref}>
      <NodeRenderer nodeId={id} />
    </group>
  )
}
