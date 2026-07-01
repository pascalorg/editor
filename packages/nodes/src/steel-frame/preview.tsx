'use client'

import { useEffect, useMemo } from 'react'
import type { MeshStandardMaterial } from 'three'
import { buildSteelFrameGeometry } from './geometry'
import type { SteelFrameNode } from './schema'

const SteelFramePreview = ({ node }: { node: SteelFrameNode }) => {
  const built = useMemo(() => buildSteelFrameGeometry(node), [node])

  useEffect(() => {
    const cloned: MeshStandardMaterial[] = []
    built.traverse((obj) => {
      ;(obj as unknown as { raycast: () => void }).raycast = () => {}
      const mesh = obj as {
        material?: MeshStandardMaterial | MeshStandardMaterial[]
        geometry?: { dispose: () => void }
      }
      if (!mesh.material) return
      const cloneAndSwap = (mat: MeshStandardMaterial): MeshStandardMaterial => {
        const clone = mat.clone()
        clone.transparent = true
        clone.opacity = 0.55
        clone.depthWrite = false
        cloned.push(clone)
        return clone
      }
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(cloneAndSwap)
        : cloneAndSwap(mesh.material)
    })
    return () => {
      for (const mat of cloned) mat.dispose()
      built.traverse((obj) => {
        ;(obj as { geometry?: { dispose: () => void } }).geometry?.dispose()
      })
    }
  }, [built])

  return <primitive object={built} />
}

export default SteelFramePreview
