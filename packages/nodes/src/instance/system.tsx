'use client'

import {
  type AnyNodeId,
  buildCollectionMembershipIndex,
  type DefinitionId,
  type InstanceNode,
  isHiddenByCollections,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useDefinitionEditContext } from '@pascal-app/editor'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { type InstancedMesh, type Material, Matrix4, type Object3D } from 'three'
import { DefinitionSourceProvider } from './definition-source-context'
import {
  clearDefinitionRenderData,
  hasDefinitionRenderData,
  publishDefinitionRenderData,
  useDefinitionRenderData,
} from './render-cache'
import { captureDefinitionRenderData } from './render-data'

type MatrixSnapshot = {
  elements: number[]
  visible: boolean
}

type MaterialSlot = Material | Material[]

const DEFINITION_CONTEXT_OPACITY = 0.18
const DEFINITION_CONTEXT_MAP_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
] as const
const definitionContextMaterialCache = new WeakMap<
  Material,
  { clone: Material; map: unknown; version: number }
>()

function getDefinitionContextMaterial(base: Material): Material {
  const baseMap = (base as { map?: unknown }).map ?? null
  const cached = definitionContextMaterialCache.get(base)
  if (cached && cached.map === baseMap && cached.version === base.version) return cached.clone

  const clone = base.clone()
  const source = base as unknown as Record<string, unknown>
  const target = clone as unknown as Record<string, unknown>
  // WebGPU node-material clones drop texture nodes, so preserve the source maps.
  for (const key of DEFINITION_CONTEXT_MAP_KEYS) {
    if (source[key]) target[key] = source[key]
  }
  clone.transparent = true
  clone.opacity = Math.min(base.opacity, DEFINITION_CONTEXT_OPACITY)
  clone.depthWrite = false
  clone.userData = { ...base.userData, __pascalDefinitionContext: true }
  clone.needsUpdate = true
  definitionContextMaterialCache.set(base, { clone, map: baseMap, version: base.version })
  return clone
}

function getDefinitionContextMaterialSlot(material: MaterialSlot): MaterialSlot {
  return Array.isArray(material)
    ? material.map(getDefinitionContextMaterial)
    : getDefinitionContextMaterial(material)
}

function materialSlotKey(material: MaterialSlot): string {
  return (Array.isArray(material) ? material : [material])
    .map((entry) => `${entry.uuid}:${entry.version}`)
    .join(',')
}

function isFreshPlacement(node: InstanceNode): boolean {
  return (
    typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata) &&
    node.metadata.isNew === true
  )
}

function isVisibleInHierarchy(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function DefinitionSource({
  definitionId,
  rootNodeId,
  editingInstanceId,
}: {
  definitionId: DefinitionId
  rootNodeId: AnyNodeId
  editingInstanceId: AnyNodeId | null
}) {
  const ref = useRef<Object3D>(null!)
  const owner = useRef(Symbol(definitionId)).current
  const lastSignature = useRef<string | null>(null)
  const frameCount = useRef(0)
  const nodes = useScene((state) => state.nodes)
  const geometryRevision = useViewer((state) => state.geometryRevision)
  const editing = editingInstanceId !== null
  const subtreeSignature = useMemo(() => {
    const parts: string[] = []
    const pending = [rootNodeId]
    const visited = new Set<AnyNodeId>()
    while (pending.length > 0) {
      const id = pending.pop()
      if (!id || visited.has(id)) continue
      visited.add(id)
      const node = nodes[id]
      if (!node) continue
      parts.push(JSON.stringify(node))
      const children = (node as { children?: AnyNodeId[] }).children
      if (children) pending.push(...children)
    }
    return parts.join('|')
  }, [nodes, rootNodeId])

  const capture = useCallback(() => {
    if (!ref.current) return
    const data = captureDefinitionRenderData(ref.current)
    if (data.signature === lastSignature.current) return
    lastSignature.current = data.signature
    publishDefinitionRenderData(definitionId, owner, data)
  }, [definitionId, owner])

  useLayoutEffect(() => {
    void subtreeSignature
    void geometryRevision
    capture()
  }, [capture, geometryRevision, subtreeSignature])

  useLayoutEffect(
    () => () => {
      clearDefinitionRenderData(definitionId, owner)
    },
    [definitionId, owner],
  )

  const syncEditTransform = useCallback(() => {
    if (!(editing && editingInstanceId && ref.current)) return
    const instanceAnchor = sceneRegistry.nodes.get(editingInstanceId)
    if (!instanceAnchor) return
    instanceAnchor.updateWorldMatrix(true, false)
    const parent = ref.current.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      ref.current.matrix.copy(parent.matrixWorld).invert().multiply(instanceAnchor.matrixWorld)
    } else {
      ref.current.matrix.copy(instanceAnchor.matrixWorld)
    }
    ref.current.matrixWorldNeedsUpdate = true
  }, [editing, editingInstanceId])

  useLayoutEffect(() => {
    syncEditTransform()
  }, [syncEditTransform])

  useFrame(() => {
    syncEditTransform()
    frameCount.current += 1
    if (frameCount.current <= 5 || frameCount.current % 30 === 0) capture()
  })

  return (
    <group
      matrixAutoUpdate={false}
      ref={ref}
      userData={{
        definitionEditSource: editing ? definitionId : undefined,
        measurementSurface: false,
      }}
      visible={editing}
    >
      <DefinitionSourceProvider>
        <NodeRenderer nodeId={rootNodeId} />
      </DefinitionSourceProvider>
    </group>
  )
}

