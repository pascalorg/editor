'use client'

import { useRegistry, useScene, type WindowNode } from '@pascal-app/core'
import { createDefaultMaterial, createMaterial } from '@pascal-app/viewer/materials'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import useViewer from '@pascal-app/viewer/store'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'

export const WindowRenderer = ({ node }: { node: WindowNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'window', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const handlers = useNodeEvents(node, 'window')
  const shading = useViewer((state) => state.shading)
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return createDefaultMaterial('#87ceeb', 0.1, shading)
    return createMaterial(mat, shading)
  }, [
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    shading,
  ])

  return (
    <mesh
      material={material}
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}

export default WindowRenderer
