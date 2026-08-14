'use client'

import {
  type AnyNodeId,
  type CustomMeshNode,
  type CustomMeshTopology,
  getCustomMeshFaceFrame,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'

type CustomMeshFaceHostTransform = {
  position: [number, number, number]
  quaternion: Quaternion
}

const transformCache = new WeakMap<
  CustomMeshTopology,
  Map<string, CustomMeshFaceHostTransform | null>
>()

export function resolveCustomMeshFaceHostTransform(
  host: CustomMeshNode | undefined,
  liveTopology: CustomMeshTopology | undefined,
  faceId: string,
): CustomMeshFaceHostTransform | null {
  if (host?.type !== 'custom-mesh') return null
  const topology = liveTopology ?? host.topology
  let byFace = transformCache.get(topology)
  if (!byFace) {
    byFace = new Map()
    transformCache.set(topology, byFace)
  }
  const cached = byFace.get(faceId)
  if (cached !== undefined || byFace.has(faceId)) return cached ?? null

  const frame = getCustomMeshFaceFrame(topology, faceId)
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

export function CustomMeshFaceHostFrame({
  children,
  customMeshId,
  faceId,
}: {
  children: ReactNode
  customMeshId: string
  faceId: string
}) {
  const host = useScene((state) => state.nodes[customMeshId as AnyNodeId]) as
    | CustomMeshNode
    | undefined
  const liveTopology = useLiveNodeOverrides(
    (state) => state.get(customMeshId)?.topology as CustomMeshTopology | undefined,
  )
  const transform = useMemo(
    () => resolveCustomMeshFaceHostTransform(host, liveTopology, faceId),
    [faceId, host, liveTopology],
  )

  if (!transform) return children
  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      {children}
    </group>
  )
}
