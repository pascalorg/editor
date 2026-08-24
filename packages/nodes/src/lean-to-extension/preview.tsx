'use client'

import type { LeanToExtensionNode } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { Color, type Material, Mesh } from 'three'
import { INVALID_GHOST_COLOR } from '../shared/ghost-materials'
import { buildLeanToExtensionGeometry } from './geometry'

const LeanToExtensionPreview = ({
  node,
  invalid,
}: {
  node: LeanToExtensionNode
  invalid?: boolean
}) => {
  const shading = useViewer((state) => state.shading)
  const colorPreset = useViewer((state) => state.colorPreset)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const built = useMemo(
    () => buildLeanToExtensionGeometry(node, undefined, shading, true, colorPreset, sceneTheme),
    [node, shading, colorPreset, sceneTheme],
  )

  useEffect(() => {
    const originals: Array<{ mesh: Mesh; material: Material | Material[] }> = []
    const ownedMaterials: Material[] = []
    built.traverse((object) => {
      object.layers.set(EDITOR_LAYER)
      object.raycast = () => {}
      if (!(object instanceof Mesh)) return
      originals.push({ mesh: object, material: object.material })
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
      const materials = sourceMaterials.map((material) => {
        const copy = material.clone()
        copy.transparent = true
        copy.opacity = invalid ? 0.4 : 0.5
        copy.depthWrite = false
        if (invalid) {
          if ('color' in copy && copy.color instanceof Color) {
            copy.color.setHex(INVALID_GHOST_COLOR)
          }
          if ('emissive' in copy && copy.emissive instanceof Color) {
            copy.emissive.setHex(INVALID_GHOST_COLOR)
          }
        }
        ownedMaterials.push(copy)
        return copy
      })
      object.material = Array.isArray(object.material) ? materials : materials[0]!
    })
    return () => {
      for (const { mesh, material } of originals) mesh.material = material
      for (const material of ownedMaterials) material.dispose()
    }
  }, [built, invalid])

  useEffect(
    () => () => {
      built.traverse((object) => {
        const mesh = object as { geometry?: { dispose: () => void } }
        mesh.geometry?.dispose()
      })
    },
    [built],
  )

  return <primitive object={built} />
}

export default LeanToExtensionPreview