function DefinitionBatch({
  definitionId,
  faded,
  nodes,
}: {
  definitionId: DefinitionId
  faded: boolean
  nodes: InstanceNode[]
}) {
  const data = useDefinitionRenderData(definitionId)
  const meshRefs = useRef<Array<InstancedMesh | null>>([])
  const snapshots = useRef(new Map<string, MatrixSnapshot>())
  const capacity = Math.max(16, Math.ceil(nodes.length / 32) * 32)
  const materials = useMemo(
    () =>
      data?.parts.map((part) =>
        faded ? getDefinitionContextMaterialSlot(part.material) : part.material,
      ) ?? [],
    [data, faded],
  )

  const writeMatrices = useCallback(() => {
    if (!data) return
    const nodeIds: string[] = []
    const nextSnapshots = new Map<string, MatrixSnapshot>()
    const instanceMatrix = new Matrix4()
    let count = 0

    for (const node of nodes) {
      const anchor = sceneRegistry.nodes.get(node.id)
      if (!anchor) {
        nextSnapshots.set(node.id, { elements: [], visible: false })
        continue
      }
      anchor.updateWorldMatrix(true, false)
      const visible = isVisibleInHierarchy(anchor)
      nextSnapshots.set(node.id, { elements: anchor.matrixWorld.toArray(), visible })
      if (!visible) continue

      for (let partIndex = 0; partIndex < data.parts.length; partIndex += 1) {
        const mesh = meshRefs.current[partIndex]
        const part = data.parts[partIndex]
        if (!(mesh && part)) continue
        instanceMatrix.multiplyMatrices(anchor.matrixWorld, part.matrix)
        mesh.setMatrixAt(count, instanceMatrix)
      }
      nodeIds.push(node.id)
      count += 1
    }

    snapshots.current = nextSnapshots
    for (const mesh of meshRefs.current) {
      if (!mesh) continue
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      mesh.userData.instanceNodeIds = nodeIds
      mesh.computeBoundingSphere()
    }
  }, [data, nodes])

  const matricesAreStale = useCallback(() => {
    if (snapshots.current.size !== nodes.length) return true
    for (const node of nodes) {
      const anchor = sceneRegistry.nodes.get(node.id)
      const previous = snapshots.current.get(node.id)
      if (!anchor) {
        if (previous?.elements.length !== 0) return true
        continue
      }
      anchor.updateWorldMatrix(true, false)
      const visible = isVisibleInHierarchy(anchor)
      if (!previous || previous.visible !== visible) return true
      const elements = anchor.matrixWorld.elements
      for (let index = 0; index < 16; index += 1) {
        if (elements[index] !== previous.elements[index]) return true
      }
    }
    return false
  }, [nodes])

  useLayoutEffect(() => {
    writeMatrices()
  }, [writeMatrices])

  useFrame(() => {
    if (matricesAreStale()) writeMatrices()
  })

  if (!data || data.parts.length === 0) return null

  return (
    <>
      {data.parts.map((part, index) => (
        <instancedMesh
          args={[part.geometry, (materials[index] ?? part.material) as Material, capacity]}
          castShadow={part.castShadow}
          dispose={null}
          frustumCulled={false}
          key={`${part.key}:${faded ? 'faded' : 'normal'}:${materialSlotKey(
            materials[index] ?? part.material,
          )}`}
          name={`definition:${definitionId}:${part.name || index}`}
          receiveShadow={part.receiveShadow}
          ref={(mesh) => {
            meshRefs.current[index] = mesh
          }}
          renderOrder={part.renderOrder}
          userData={{
            definitionId,
            instanceNodeIds: [],
            measurementSurface: true,
          }}
        />
      ))}
    </>
  )
}

