'use client'

import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type { Object3D } from 'three'
import {
  computeMeshLocalBoundsFromObject,
  computePlanFootprintPolygonLocal,
} from './compute-item-mesh-metadata'
import { drainItemMeshMetadataSyncRequests, getItemMeshMetadataSourceRoot } from './sync-request'

function isMetadataUnchanged(
  nextPolygon: [number, number][] | null,
  nextBounds: { min: [number, number, number]; max: [number, number, number] } | null,
  metadata: Record<string, unknown>,
): boolean {
  const currentPolygon = metadata.floorplanLocalPolygon
  const currentBounds =
    typeof metadata.meshLocalBounds === 'object' &&
    metadata.meshLocalBounds !== null &&
    !Array.isArray(metadata.meshLocalBounds)
      ? (metadata.meshLocalBounds as { min?: unknown; max?: unknown })
      : null

  const polygonUnchanged =
    (nextPolygon === null &&
      (currentPolygon === undefined || currentPolygon === null || currentPolygon === false)) ||
    (Array.isArray(currentPolygon) &&
      nextPolygon !== null &&
      currentPolygon.length === nextPolygon.length &&
      currentPolygon.every(
        (point, index) =>
          Array.isArray(point) &&
          point[0] === nextPolygon[index]?.[0] &&
          point[1] === nextPolygon[index]?.[1],
      ))

  const boundsUnchanged =
    (nextBounds === null && (currentBounds === undefined || currentBounds === null)) ||
    (nextBounds !== null &&
      Array.isArray(currentBounds?.min) &&
      Array.isArray(currentBounds?.max) &&
      currentBounds.min[0] === nextBounds.min[0] &&
      currentBounds.min[1] === nextBounds.min[1] &&
      currentBounds.min[2] === nextBounds.min[2] &&
      currentBounds.max[0] === nextBounds.max[0] &&
      currentBounds.max[1] === nextBounds.max[1] &&
      currentBounds.max[2] === nextBounds.max[2])

  return polygonUnchanged && boundsUnchanged
}

function trySyncItemMeshMetadata(itemId: string, nodes: Record<string, AnyNode | undefined>) {
  const node = nodes[itemId]
  if (!node || node.type !== 'item') return
  const root =
    getItemMeshMetadataSourceRoot(itemId) ??
    (sceneRegistry.nodes.get(itemId) as Object3D | undefined)
  if (!root) return

  const polygon = computePlanFootprintPolygonLocal(root)
  const bounds = computeMeshLocalBoundsFromObject(root)
  if (polygon.length < 3 && !bounds) return

  const nextPolygon =
    polygon.length >= 3 ? polygon.map(({ x, y }) => [x, y] as [number, number]) : null
  const nextBounds = bounds ? { min: bounds.min, max: bounds.max } : null

  const metadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}

  if (isMetadataUnchanged(nextPolygon, nextBounds, metadata)) return

  useScene.getState().updateNode(itemId as AnyNodeId, {
    metadata: {
      ...metadata,
      ...(nextPolygon ? { floorplanLocalPolygon: nextPolygon } : {}),
      ...(nextBounds ? { meshLocalBounds: nextBounds } : {}),
    },
  })
}

/**
 * Writes `floorplanLocalPolygon` / `meshLocalBounds` from loaded item meshes.
 * ModelRenderer requests sync via `requestItemMeshMetadataSync` when GLTF is ready.
 */
export function ItemMeshMetadataSystem() {
  useFrame(() => {
    const ids = drainItemMeshMetadataSyncRequests()
    if (ids.length === 0) return

    const nodes = useScene.getState().nodes
    for (const id of ids) {
      trySyncItemMeshMetadata(id, nodes)
    }
  })

  return null
}
