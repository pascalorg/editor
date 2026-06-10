'use client'

import {
  type AnyNodeId,
  type RoofSegmentNode,
  useRegistry,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import {
  createMaterial,
  DEFAULT_WINDOW_MATERIAL,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'

export const WindowRenderer = ({ node }: { node: WindowNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'window', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const handlers = useNodeEvents(node, 'window')
  const shading = useViewer((s) => s.shading)
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

  // Roof-hosted windows mount under the roof's `roof-elements` group (roof
  // frame), so the host segment's transform is applied here — wall-hosted
  // windows get it for free from the wall mesh they're nested in.
  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  if (node.roofSegmentId && segment?.type !== 'roof-segment') return null

  const mesh = (
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

  if (!segment) return mesh
  return (
    <group position={segment.position} rotation-y={segment.rotation}>
      {mesh}
    </group>
  )
}

export default WindowRenderer
