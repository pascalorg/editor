import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { Material, Mesh } from 'three'
import { createGhostedMaterial, isGhostedSceneMesh } from '../../lib/ghosted-material'
import useViewer from '../../store/use-viewer'

type MaterialSlot = Material | Material[]

type GhostedRecord = {
  original: MaterialSlot
  ghosted: MaterialSlot
}

function createGhostedSlot(
  original: MaterialSlot,
  materialCache: Map<Material, Material>,
): MaterialSlot {
  const resolve = (material: Material) => {
    const cached = materialCache.get(material)
    if (cached) return cached
    const ghosted = createGhostedMaterial(material)
    materialCache.set(material, ghosted)
    return ghosted
  }

  return Array.isArray(original) ? original.map(resolve) : resolve(original)
}

export function GhostedMode() {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const shading = useViewer((state) => state.shading)
  const isExporting = useViewer((state) => state.isExporting)
  const recordsRef = useRef(new Map<Mesh, GhostedRecord>())
  const materialCacheRef = useRef(new Map<Material, Material>())
  const active = shading === 'ghosted' && !isExporting

  const restore = useCallback(() => {
    for (const [mesh, record] of recordsRef.current) {
      if (mesh.material === record.ghosted) mesh.material = record.original
    }
    recordsRef.current.clear()
    for (const material of materialCacheRef.current.values()) material.dispose()
    materialCacheRef.current.clear()
  }, [])

  const apply = useCallback(() => {
    scene.traverse((object) => {
      if (!isGhostedSceneMesh(object)) return

      const existing = recordsRef.current.get(object)
      if (existing?.ghosted === object.material) return
      if (existing) recordsRef.current.delete(object)

      const original = object.material
      const ghosted = createGhostedSlot(original, materialCacheRef.current)
      recordsRef.current.set(object, { original, ghosted })
      object.material = ghosted
    })
  }, [scene])

  useLayoutEffect(() => {
    if (active) apply()
    else restore()
    invalidate()

    return () => {
      restore()
      invalidate()
    }
  }, [active, apply, invalidate, restore])

  // Geometry systems and async GLB loaders can replace materials without a
  // React commit, so discover those swaps immediately before the render pass.
  useFrame(() => {
    if (active) apply()
  })

  return null
}
