'use client'

import {
  type AnyNodeId,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, type InstancedMesh, type Material, Matrix4, Object3D } from 'three'
import { plantElevation } from './elevation'
import { toStaticMaterial } from './wind-node'

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
  const scene = useScene((s) => s.nodes)
  const hoveredId = useViewer((s) => s.hoveredId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  // Hovered/selected plants render through their proxy instead (real geometry,
  // static materials) so the outline matches the visible mesh and a move drag
  // animates in realtime — skip them here to avoid a double draw. Keyed by the
  // *relevant* ids only, so hovering unrelated kinds doesn't churn matrices.
  const activeKey = useMemo(() => {
    const ids: string[] = []
    if (hoveredId && (scene[hoveredId as AnyNodeId]?.type as string) === kind) ids.push(hoveredId)
    for (const id of selectedIds) {
      if ((scene[id as AnyNodeId]?.type as string) === kind) ids.push(id)
    }
    return ids.sort().join('|')
  }, [scene, kind, hoveredId, selectedIds])
  const nodes = useMemo(() => {
    const active = new Set(activeKey ? activeKey.split('|') : [])
    return Object.values(scene).filter(
      (n) => (n.type as string) === kind && !active.has(n.id as string),
    ) as unknown as N[]
  }, [scene, kind, activeKey])

  // Consume the dirty marks for this kind. Instances rebuild synchronously
  // from the store (the memos above), so a rendered node is already "built" —
  // but `FloorElevationSystem` deliberately leaves the mark for kinds with a
  // `def.system`, expecting that system to clear it. Without this pass the
  // marks live forever: `hasPendingSceneBuildWork` never goes false, so the
  // scene-ready signal (and every headless bake) stalls at its frame cap.
  // Priority 2 = after the priority-1 floor-elevation lift in the same frame;
  // clearing only registered nodes leaves unmounted proxies for a later frame.
  useFrame(() => {
    const { dirtyNodes, nodes: sceneNodes, clearDirty } = useScene.getState()
    if (dirtyNodes.size === 0) return
    for (const id of dirtyNodes) {
      const node = sceneNodes[id]
      if (!node || (node.type as string) !== kind) continue
      if (!sceneRegistry.nodes.has(id)) continue
      clearDirty(id)
    }
  }, 2)

  return <InstancedNodes getVariant={getVariant} nodes={nodes} variantKeyOf={variantKeyOf} />
}

/**
 * Instance a given set of nodes, bucketed by geometry variant. Two callers:
 * - `InstancedKindSystem` (editor `def.system`) passes every node of a kind with
 *   `localSpace={false}` — instances live at the scene root, so each matrix folds
 *   in the parent level's world matrix (positions are stored level-local).
 * - the baked `/viewer` (`bakeReplaceRenderer`) passes one level's nodes with
 *   `localSpace` — the meshes are portaled into that baked level (which supplies
 *   the level transform), so instance matrices stay level-local, and the meshes
 *   are `NO_RAYCAST` (scenery; a pick would resolve to the level anyway).
 *
 * Instancing carries the per-tree wind phase for free via `instanceIndex`; a
 * per-node render (one mesh each) would give every tree phase 0 → a whole
 * variant sways in unison.
 */
