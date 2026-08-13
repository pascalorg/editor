'use client'

import type { LeanToExtensionNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import type { Material } from 'three'
import { buildLeanToExtensionGeometry } from './geometry'

const LeanToExtensionPreview = ({ node }: { node: LeanToExtensionNode }) => {
  const shading = useViewer((state) => state.shading)
  const colorPreset = useViewer((state) => state.colorPreset)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const built = useMemo(
    () => buildLeanToExtensionGeometry(node, undefined, shading, true, colorPreset, sceneTheme),
    [node, shading, colorPreset, sceneTheme],
  )

  useEffect(() => {
    const ownedMaterials: Material[] = []
    built.traverse((object) => {
      ;(object as unknown as { raycast: () => void }).raycast = () => {}
      const mesh = object as { material?: Material | Material[] }
      if (!mesh.material) return
      const clone = (material: Material) => {
        const copy = material.clone()
        copy.transparent = true
        copy.opacity = 0.5
        copy.depthWrite = false
        ownedMaterials.push(copy)
        return copy
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material)
    })
    return () => {
      for (const material of ownedMaterials) material.dispose()
      built.traverse((object) => {
        const mesh = object as { geometry?: { dispose: () => void } }
        mesh.geometry?.dispose()
      })
    }
  }, [built])

  return <primitive object={built} />
}

export default LeanToExtensionPreview
