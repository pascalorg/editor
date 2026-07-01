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

// Wind is a TSL vertex bend baked into the variant materials (see `wind-node.ts`)
// — animated on the GPU, so the instance matrices here stay static.

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
 * target) + pointer handlers. Inner registered group: the real geometry —
 * invisible and mounted only while hovered/selected (so the outline pass traces
 * the true silhouette), OR **visible with real materials during a GLB export**,
 * so the exporter (which clones only the `scene-renderer` subtree, not the
 * collective InstancedMesh) captures each plant. The collider box is dropped
 * during export so it doesn't bake as a phantom solid.
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

  const isExporting = useViewer((s) => s.isExporting)
  const active = useViewer(
    (s) => s.hoveredId === node.id || s.selection.selectedIds.includes(node.id as never),
  )
  const showGeometry = active || isExporting

  const height = Math.max(0.2, node.height ?? 1)
  const radius = colliderRadius(node)
  const variant = useMemo(
    () => (showGeometry ? getVariant(node) : null),
    [showGeometry, node, getVariant],
  )
  const geometryScale = variant ? height / variant.naturalHeight : 1

  return (
    <group
      position={node.position ?? [0, 0, 0]}
      rotation={node.rotation ?? [0, 0, 0]}
      visible={node.visible !== false}
      {...handlers}
    >
      {!isExporting && (
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={[radius * 2, height, radius * 2]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      <group ref={outlineRef}>
        {variant && (
          <group scale={geometryScale}>
            {variant.subMeshes.map((subMesh, i) => (
              <mesh
                dispose={null}
                geometry={subMesh.geometry}
                key={i}
                material={isExporting ? subMesh.material : INVISIBLE}
                raycast={NO_RAYCAST}
              />
            ))}
          </group>
        )}
      </group>
    </group>
  )
}

// ── Static per-node renderer (a `def.bakeReplaceRenderer`) ────────────────────

/**
 * The real geometry of one node, standalone — no collider, no selection wiring,
 * no editor stores. The baked `/viewer` mounts this (portaled into the node's
 * baked parent level) to re-render a `bake: 'replace'` kind live: the submeshes
 * carry the same wind node materials as the instanced path, so wind runs in the
 * node's real coordinate space instead of the bake's quantized one.
 *
 * The meshes are `NO_RAYCAST`: the baked scene's `<primitive>` has pointer
 * handlers, so R3F recursively raycasts every descendant on each pointer move
 * (incl. orbit drags). Dense ez-tree geometry × a forest would make hover
 * cost dozens of ms/frame — and these live nodes carry no `pascalId`, so a hit
 * would resolve to the level, not the tree. Scenery, not a pick target.
 */
export function KindStatic<N extends Placeable>({
  node,
  getVariant,
}: {
  node: N
  getVariant: (node: N) => VariantData
}) {
  const variant = useMemo(() => getVariant(node), [node, getVariant])
  const height = Math.max(0.2, node.height ?? 1)
  const scale = height / variant.naturalHeight
  return (
    <group
      position={node.position ?? [0, 0, 0]}
      rotation={node.rotation ?? [0, 0, 0]}
      visible={node.visible !== false}
    >
      <group scale={scale}>
        {variant.subMeshes.map((subMesh, i) => (
          <mesh
            dispose={null}
            geometry={subMesh.geometry}
            key={i}
            material={subMesh.material}
            raycast={NO_RAYCAST}
          />
        ))}
      </group>
    </group>
  )
}
