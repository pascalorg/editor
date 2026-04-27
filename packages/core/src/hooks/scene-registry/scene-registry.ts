'use client'

import { useLayoutEffect } from 'react'
import type { BufferGeometry, Object3D } from 'three'
import { Box3, Matrix4 } from 'three'

type SceneBoundsEntry = {
  dynamic: boolean
  localBounds: Box3 | null
  object: Object3D
}

const inverseRootWorldMatrix = new Matrix4()
const childMatrixInRootSpace = new Matrix4()
const childBoundsScratch = new Box3()

function getObjectGeometryBounds(object: Object3D) {
  const geometry = (object as Object3D & { geometry?: BufferGeometry | null }).geometry
  if (!geometry) {
    return null
  }

  if (geometry.boundingBox === null) {
    geometry.computeBoundingBox()
  }

  return geometry.boundingBox ?? null
}

function hasDynamicBoundsSubtree(root: Object3D) {
  let dynamic = false

  root.traverse((child) => {
    if (dynamic) {
      return
    }

    const maybeAnimatedChild = child as Object3D & {
      isSkinnedMesh?: boolean
      morphTargetInfluences?: unknown[] | undefined
    }

    if (
      maybeAnimatedChild.isSkinnedMesh ||
      (Array.isArray(maybeAnimatedChild.morphTargetInfluences) &&
        maybeAnimatedChild.morphTargetInfluences.length > 0) ||
      child.userData?.navigationDoor
    ) {
      dynamic = true
    }
  })

  return dynamic
}

function computeLocalBounds(root: Object3D) {
  root.updateWorldMatrix(true, true)
  inverseRootWorldMatrix.copy(root.matrixWorld).invert()

  let initialized = false
  const localBounds = new Box3()

  root.traverse((child) => {
    const geometryBounds = getObjectGeometryBounds(child)
    if (!geometryBounds) {
      return
    }

    childMatrixInRootSpace.multiplyMatrices(inverseRootWorldMatrix, child.matrixWorld)
    childBoundsScratch.copy(geometryBounds).applyMatrix4(childMatrixInRootSpace)

    if (initialized) {
      localBounds.union(childBoundsScratch)
    } else {
      localBounds.copy(childBoundsScratch)
      initialized = true
    }
  })

  return initialized ? localBounds : null
}

export const sceneRegistry = {
  // Master lookup: ID -> Object3D
  nodes: new Map<string, Object3D>(),
  bounds: new Map<string, SceneBoundsEntry>(),

  // Categorized lookups: Type -> Set of IDs
  // Using a Set is faster for adding/deleting than an Array
  byType: {
    site: new Set<string>(),
    building: new Set<string>(),
    ceiling: new Set<string>(),
    level: new Set<string>(),
    wall: new Set<string>(),
    fence: new Set<string>(),
    item: new Set<string>(),
    slab: new Set<string>(),
    zone: new Set<string>(),
    roof: new Set<string>(),
    'roof-segment': new Set<string>(),
    stair: new Set<string>(),
    'stair-segment': new Set<string>(),
    scan: new Set<string>(),
    guide: new Set<string>(),
    window: new Set<string>(),
    door: new Set<string>(),
  },

  /** Remove all entries. Call when unloading a scene to prevent stale 3D refs. */
  clear() {
    this.nodes.clear()
    this.bounds.clear()
    for (const set of Object.values(this.byType)) {
      set.clear()
    }
  },

  getWorldBounds(id: string, target = new Box3()) {
    const object = this.nodes.get(id)
    if (!object) {
      return target.makeEmpty()
    }

    let entry = this.bounds.get(id)
    if (!entry || entry.object !== object) {
      const dynamic = hasDynamicBoundsSubtree(object)
      entry = {
        dynamic,
        localBounds: dynamic ? null : computeLocalBounds(object),
        object,
      }
      this.bounds.set(id, entry)
    }

    if (entry.dynamic) {
      object.updateWorldMatrix(true, true)
      return target.setFromObject(object)
    }

    if (!entry.localBounds) {
      return target.makeEmpty()
    }

    object.updateWorldMatrix(true, false)
    return target.copy(entry.localBounds).applyMatrix4(object.matrixWorld)
  },
}

export function useRegistry(
  id: string,
  type: keyof typeof sceneRegistry.byType,
  ref: React.RefObject<Object3D>,
) {
  useLayoutEffect(() => {
    const obj = ref.current
    if (!obj) return

    // 1. Add to master map
    sceneRegistry.nodes.set(id, obj)
    sceneRegistry.bounds.delete(id)

    // 2. Add to type-specific set
    sceneRegistry.byType[type].add(id)

    // 4. Cleanup when component unmounts
    return () => {
      sceneRegistry.nodes.delete(id)
      sceneRegistry.bounds.delete(id)
      sceneRegistry.byType[type].delete(id)
    }
  }, [id, type, ref])
}
