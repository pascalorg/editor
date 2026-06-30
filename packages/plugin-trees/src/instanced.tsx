'use client'

import { type AnyNodeId, sceneRegistry, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
} from 'three'

/**
 * Generic instanced-rendering core shared by every plant kind (trees, flowers,
 * …). A kind plugs in two pure functions — `variantKeyOf` (how to bucket nodes
 * that can share geometry) and `getVariant` (cached geometry for a node) — and
 * gets forest-scale instancing plus true-silhouette selection for free.
 */

export type SubMesh = { geometry: BufferGeometry; material: Material | Material[] }
export type VariantData = { subMeshes: SubMesh[]; naturalHeight: number }

/** The shape every placeable plant node shares. */
export interface Placeable {
  id: string
  type: string
  parentId: string | null
  position: [number, number, number]
  rotation: [number, number, number]
  height: number
  visible?: boolean
}

const INVISIBLE = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
const DUMMY = new Object3D()
const INSTANCE_MATRIX = new Matrix4()
const NO_RAYCAST = () => {}

// ── Collective instanced renderer (a `def.system`) ───────────────────────────

export function InstancedKindSystem<N extends Placeable>({
  kind,
  variantKeyOf,
  getVariant,
}: {
  kind: string
  variantKeyOf: (node: N) => string
  getVariant: (node: N) => VariantData
}) {
  const nodes = useScene((s) => s.nodes)

  const buckets = useMemo(() => {
    const map = new Map<string, { sample: N; nodes: N[] }>()
    for (const raw of Object.values(nodes)) {
      if ((raw.type as string) !== kind) continue
      const node = raw as unknown as N
      const key = variantKeyOf(node)
      const bucket = map.get(key)
      if (bucket) bucket.nodes.push(node)
      else map.set(key, { sample: node, nodes: [node] })
    }
    return Array.from(map, ([key, value]) => ({ key, ...value }))
  }, [nodes, kind, variantKeyOf])

  return (
    <>
      {buckets.map((bucket) => (
        <Variant
          getVariant={getVariant}
          key={bucket.key}
          nodes={bucket.nodes}
          sample={bucket.sample}
        />
      ))}
    </>
  )
}

function Variant<N extends Placeable>({
  sample,
  nodes,
  getVariant,
}: {
  sample: N
  nodes: N[]
  getVariant: (node: N) => VariantData
}) {
  const data = useMemo(() => getVariant(sample), [sample, getVariant])
  return (
    <>
      {data.subMeshes.map((subMesh, i) => (
        <InstancedSubMesh
          key={i}
          naturalHeight={data.naturalHeight}
          nodes={nodes}
          subMesh={subMesh}
        />
      ))}
    </>
  )
}

function InstancedSubMesh<N extends Placeable>({
  subMesh,
  nodes,
  naturalHeight,
}: {
  subMesh: SubMesh
  nodes: N[]
  naturalHeight: number
}) {
  const ref = useRef<InstancedMesh>(null)
  // Round capacity up so the InstancedMesh isn't recreated on every placement —
  // only when crossing a 32-instance boundary. `dispose={null}` keeps the shared
  // (cached) geometry/material alive across any recreation.
  const capacity = Math.max(16, Math.ceil(nodes.length / 32) * 32)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (!node) continue
      const scale = node.height / naturalHeight
      DUMMY.position.set(node.position[0], node.position[1], node.position[2])
      DUMMY.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])
      DUMMY.scale.set(scale, scale, scale)
      DUMMY.updateMatrix()
      // Instances live at the scene root, so fold in the parent level's world
      // matrix — node positions are stored level-local.
      const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined
      if (parent) {
        parent.updateWorldMatrix(true, false)
        INSTANCE_MATRIX.multiplyMatrices(parent.matrixWorld, DUMMY.matrix)
        mesh.setMatrixAt(i, INSTANCE_MATRIX)
      } else {
        mesh.setMatrixAt(i, DUMMY.matrix)
      }
    }
    mesh.count = nodes.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [nodes, naturalHeight])

  return (
    <instancedMesh
      args={[subMesh.geometry as BufferGeometry, subMesh.material as Material, capacity]}
      castShadow
      dispose={null}
      frustumCulled={false}
      ref={ref}
    />
  )
}

// ── Per-node selection proxy (a `def.renderer`) ──────────────────────────────

/**
 * Invisible per-node proxy that keeps the host's selection machinery working
 * for an instanced kind. Outer group: a stable box collider (the raycast
 * target) + pointer handlers. Inner registered group: the real geometry
 * (invisible, non-raycasting) mounted only while hovered/selected, so the
 * outline pass traces the true silhouette instead of the box.
 */
export function KindProxy<N extends Placeable & { id: string }>({
  node,
  getVariant,
  colliderRadius,
}: {
  node: N
  getVariant: (node: N) => VariantData
  colliderRadius: (node: N) => number
}) {
  const outlineRef = useRef<Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, outlineRef)

  const active = useViewer(
    (s) => s.hoveredId === node.id || s.selection.selectedIds.includes(node.id as never),
  )

  const height = Math.max(0.2, node.height ?? 1)
  const radius = colliderRadius(node)
  const variant = useMemo(() => (active ? getVariant(node) : null), [active, node, getVariant])
  const silhouetteScale = variant ? height / variant.naturalHeight : 1

  return (
    <group
      position={node.position ?? [0, 0, 0]}
      rotation={node.rotation ?? [0, 0, 0]}
      visible={node.visible !== false}
      {...handlers}
    >
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[radius * 2, height, radius * 2]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <group ref={outlineRef}>
        {variant && (
          <group scale={silhouetteScale}>
            {variant.subMeshes.map((subMesh, i) => (
              <mesh
                dispose={null}
                geometry={subMesh.geometry}
                key={i}
                material={INVISIBLE}
                raycast={NO_RAYCAST}
              />
            ))}
          </group>
        )}
      </group>
    </group>
  )
}
