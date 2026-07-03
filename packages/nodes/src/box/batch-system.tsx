'use client'

import {
  type AnyNodeId,
  type BoxNode,
  type EventSuffix,
  emitter,
  type NodeEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
} from '@pascal-app/viewer/materials'
import { ensureWebGPUCompatibleGeometry } from '@pascal-app/viewer/safe-geometry'
import useViewer, {
  isViewerSelectionInputSuppressed,
  isViewerSpatialInputSuppressed,
  shouldLatchViewerPointerSuppression,
} from '@pascal-app/viewer/store'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  primitiveBatchDisabled,
  primitiveContractFromMetadata,
  primitivePatternInstances,
} from '../shared/primitive-contract-rendering'

type BoxBatch = {
  key: string
  length: number
  height: number
  width: number
  nodes: BoxNode[]
}

const MIN_BATCH_SIZE = 3

const tempMatrix = new THREE.Matrix4()
const tempInverse = new THREE.Matrix4()
const tempLocalPoint = new THREE.Vector3()

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function dimensionKey(value: number | undefined, fallback = 1): string {
  return String(Number.isFinite(value) ? value : fallback)
}

function materialKey(node: BoxNode): string {
  return `preset:${node.materialPreset ?? ''}|material:${stableStringify(node.material ?? null)}`
}

function hasCutouts(node: BoxNode): boolean {
  return (primitiveContractFromMetadata(node.metadata)?.cutouts?.length ?? 0) > 0
}

function canBatchBox(node: BoxNode, excludedIds: ReadonlySet<string>): boolean {
  if (node.visible === false) return false
  if (excludedIds.has(node.id)) return false
  if (primitiveBatchDisabled(node.metadata)) return false
  if ((node.cornerRadius ?? 0) > 0) return false
  if (primitivePatternInstances(node.metadata).length > 0) return false
  if (hasCutouts(node)) return false
  return true
}

function buildBoxBatches(
  nodes: Record<AnyNodeId, unknown>,
  excludedIds: ReadonlySet<string>,
): BoxBatch[] {
  const groups = new Map<string, BoxBatch>()

  for (const node of Object.values(nodes)) {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'box') continue
    const box = node as BoxNode
    if (!canBatchBox(box, excludedIds)) continue

    const length = box.length ?? 1
    const height = box.height ?? 1
    const width = box.width ?? 1
    const key = [
      dimensionKey(box.length),
      dimensionKey(box.height),
      dimensionKey(box.width),
      materialKey(box),
    ].join('|')

    const existing = groups.get(key)
    if (existing) {
      existing.nodes.push(box)
    } else {
      groups.set(key, { key, length, height, width, nodes: [box] })
    }
  }

  return Array.from(groups.values()).filter((batch) => batch.nodes.length >= MIN_BATCH_SIZE)
}

function emitNodeEvent(
  suffix: EventSuffix,
  node: BoxNode,
  mesh: THREE.InstancedMesh,
  instanceId: number,
  event: ThreeEvent<PointerEvent>,
) {
  mesh.getMatrixAt(instanceId, tempMatrix)
  tempInverse.copy(tempMatrix).invert()
  tempLocalPoint.copy(event.point).applyMatrix4(tempInverse)

  const payload: NodeEvent<BoxNode> = {
    node,
    position: [event.point.x, event.point.y, event.point.z],
    localPosition: [tempLocalPoint.x, tempLocalPoint.y, tempLocalPoint.z],
    normal: event.face
      ? [event.face.normal.x, event.face.normal.y, event.face.normal.z]
      : undefined,
    faceIndex: event.faceIndex ?? undefined,
    object: mesh,
    stopPropagation: () => event.stopPropagation(),
    nativeEvent: event,
  }

  emitter.emit(`box:${suffix}`, payload as never)
}

function useBatchedOriginalVisibility(batchedIds: ReadonlySet<string>) {
  const previouslyBatched = useRef<Set<string>>(new Set())

  useLayoutEffect(() => {
    const previous = previouslyBatched.current
    for (const id of previous) {
      if (batchedIds.has(id)) continue
      const obj = sceneRegistry.nodes.get(id)
      const node = useScene.getState().nodes[id as AnyNodeId] as BoxNode | undefined
      if (obj) obj.visible = node?.visible !== false
    }
    previouslyBatched.current = new Set(batchedIds)

    return () => {
      for (const id of batchedIds) {
        const obj = sceneRegistry.nodes.get(id)
        const node = useScene.getState().nodes[id as AnyNodeId] as BoxNode | undefined
        if (obj) obj.visible = node?.visible !== false
      }
    }
  }, [batchedIds])

  useFrame(() => {
    for (const id of batchedIds) {
      const obj = sceneRegistry.nodes.get(id)
      if (obj?.visible) obj.visible = false
    }
  }, 20)
}