export default function InstanceSystem() {
  const sceneNodes = useScene((state) => state.nodes)
  const definitions = useScene((state) => state.definitions)
  const collections = useScene((state) => state.collections)
  const hoveredId = useViewer((state) => state.hoveredId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const previewSelectedIds = useViewer((state) => state.previewSelectedIds)
  const externalSelectedIds = useViewer((state) => state.externalSelectedIds)
  const isExporting = useViewer((state) => state.isExporting)
  const definitionEditContext = useDefinitionEditContext()

  const allInstances = useMemo(
    () => Object.values(sceneNodes).filter((node) => node.type === 'instance') as InstanceNode[],
    [sceneNodes],
  )
  const referencedDefinitionIds = useMemo(
    () =>
      Array.from(
        new Set(
          allInstances
            .map((node) => node.definitionId)
            .filter((id): id is DefinitionId => definitions[id] !== undefined),
        ),
      ),
    [allInstances, definitions],
  )
  const batches = useMemo(() => {
    const activeIds = new Set<string>([
      ...(hoveredId ? [hoveredId] : []),
      ...selectedIds,
      ...previewSelectedIds,
      ...externalSelectedIds,
    ])
    const membership = buildCollectionMembershipIndex(collections)
    const editingSubtreeIds = new Set<AnyNodeId>()
    if (definitionEditContext) {
      const pending = [definitionEditContext.rootNodeId]
      while (pending.length > 0) {
        const id = pending.pop()
        if (!id || editingSubtreeIds.has(id)) continue
        const node = sceneNodes[id]
        if (!node) continue
        editingSubtreeIds.add(id)
        if ('children' in node && Array.isArray(node.children)) {
          pending.push(...(node.children as AnyNodeId[]))
        }
      }
    }
    const map = new Map<DefinitionId, InstanceNode[]>()
    if (isExporting) return map
    for (const node of allInstances) {
      if (
        activeIds.has(node.id) ||
        node.id === definitionEditContext?.instanceId ||
        editingSubtreeIds.has(node.id) ||
        isFreshPlacement(node) ||
        node.visible === false ||
        isHiddenByCollections(membership, node.id) ||
        !definitions[node.definitionId]
      ) {
        continue
      }
      const batch = map.get(node.definitionId)
      if (batch) batch.push(node)
      else map.set(node.definitionId, [node])
    }
    return map
  }, [
    allInstances,
    collections,
    definitions,
    definitionEditContext,
    externalSelectedIds,
    hoveredId,
    isExporting,
    previewSelectedIds,
    sceneNodes,
    selectedIds,
  ])

  useFrame(() => {
    const state = useScene.getState()
    if (state.dirtyNodes.size === 0) return
    for (const id of state.dirtyNodes) {
      const node = state.nodes[id]
      if (node?.type !== 'instance') continue
      if (!state.definitions[node.definitionId] || hasDefinitionRenderData(node.definitionId)) {
        state.clearDirty(id)
      }
    }
  }, 3)

  return (
    <>
      {referencedDefinitionIds.map((definitionId) => {
        const definition = definitions[definitionId]
        if (!definition) return null
        return (
          <DefinitionSource
            definitionId={definitionId}
            editingInstanceId={
              definitionEditContext?.definitionId === definitionId
                ? definitionEditContext.instanceId
                : null
            }
            key={`definition-source:${definitionId}`}
            rootNodeId={definition.rootNodeId}
          />
        )
      })}
      {Array.from(batches, ([definitionId, nodes]) => (
        <DefinitionBatch
          definitionId={definitionId}
          faded={definitionEditContext !== null}
          key={`definition-batch:${definitionId}`}
          nodes={nodes}
        />
      ))}
    </>
  )
}
