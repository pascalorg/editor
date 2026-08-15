'use client'

import { collectDefinitionSubtreeNodeIds, sceneRegistry, useScene } from '@pascal-app/core'
import { SCENE_LAYER } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { Material, Mesh, Object3D } from 'three'
import { useDefinitionEditContext } from '../../store/use-interaction-scope'

type MaterialSlot = Material | Material[]

type IsolationRecord = {
  original: MaterialSlot
  faded: MaterialSlot
}

const DEFINITION_CONTEXT_OPACITY = 0.18

function isVisibleInHierarchy(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function isSceneMesh(object: Object3D): object is Mesh {
  return (
    'isMesh' in object &&
    object.isMesh === true &&
    !('isInstancedMesh' in object && object.isInstancedMesh === true) &&
    object.layers.isEnabled(SCENE_LAYER)
  )
}

function createFadedSlot(original: MaterialSlot, cache: Map<Material, Material>): MaterialSlot {
  const fade = (material: Material) => {
    const cached = cache.get(material)
    if (cached) return cached
    const faded = material.clone()
    faded.transparent = true
    faded.opacity = Math.min(material.opacity, DEFINITION_CONTEXT_OPACITY)
    faded.depthWrite = false
    faded.userData = { ...material.userData, __pascalDefinitionContext: true }
    faded.needsUpdate = true
    cache.set(material, faded)
    return faded
  }
  return Array.isArray(original) ? original.map(fade) : fade(original)
}

export function DefinitionEditIsolation() {
  const invalidate = useThree((state) => state.invalidate)
  const context = useDefinitionEditContext()
  const nodes = useScene((state) => state.nodes)
  const recordsRef = useRef(new Map<Mesh, IsolationRecord>())
  const materialCacheRef = useRef(new Map<Material, Material>())

  const restore = useCallback(() => {
    for (const [mesh, record] of recordsRef.current) {
      if (mesh.material === record.faded) mesh.material = record.original
    }
    recordsRef.current.clear()
    for (const material of materialCacheRef.current.values()) material.dispose()
    materialCacheRef.current.clear()
  }, [])

  const apply = useCallback(() => {
    if (!context) return
    const editingIds = collectDefinitionSubtreeNodeIds(nodes, context.rootNodeId)
    const fadedMeshes = new Set<Mesh>()

    const fadeObject = (object: Object3D) => {
      if (!isVisibleInHierarchy(object)) return
      object.traverse((child) => {
        if (!isSceneMesh(child)) return
        fadedMeshes.add(child)
        const existing = recordsRef.current.get(child)
        if (existing?.faded === child.material) return
        if (existing) recordsRef.current.delete(child)
        const original = child.material
        const faded = createFadedSlot(original, materialCacheRef.current)
        recordsRef.current.set(child, { original, faded })
        child.material = faded
      })
    }

    for (const [nodeId, object] of sceneRegistry.nodes) {
      if (editingIds.has(nodeId)) continue
      fadeObject(object)
    }

    for (const [mesh, record] of recordsRef.current) {
      if (fadedMeshes.has(mesh)) continue
      if (mesh.material === record.faded) mesh.material = record.original
      recordsRef.current.delete(mesh)
    }
  }, [context, nodes])

  useLayoutEffect(() => {
    if (context) apply()
    else restore()
    invalidate()
    return () => {
      restore()
      invalidate()
    }
  }, [apply, context, invalidate, restore])

  useFrame(() => {
    if (context) apply()
  })

  return null
}
