'use client'

import {
  type AnyNodeId,
  type BlockNode,
  type BlockTopology,
  getBlockFaceFrame,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'

type BlockFaceHostTransform = {
  position: [number, number, number]
  quaternion: Quaternion
}

const transformCache = new WeakMap<BlockTopology, Map<string, BlockFaceHostTransform | null>>()

export function resolveBlockFaceHostTransform(
  host: BlockNode | undefined,
  liveTopology: BlockTopology | undefined,
  faceId: string,
): BlockFaceHostTransform | null {
  if (host?.type !== 'block') return null
  const topology = liveTopology ?? host.topology
  let byFace = transformCache.get(topology)
  if (!byFace) {
    byFace = new Map()
    transformCache.set(topology, byFace)
  }
  const cached = byFace.get(faceId)
  if (cached !== undefined || byFace.has(faceId)) return cached ?? null

  const frame = getBlockFaceFrame(topology, faceId)
  if (!frame) {
    byFace.set(faceId, null)
    return null
  }
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      new Vector3(...frame.xAxis),
      new Vector3(...frame.yAxis),
      new Vector3(...frame.normal),
    ),
  )
  const transform = { position: frame.origin, quaternion }
  byFace.set(faceId, transform)
  return transform
}

export function BlockFaceHostFrame({
  children,
  blockId,
  faceId,
}: {
  children: ReactNode
  blockId: string
  faceId: string
}) {
  const host = useScene((state) => state.nodes[blockId as AnyNodeId]) as BlockNode | undefined
  const liveTopology = useLiveNodeOverrides(
    (state) => state.get(blockId)?.topology as BlockTopology | undefined,
  )
  const transform = useMemo(
    () => resolveBlockFaceHostTransform(host, liveTopology, faceId),
    [faceId, host, liveTopology],
  )

  if (!transform) return children
  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      {children}
    </group>
  )
}
