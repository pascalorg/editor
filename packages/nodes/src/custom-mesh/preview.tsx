'use client'

import type { CustomMeshNode } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import { Color, type Material, Mesh } from 'three'
import { buildCustomMeshGeometry } from './geometry'

export default function CustomMeshPreview({
  node,
  valid = true,
}: {
  node: CustomMeshNode
  valid?: boolean
}) {
  const preview = useMemo(() => {
    const next = buildCustomMeshGeometry(node)
    const ownedMaterials: Material[] = []
    next.traverse((child) => {
      child.layers.set(EDITOR_LAYER)
      child.raycast = () => {}
      if (!(child instanceof Mesh)) return
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
      const materials = sourceMaterials.map((material) => material.clone())
      for (const material of materials) {
        material.transparent = true
        material.opacity = 0.52
        material.depthWrite = false
        if (!valid && 'color' in material && material.color instanceof Color) {
          material.color.set('#ef4444')
        }
      }
      ownedMaterials.push(...materials)
      child.material = Array.isArray(child.material) ? materials : materials[0]!
    })
    return { object: next, ownedMaterials }
  }, [node, valid])

  useEffect(
    () => () => {
      preview.object.traverse((child) => {
        if (!(child instanceof Mesh)) return
        child.geometry.dispose()
      })
      for (const material of preview.ownedMaterials) material.dispose()
    },
    [preview],
  )

  return <primitive object={preview.object} />
}
