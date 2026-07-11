'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import type { Material } from 'three'
import { buildFireplaceGeometry } from './geometry'
import type { FireplaceNode } from './schema'

const FireplacePreview = ({ node }: { node: FireplaceNode }) => {
  const shading = useViewer((s) => s.shading)
  const built = useMemo(() => buildFireplaceGeometry(node, undefined, shading), [node, shading])

  useEffect(() => {
    const cloned: Material[] = []
    built.traverse((obj) => {
      ;(obj as unknown as { raycast: () => void }).raycast = () => {}
      const mesh = obj as unknown as { material?: Material }
      if (mesh.material) {
        const clone = mesh.material.clone()
        mesh.material = clone
        clone.transparent = true
        clone.opacity = 0.4
        cloned.push(clone)
      }
    })
    return () => {
      for (const m of cloned) m.dispose()
    }
  }, [built])

  return <primitive object={built} />
}

export default FireplacePreview
