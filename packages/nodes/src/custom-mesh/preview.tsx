'use client'

import type { CustomMeshNode } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import { type Material, Mesh } from 'three'
import { buildCustomMeshGeometry } from './geometry'

export default function CustomMeshPreview({ node }: { node: CustomMeshNode }) {
  const object = useMemo(() => {
    const next = buildCustomMeshGeometry(node)
    next.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        material.transparent = true
        material.opacity = 0.52
        material.depthWrite = false
      }
    })
    return next
  }, [node])

  useEffect(
    () => () => {
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return
        child.geometry.dispose()
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((material: Material) => {
          material.dispose()
        })
      })
    },
    [object],
  )

  return <primitive object={object} />
}
