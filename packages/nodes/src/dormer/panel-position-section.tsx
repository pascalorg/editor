'use client'

import {
  type AnyNodeId,
  type DormerNode,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { PanelSection, SliderControl } from '@pascal-app/editor'
import { useMemo } from 'react'
import { Vector3 } from 'three'

/**
 * Position section: X, Z (world-space) and Rotation (world-space)
 * sliders. Owns the read side of the dormer's world transform —
 * confined to a single useMemo so the underlying `updateWorldMatrix`
 * calls don't fire on unrelated re-renders. Also owns the segment-
 * local commits, including the cross-segment reparent case.
 */
export function DormerPositionSection({
  node,
  segment,
  roof,
  selectedId,
  previewProp,
  commitProp,
}: {
  node: DormerNode
  segment: RoofSegmentNode | undefined
  roof: RoofNode | undefined
  selectedId: string
  previewProp: (updates: Partial<DormerNode>) => void
  commitProp: (updates: Partial<DormerNode>) => void
}) {
  const px = node.position[0]
  const py = node.position[1]
  const pz = node.position[2]
  const nodeRotation = node.rotation
  const segmentId = segment?.id
  const roofChildrenKey = (roof?.children ?? []).join(',')

  // biome-ignore lint/correctness/useExhaustiveDependencies: roofChildrenKey is the stable signature of `roof.children`; intentionally omitting `roof` (object identity) in favor of the joined ids.
  const worldXform = useMemo(() => {
    const dormerObj = sceneRegistry.nodes.get(selectedId)
    let worldX = 0
    let worldZ = 0
    let worldRotation = nodeRotation ?? 0
    if (dormerObj) {
      dormerObj.updateWorldMatrix(true, false)
      const localPt = new Vector3(px ?? 0, 0, pz ?? 0)
      const worldPt = localPt.applyMatrix4(dormerObj.matrixWorld)
      worldX = worldPt.x
      worldZ = worldPt.z
      const m = dormerObj.matrixWorld.elements
      worldRotation = Math.atan2(-(m[2] ?? 0), m[0] ?? 1) + (nodeRotation ?? 0)
    }

    let bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null
    if (roof) {
      const state = useScene.getState()
      let lo_x = Number.POSITIVE_INFINITY
      let hi_x = Number.NEGATIVE_INFINITY
      let lo_z = Number.POSITIVE_INFINITY
      let hi_z = Number.NEGATIVE_INFINITY
      for (const childId of roof.children ?? []) {
        const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        const segObj = sceneRegistry.nodes.get(seg.id)
        if (!segObj) continue
        segObj.updateWorldMatrix(true, false)
        const segWorldCenter = new Vector3().applyMatrix4(segObj.matrixWorld)
        const r = Math.hypot(seg.width, seg.depth) / 2
        lo_x = Math.min(lo_x, segWorldCenter.x - r)
        hi_x = Math.max(hi_x, segWorldCenter.x + r)
        lo_z = Math.min(lo_z, segWorldCenter.z - r)
        hi_z = Math.max(hi_z, segWorldCenter.z + r)
      }
      if (Number.isFinite(lo_x)) bounds = { minX: lo_x, maxX: hi_x, minZ: lo_z, maxZ: hi_z }
    }
    return { worldX, worldZ, worldRotation, bounds }
  }, [selectedId, px, py, pz, nodeRotation, segmentId, roofChildrenKey])

  const worldX_now = worldXform.worldX
  const worldZ_now = worldXform.worldZ
  const worldRotation_now = worldXform.worldRotation
  const worldMinX = worldXform.bounds?.minX ?? worldX_now - 20
  const worldMaxX = worldXform.bounds?.maxX ?? worldX_now + 20
  const worldMinZ = worldXform.bounds?.minZ ?? worldZ_now - 20
  const worldMaxZ = worldXform.bounds?.maxZ ?? worldZ_now + 20

  const findSegmentForWorldPoint = (
    wx: number,
    wz: number,
  ): { segment: RoofSegmentNode; localX: number; localZ: number } | null => {
    const state = useScene.getState()
    const worldPt = new Vector3(wx, 0, wz)
    for (const candidate of Object.values(state.nodes)) {
      if (candidate?.type !== 'roof-segment') continue
      const seg = candidate as RoofSegmentNode
      const segObj = sceneRegistry.nodes.get(seg.id)
      if (!segObj) continue
      segObj.updateWorldMatrix(true, false)
      const local = segObj.worldToLocal(worldPt.clone())
      if (Math.abs(local.x) <= seg.width / 2 && Math.abs(local.z) <= seg.depth / 2) {
        return { segment: seg, localX: local.x, localZ: local.z }
      }
    }
    return null
  }

  const worldToSegLocal = (
    wx: number,
    wz: number,
    seg: RoofSegmentNode,
  ): { localX: number; localZ: number } => {
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) return { localX: wx, localZ: wz }
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(new Vector3(wx, 0, wz))
    return { localX: local.x, localZ: local.z }
  }

  const commitWorldPosition = (newWorldX: number, newWorldZ: number) => {
    if (!segment) return
    const oldWorldRotation = worldRotation_now
    const target = findSegmentForWorldPoint(newWorldX, newWorldZ)
    if (target && target.segment.id !== segment.id) {
      // Moving to a different segment — segment-local Y is meaningless
      // across the change, so reset to 0 and let the new segment's
      // slope-anchored geometry take over.
      const newSegObj = sceneRegistry.nodes.get(target.segment.id)
      let newAncestorWorldY = 0
      if (newSegObj) {
        newSegObj.updateWorldMatrix(true, false)
        const m = newSegObj.matrixWorld.elements
        newAncestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
      }
      const newSegLocalRot = oldWorldRotation - newAncestorWorldY
      commitProp({
        roofSegmentId: target.segment.id,
        parentId: target.segment.id,
        position: [target.localX, 0, target.localZ],
        rotation: newSegLocalRot,
      } as Partial<DormerNode>)
    } else {
      // Same segment — preserve the existing Y so the dormer doesn't
      // snap back to the segment foot when the user only adjusts X/Z.
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, py ?? 0, local.localZ] })
    }
  }

  const commitWorldRotation = (newWorldRot: number) => {
    if (!segment) return
    let ancestorWorldY = 0
    const segObj = sceneRegistry.nodes.get(segment.id)
    if (segObj) {
      segObj.updateWorldMatrix(true, false)
      const m = segObj.matrixWorld.elements
      ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    }
    commitProp({ rotation: newWorldRot - ancestorWorldY })
  }

  return (
    <PanelSection title="Position">
      <SliderControl
        label="X"
        max={Math.round(worldMaxX * 10) / 10}
        min={Math.round(worldMinX * 10) / 10}
        onChange={(newWorldX) => {
          if (!segment) return
          const local = worldToSegLocal(newWorldX, worldZ_now, segment)
          previewProp({ position: [local.localX, py ?? 0, local.localZ] })
        }}
        onCommit={(newWorldX) => commitWorldPosition(newWorldX, worldZ_now)}
        precision={2}
        restoreOnCommit={false}
        step={0.05}
        unit="m"
        value={Math.round(worldX_now * 100) / 100}
      />
      <SliderControl
        label="Z"
        max={Math.round(worldMaxZ * 10) / 10}
        min={Math.round(worldMinZ * 10) / 10}
        onChange={(newWorldZ) => {
          if (!segment) return
          const local = worldToSegLocal(worldX_now, newWorldZ, segment)
          previewProp({ position: [local.localX, py ?? 0, local.localZ] })
        }}
        onCommit={(newWorldZ) => commitWorldPosition(worldX_now, newWorldZ)}
        precision={2}
        restoreOnCommit={false}
        step={0.05}
        unit="m"
        value={Math.round(worldZ_now * 100) / 100}
      />
      <SliderControl
        label="Rotation"
        max={180}
        min={-180}
        onChange={(degrees) => {
          const newWorldRot = (degrees * Math.PI) / 180
          let ancestorWorldY = 0
          if (segment) {
            const segObj = sceneRegistry.nodes.get(segment.id)
            if (segObj) {
              segObj.updateWorldMatrix(true, false)
              const m = segObj.matrixWorld.elements
              ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
            }
          }
          previewProp({ rotation: newWorldRot - ancestorWorldY })
        }}
        onCommit={(degrees) => commitWorldRotation((degrees * Math.PI) / 180)}
        precision={0}
        restoreOnCommit={false}
        step={1}
        unit="°"
        value={Math.round((worldRotation_now * 180) / Math.PI)}
      />
    </PanelSection>
  )
}