export function InstancedNodes<N extends Placeable>({
  nodes,
  variantKeyOf,
  getVariant,
  localSpace = false,
}: {
  nodes: N[]
  variantKeyOf: (node: N) => string
  getVariant: (node: N) => VariantData
  localSpace?: boolean
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, { sample: N; nodes: N[] }>()
    for (const node of nodes) {
      const key = variantKeyOf(node)
      const bucket = map.get(key)
      if (bucket) bucket.nodes.push(node)
      else map.set(key, { sample: node, nodes: [node] })
    }
    return Array.from(map, ([key, value]) => ({ key, ...value }))
  }, [nodes, variantKeyOf])

  return (
    <>
      {buckets.map((bucket) => (
        <Variant
          getVariant={getVariant}
          key={bucket.key}
          localSpace={localSpace}
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
  localSpace,
}: {
  sample: N
  nodes: N[]
  getVariant: (node: N) => VariantData
  localSpace: boolean
}) {
  const data = useMemo(() => getVariant(sample), [sample, getVariant])
  return (
    <>
      {data.subMeshes.map((subMesh, i) => (
        <InstancedSubMesh
          key={i}
          localSpace={localSpace}
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
  localSpace,
}: {
  subMesh: SubMesh
  nodes: N[]
  naturalHeight: number
  localSpace: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  // Round capacity up so the InstancedMesh isn't recreated on every placement —
  // only when crossing a 32-instance boundary. `dispose={null}` keeps the shared
  // (cached) geometry/material alive across any recreation.
  const capacity = Math.max(16, Math.ceil(nodes.length / 32) * 32)

  // Snapshot of each referenced parent level's matrixWorld at the last matrix
  // write — the per-frame staleness check below compares against it so a level
  // move (explode, elevation edit) refreshes instances without a node change.
  const parentWorlds = useRef(new Map<string, number[]>())
  const writeMatrices = useCallback(() => {
    const mesh = ref.current
    if (!mesh) return
    parentWorlds.current.clear()
    const sceneNodes = useScene.getState().nodes
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (!node) continue
      const scale = node.height / naturalHeight
      DUMMY.position.set(node.position[0], plantElevation(node, sceneNodes), node.position[2])
      DUMMY.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])
      DUMMY.scale.set(scale, scale, scale)
      DUMMY.updateMatrix()
      // `localSpace`: portaled into the parent level, which supplies the level
      // transform — matrices stay level-local. Otherwise instances live at the
      // scene root, so fold in the parent level's world matrix.
      const parent =
        !localSpace && node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined
      if (parent && node.parentId) {
        parent.updateWorldMatrix(true, false)
        if (!parentWorlds.current.has(node.parentId)) {
          parentWorlds.current.set(node.parentId, parent.matrixWorld.toArray())
        }
        INSTANCE_MATRIX.multiplyMatrices(parent.matrixWorld, DUMMY.matrix)
        mesh.setMatrixAt(i, INSTANCE_MATRIX)
      } else {
        mesh.setMatrixAt(i, DUMMY.matrix)
      }
    }
    mesh.count = nodes.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [nodes, naturalHeight, localSpace])

  useLayoutEffect(() => {
    writeMatrices()
  }, [writeMatrices])

  // Two things can invalidate the written matrices with no change to any node of
  // this kind, so both are checked per frame:
  //
  // - the parent level's world transform (explode, level-height edits), which is
  //   baked into every instance matrix, and
  // - the floor a plant stands on: a deck slab raised, or the ground sculpted —
  //   and a terrain stroke publishes to a transient store, never touching the
  //   scene graph, so there is no node change to observe.
  //
  // The floor case rides the host's dirty marks (it marks every `floorPlaced` node
  // at grade on each dab) rather than re-resolving every instance: a forest would
  // be thousands of spatial queries per frame for a signal that is idle almost
  // always. Reading the marks *here* rather than in an effect is deliberate — this
  // callback has no explicit priority, so it runs before the priority-2 pass in
  // `InstancedKindSystem` that consumes them, whereas a React effect might not
  // flush until after the marks were already cleared.
  useFrame(() => {
    if (!ref.current) return
    if (!localSpace) {
      for (const [id, cached] of parentWorlds.current) {
        const parent = sceneRegistry.nodes.get(id)
        if (!parent) continue
        parent.updateWorldMatrix(true, false)
        const elements = parent.matrixWorld.elements
        for (let i = 0; i < 16; i += 1) {
          if (elements[i] !== cached[i]) {
            writeMatrices()
            return
          }
        }
      }
    }
    const { dirtyNodes } = useScene.getState()
    if (dirtyNodes.size === 0) return
    for (const node of nodes) {
      if (node && dirtyNodes.has(node.id as AnyNodeId)) {
        writeMatrices()
        return
      }
    }
  })

  return (
    <instancedMesh
      args={[subMesh.geometry as BufferGeometry, subMesh.material as Material, capacity]}
      castShadow
      dispose={null}
      frustumCulled={false}
      raycast={localSpace ? NO_RAYCAST : undefined}
      ref={ref}
    />
  )
}

// ── Per-node selection proxy (a `def.renderer`) ──────────────────────────────

const toStatic = (material: Material | Material[]) =>
  Array.isArray(material) ? material.map(toStaticMaterial) : toStaticMaterial(material)

/**
 * Per-node proxy that keeps the host's selection machinery working for an
 * instanced kind. The registered group carries the node transform (host
 * contract: move tools drive `sceneRegistry.nodes.get(id)` imperatively with
 * absolute level-local positions and mirror them via `useLiveTransforms` —
 * see `ParametricNodeRenderer`), so registering a nested child would apply
 * drag deltas in the node's rotated frame. The box collider is a positioned
 * sibling: the raycast target, kept out of the registered group so the
 * outline pass (which traces the registered object) shows the true
 * silhouette, not a box.
 *
 * While hovered/selected the collective system skips this node and the proxy
 * mounts the real geometry with **static twins** of the wind materials — the
 * outline mask renders with an override material and can't follow GPU sway,
 * so the plant holds still while outlined and the silhouette matches exactly.
 * During a GLB export the geometry mounts with the real materials instead, so
 * the exporter (which clones only the `scene-renderer` subtree, not the
 * collective InstancedMesh) captures each plant; the collider is dropped so it
 * doesn't bake as a phantom solid.
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
  const registeredRef = useRef<Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  const active = useViewer(
    (s) => s.hoveredId === node.id || s.selection.selectedIds.includes(node.id as never),
  )
  const showGeometry = active || isExporting

  // Live drag transform — the move tool writes the same absolute position
  // imperatively to the registered group; applying it React-side too keeps the
  // two in agreement (and moves the collider along with the drag). The rotate /
  // resize gizmos publish through `useLiveNodeOverrides` instead — fold that in
  // too (mirrors ParametricNodeRenderer) so the plant turns live mid-drag
  // rather than snapping on commit.
  const live = useLiveTransforms((s) => s.get(node.id))
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const overridePosition = liveOverride?.position as [number, number, number] | undefined
  const overrideRotation = liveOverride?.rotation as [number, number, number] | undefined
  const position = live?.position ?? overridePosition ?? node.position ?? [0, 0, 0]
  const baseRotation = overrideRotation ?? node.rotation ?? [0, 0, 0]
  const rotation: [number, number, number] = live
    ? [baseRotation[0], live.rotation, baseRotation[2]]
    : baseRotation

  const height = Math.max(0.2, node.height ?? 1)
  const radius = colliderRadius(node)
  const variant = useMemo(
    () => (showGeometry ? getVariant(node) : null),
    [showGeometry, node, getVariant],
  )
  const geometryScale = variant ? height / variant.naturalHeight : 1

  // The registered group's Y is the host's: `FloorElevationSystem` overwrites it
  // every frame with the resolved floor lift. The collider is a *sibling* of that
  // group (so the outline pass traces the real silhouette, not a box), which puts
  // it outside the host's reach — resolve the same lift for it here, or the hit
  // volume stays at the storey plane while the plant it stands for rides a deck
  // or a hillside.
  const colliderY = plantElevation({ ...node, position }) + height / 2

  return (
    <group visible={node.visible !== false} {...handlers}>
      {!isExporting && (
        <mesh position={[position[0], colliderY, position[2]]}>
          <boxGeometry args={[radius * 2, height, radius * 2]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      <group position={position} ref={registeredRef} rotation={rotation}>
        {variant && (
          <group scale={geometryScale}>
            {variant.subMeshes.map((subMesh, i) => (
              <mesh
                dispose={null}
                geometry={subMesh.geometry}
                key={i}
                material={isExporting ? subMesh.material : toStatic(subMesh.material)}
                raycast={NO_RAYCAST}
              />
            ))}
          </group>
        )}
      </group>
    </group>
  )
}
