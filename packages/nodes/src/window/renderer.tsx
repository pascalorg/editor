'use client'

import { useLiveNodeOverrides, useRegistry, useScene, type WindowNode } from '@pascal-app/core'
import {
  createMaterial,
  DEFAULT_WINDOW_MATERIAL,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { RoofFaceHostFrame } from '../shared/roof-face-host'

export const WindowRenderer = ({ node }: { node: WindowNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'window', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const handlers = useNodeEvents(node, 'window')
  const shading = useViewer((s) => s.shading)
  const liveVisible = useLiveNodeOverrides((s) => {
    const visible = s.get(node.id)?.visible
    return typeof visible === 'boolean' ? visible : undefined
  })
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_WINDOW_MATERIAL(shading)
    return createMaterial(mat, shading)
  }, [
    shading,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

  const mesh = (
    <mesh
      material={material}
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      visible={liveVisible ?? node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )

  if (!node.roofSegmentId) return mesh
  return (
    <RoofFaceHostFrame roofFace={node.roofFace} roofSegmentId={node.roofSegmentId}>
      {mesh}
    </RoofFaceHostFrame>
  )
}

export default WindowRenderer
