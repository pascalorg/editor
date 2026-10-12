'use client'
import {
  type AnyNodeId,
  hiddenWallPointerEventsHeld,
  sceneRegistry,
  useRegistry,
  useScene,
  type WallFeatureNode,
} from '@pascal-app/core'
import { NodeRenderer, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { type Group, Matrix4, type Mesh } from 'three'
import { getWallFeaturePlacement } from './runtime'
import { hasDescendantHit, raycastWallFeature } from './selection'

export default function WallFeatureRenderer({ node }: { node: WallFeatureNode }) {
  const ref = useRef<Group>(null!)
  const offsetMatrix = useMemo(() => new Matrix4(), [])
  const hitRef = useRef<Mesh>(null!)
  useRegistry(node.id, 'wall-feature', ref)
  const raw = useNodeEvents(node, 'wall-feature')
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
    const placement = getWallFeaturePlacement(node.id)
    const group = ref.current
    if (!group) return
    const wall = placement && sceneRegistry.nodes.get(placement.wall.id)
    group.visible = !!placement && wall?.userData.wallHidden !== true
    if (!placement) return
    hitRef.current.position.set(
      placement.node.width / 2,
      placement.node.height / 2,
      ((placement.node.mode === 'niche' ? 1 : -1) *
        (placement.face === 'b' ? -1 : 1) *
        placement.node.depth) /
        2,
    )
    hitRef.current.scale.set(
      placement.node.width / node.width,
      placement.node.height / node.height,
      placement.node.depth / node.depth,
    )
    if (!wall) return
    const parent = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined
    const host = parent?.type === 'wall-feature' ? getWallFeaturePlacement(parent.id) : undefined
    group.position.set(
      placement.bounds.u0 - (host?.bounds.u0 ?? 0),
      placement.bottom - (host?.bottom ?? wall.position.y),
      placement.surfaceOffset - (host?.surfaceOffset ?? 0),
    )
    if (parent?.type === 'wall' && placement.wall.id !== parent.id && group.parent) {
      group.parent.updateWorldMatrix(true, false)
      wall.updateWorldMatrix(true, false)
      offsetMatrix.makeTranslation(
        placement.bounds.u0,
        placement.bottom - wall.position.y,
        placement.surfaceOffset,
      )
      group.matrixAutoUpdate = false
      group.matrix
        .copy(group.parent.matrixWorld)
        .invert()
        .multiply(wall.matrixWorld)
        .multiply(offsetMatrix)
      group.matrixWorldNeedsUpdate = true
    } else group.matrixAutoUpdate = true
  })
  return (
    <group ref={ref} visible={node.visible}>
      <mesh
        ref={hitRef}
        position={[
          node.width / 2,
          node.height / 2,
          ((node.mode === 'niche' ? 1 : -1) * (node.face === 'b' ? -1 : 1) * node.depth) / 2,
        ]}
        userData={{ pascalExport: 'strip' }}
        {...handlers}
        raycast={(raycaster, hits) => {
          const placement = getWallFeaturePlacement(node.id)
          const wall = placement && sceneRegistry.nodes.get(placement.wall.id)
          if (
            wall?.userData.wallHidden &&
            !hiddenWallPointerEventsHeld() &&
            useViewer.getState().hoverHighlightMode !== 'delete'
          )
            return
          if (placement && wall && (wall as Mesh).isMesh)
            raycastWallFeature(hitRef.current, wall as Mesh, placement, raycaster, hits)
        }}
      >
        <boxGeometry args={[node.width, node.height, node.depth]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {node.children.map((id) => (
        <FeatureChild key={id} node={node} id={id} />
      ))}
    </group>
  )
}

function FeatureChild({ node, id }: { node: WallFeatureNode; id: AnyNodeId }) {
  const ref = useRef<Group>(null!)
  useFrame(() => {
    const p = getWallFeaturePlacement(node.id)
    if (!p || !ref.current) return
    if (node.attachments[id] === 'resting')
      ref.current.position.set(
        p.node.width / 2,
        p.node.mode === 'bump' ? p.node.height : 0,
        (p.mountOffset - p.surfaceOffset) / 2,
      )
    else ref.current.position.set(0, 0, 0)
  })
  return (
    <group ref={ref}>
      <NodeRenderer nodeId={id} />
    </group>
  )
}
