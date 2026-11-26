'use client'

import {
  type AnyNode,
  emitter,
  type RoofCovering,
  type RoofNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react'
import type { Material, Mesh, Object3D } from 'three'
import { getRoofCoveringCapSegment } from './covering-caps'
import { RoofCoveringDetail } from './covering-detail'

export function useRoofCoveringDetail(
  ref: RefObject<Object3D | null>,
  materials: Material[],
  covering: RoofCovering | undefined,
  enabled: boolean,
  childName?: string,
  capRoof?: RoofNode,
) {
  const getThree = useThree((state) => state.get)
  const capsEnabled = Boolean(enabled && covering?.caps && capRoof)
  const nodes = useScene((state) => (capsEnabled ? state.nodes : null))
  const overrides = useLiveNodeOverrides((state) => (capsEnabled ? state.overrides : null))
  const capContext = useMemo(() => {
    if (!nodes || !capRoof) return undefined
    // Eligibility follows live cuts/moves too, but is never recomputed in the frame loop.
    const effectiveNodes: Record<string, AnyNode> = { ...nodes }
    for (const [id, override] of overrides ?? []) {
      const node = effectiveNodes[id]
      if (node) effectiveNodes[id] = { ...node, ...override } as AnyNode
    }
    const roof = { ...capRoof, ...overrides?.get(capRoof.id) }
    const segment = getRoofCoveringCapSegment(roof, effectiveNodes)
    return segment
      ? { segment, nodes: effectiveNodes, roofSpace: childName === 'merged-roof' }
      : undefined
  }, [nodes, overrides, capRoof, childName])
  const detail = useRef<RoofCoveringDetail | null>(null)
  const restoreCapture = useRef<(() => void) | null>(null)
  useLayoutEffect(
    () => () => {
      restoreCapture.current?.()
      restoreCapture.current = null
      detail.current?.dispose()
      detail.current = null
    },
    [materials, covering, enabled, childName, capContext],
  )
  useLayoutEffect(() => {
    if (!covering || !enabled) return
    const mesh = (childName ? ref.current?.getObjectByName(childName) : ref.current) as
      | Mesh
      | undefined
    if (!mesh?.isMesh) return
    const finish = () => {
      restoreCapture.current?.()
      restoreCapture.current = null
    }
    const begin = () => {
      if (!restoreCapture.current) {
        detail.current ??= new RoofCoveringDetail(mesh, materials, covering, capContext)
        restoreCapture.current = detail.current.beginCapture(getThree().camera)
      }
    }
    // An export is static: its finish holds the near detail whatever the live camera distance.
    // Ordinary thumbnails keep the viewport's own level of detail.
    const before = () => {
      if (useViewer.getState().isExporting) begin()
    }
    emitter.on('thumbnail:before-capture', before)
    emitter.on('thumbnail:after-capture', finish)
    return () => {
      finish()
      emitter.off('thumbnail:before-capture', before)
      emitter.off('thumbnail:after-capture', finish)
    }
  }, [ref, materials, covering, enabled, childName, capContext, getThree])
  useFrame(() => {
    if (!restoreCapture.current) detail.current?.suspend()
  }, -0.5)
  // After the roof veil, before the render pass (1). RoofSystem's priority-5 rebuild is picked
  // up before the next draw. In export mode the real near variant is retained at any distance.
  useFrame(({ camera }) => {
    if (!covering || !enabled || restoreCapture.current) return
    const mesh = (childName ? ref.current?.getObjectByName(childName) : ref.current) as
      | Mesh
      | undefined
    if (!mesh?.isMesh) return
    detail.current ??= new RoofCoveringDetail(mesh, materials, covering, capContext)
    const viewer = useViewer.getState()
    detail.current.update(
      camera,
      viewer.isExporting || viewer.wallMode === 'up',
      viewer.isExporting,
    )
  }, 0.5)
}