function BoxBatchMesh({ batch }: { batch: BoxBatch }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const lastClickRef = useRef<{ time: number; x: number; y: number; instanceId: number } | null>(
    null,
  )
  const suppressedPointerRef = useRef(false)
  const suppressNativeClickUntilRef = useRef(0)
  const nodesByIndex = batch.nodes
  const shading = useViewer((state) => state.shading)

  const geometry = useMemo(() => {
    const boxGeometry = new THREE.BoxGeometry(batch.length, batch.height, batch.width)
    return ensureWebGPUCompatibleGeometry(boxGeometry)
  }, [batch.length, batch.height, batch.width])

  const material = useMemo(() => {
    const exemplar = batch.nodes[0]
    const presetMaterial = createMaterialFromPresetRef(exemplar?.materialPreset, shading)
    if (presetMaterial) return presetMaterial
    if (exemplar?.material) return createMaterial(exemplar.material, shading)
    return createDefaultMaterial('#cccccc', 1, shading)
  }, [batch.nodes, shading])

  const applyMatrices = useCallback(() => {
    const mesh = meshRef.current
    if (!mesh) return false

    let complete = true
    for (let i = 0; i < nodesByIndex.length; i += 1) {
      const node = nodesByIndex[i]
      if (!node) continue
      const source = sceneRegistry.nodes.get(node.id)
      if (!source) {
        complete = false
        continue
      }
      source.updateWorldMatrix(true, false)
      mesh.setMatrixAt(i, source.matrixWorld)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    return complete
  }, [nodesByIndex])

  useLayoutEffect(() => {
    applyMatrices()
  }, [applyMatrices])

  const needsRegistryWarmup = useRef(true)
  useFrame(() => {
    if (!needsRegistryWarmup.current) return
    needsRegistryWarmup.current = !applyMatrices()
  }, 19)

  useLayoutEffect(() => () => geometry.dispose(), [geometry])

  const emit = (suffix: EventSuffix, event: ThreeEvent<PointerEvent>) => {
    const instanceId = event.instanceId
    if (instanceId == null) return
    const node = nodesByIndex[instanceId]
    if (!node) return
    emitNodeEvent(suffix, node, event.object as THREE.InstancedMesh, instanceId, event)
  }

  const emitClickAndMaybeDoubleClick = (event: ThreeEvent<PointerEvent>) => {
    const instanceId = event.instanceId
    if (instanceId == null) return
    emit('click', event)
    const now = performance.now()
    const lastClick = lastClickRef.current
    const dx = lastClick ? event.nativeEvent.clientX - lastClick.x : Infinity
    const dy = lastClick ? event.nativeEvent.clientY - lastClick.y : Infinity
    const isRepeatedClick =
      lastClick &&
      lastClick.instanceId === instanceId &&
      now - lastClick.time <= 800 &&
      Math.hypot(dx, dy) <= 6
    if (event.nativeEvent.detail >= 2 || isRepeatedClick) {
      suppressNativeClickUntilRef.current = performance.now() + 1000
      emit('double-click', event)
      lastClickRef.current = null
      return
    }
    lastClickRef.current = {
      time: now,
      x: event.nativeEvent.clientX,
      y: event.nativeEvent.clientY,
      instanceId,
    }
  }

  const selectionSuppressed = isViewerSelectionInputSuppressed
  const spatialSuppressed = isViewerSpatialInputSuppressed

  return (
    <instancedMesh
      args={[geometry, material, nodesByIndex.length]}
      castShadow
      name={`box-batch:${batch.key}`}
      onContextMenu={(event) => {
        if (selectionSuppressed()) return
        emit('context-menu', event as ThreeEvent<PointerEvent>)
      }}
      onDoubleClick={(event) => {
        if (performance.now() < suppressNativeClickUntilRef.current) return
        if (selectionSuppressed()) return
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if (selectionSuppressed()) {
          suppressedPointerRef.current = shouldLatchViewerPointerSuppression()
          suppressNativeClickUntilRef.current = performance.now() + 1000
          window.addEventListener(
            'pointerup',
            () => {
              suppressedPointerRef.current = false
            },
            { once: true },
          )
          return
        }
        emit('pointerdown', event)
      }}
      onPointerEnter={(event) => {
        if (spatialSuppressed()) return
        emit('enter', event)
      }}
      onPointerLeave={(event) => {
        if (spatialSuppressed()) return
        emit('leave', event)
      }}
      onPointerMove={(event) => {
        if (spatialSuppressed()) return
        emit('move', event)
      }}
      onPointerUp={(event) => {
        if (event.button !== 0) return
        if (suppressedPointerRef.current) {
          suppressedPointerRef.current = false
          return
        }
        if (selectionSuppressed()) return
        emit('pointerup', event)
        emitClickAndMaybeDoubleClick(event)
      }}
      receiveShadow
      ref={meshRef}
    />
  )
}

export default function BoxBatchSystem() {
  const nodes = useScene((state) => state.nodes)
  const selection = useViewer((state) => state.selection)
  const previewSelectedIds = useViewer((state) => state.previewSelectedIds)
  const hoveredId = useViewer((state) => state.hoveredId)
  const inputDragging = useViewer((state) => state.inputDragging)

  const excludedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of selection.selectedIds) ids.add(id)
    for (const id of previewSelectedIds) ids.add(id)
    if (hoveredId) ids.add(hoveredId)
    return ids
  }, [selection.selectedIds, previewSelectedIds, hoveredId])

  const batches = useMemo(() => {
    if (inputDragging) return []
    return buildBoxBatches(nodes as Record<AnyNodeId, unknown>, excludedIds)
  }, [nodes, excludedIds, inputDragging])

  const batchedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const batch of batches) {
      for (const node of batch.nodes) ids.add(node.id)
    }
    return ids
  }, [batches])

  useBatchedOriginalVisibility(batchedIds)

  return (
    <>
      {batches.map((batch) => (
        <BoxBatchMesh batch={batch} key={batch.key} />
      ))}
    </>
  )
}
