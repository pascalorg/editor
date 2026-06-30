'use client'

import { sceneRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, type InstancedMesh, type Material, Matrix4, Object3D } from 'three'
import { getVariantData, type TreeSubMesh } from './geometry'
import type { TreeNode, TreePreset } from './schema'

/**
 * Collective instanced renderer for every placed tree — contributed via
 * `def.system`, mounted once by the viewer's `RegisteredSystems`. It groups all
 * `trees:tree` nodes by (preset, seed) variant and draws each variant as one
 * `InstancedMesh` per sub-mesh, so a forest of N trees is a handful of draw
 * calls, not N. Selection/outline come from the per-node proxy renderer
 * (`def.renderer`); this system only paints pixels.
 */
export default function TreesSystem() {
  const nodes = useScene((s) => s.nodes)

  const buckets = useMemo(() => {
    const map = new Map<string, { preset: TreePreset; seed: number; nodes: TreeNode[] }>()
    for (const raw of Object.values(nodes)) {
      if ((raw.type as string) !== 'trees:tree') continue
      const node = raw as unknown as TreeNode
      const key = `${node.preset}:${node.seed}`
      const bucket = map.get(key)
      if (bucket) bucket.nodes.push(node)
      else map.set(key, { preset: node.preset, seed: node.seed, nodes: [node] })
    }
    return Array.from(map, ([key, value]) => ({ key, ...value }))
  }, [nodes])

  return (
    <>
      {buckets.map((bucket) => (
        <TreeVariant
          key={bucket.key}
          nodes={bucket.nodes}
          preset={bucket.preset}
          seed={bucket.seed}
        />
      ))}
    </>
  )
}

function TreeVariant({
  preset,
  seed,
  nodes,
}: {
  preset: TreePreset
  seed: number
  nodes: TreeNode[]
}) {
  // Generated once per variant and cached; shared across every instance.
  const data = useMemo(() => getVariantData(preset, seed), [preset, seed])
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

const DUMMY = new Object3D()
const INSTANCE_MATRIX = new Matrix4()

function InstancedSubMesh({
  subMesh,
  nodes,
  naturalHeight,
}: {
  subMesh: TreeSubMesh
  nodes: TreeNode[]
  naturalHeight: number
}) {
  const ref = useRef<InstancedMesh>(null)
  // Round capacity up so the InstancedMesh isn't recreated on every single
  // placement — only when crossing a 32-instance boundary. `dispose={null}`
  // keeps the shared (cached) geometry/material alive across any recreation.
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
