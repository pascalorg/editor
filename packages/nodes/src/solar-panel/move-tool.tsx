'use client'

import {
  type AnyNodeId,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  type SolarPanelNode,
  useScene,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

function resolveSegmentFromWorldPoint(
  roof: RoofNode,
  worldX: number,
  worldY: number,
  worldZ: number,
  state: ReturnType<typeof useScene.getState>,
): { segment: RoofSegmentNode; localX: number; localY: number; localZ: number } | null {
  const worldPt = new THREE.Vector3(worldX, worldY, worldZ)
  for (const childId of roof.children ?? []) {
    const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (seg?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(worldPt.clone())
    if (Math.abs(local.x) <= seg.width / 2 && Math.abs(local.z) <= seg.depth / 2) {
      return { segment: seg, localX: local.x, localY: local.y, localZ: local.z }
    }
  }
  return null
}

const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0x22_44_88,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
})

export default function MoveSolarPanelTool({ node }: { node: SolarPanelNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])
  const [previewQuat, setPreviewQuat] = useState<[number, number, number, number]>([0, 0, 0, 1])
  const [hasHit, setHasHit] = useState(false)

  // Compact 2×3 ghost (rows × columns) — same rationale as the
  // placement tool: small enough to read, large enough to convey the
  // array's orientation. Independent of the panel's actual rows/columns.
  const previewGeo = useMemo(() => {
    const ghostRows = 2
    const ghostCols = 3
    const totalW = ghostCols * node.panelWidth + (ghostCols - 1) * node.gapX
    const totalH = ghostRows * node.panelHeight + (ghostRows - 1) * node.gapY
    const geo = new THREE.BoxGeometry(totalW, node.frameDepth, totalH)
    geo.translate(0, node.standoffHeight + node.frameDepth / 2, 0)
    return geo
  }, [
    node.panelWidth,
    node.panelHeight,
    node.gapX,
    node.gapY,
    node.frameDepth,
    node.standoffHeight,
  ])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      metadata: node.metadata,
    }

    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew
    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    const panelObj = sceneRegistry.nodes.get(node.id)
    if (panelObj) panelObj.visible = false

    const worldToBuildingLocal = (
      wx: number,
      wy: number,
      wz: number,
    ): [number, number, number] => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      if (buildingObj) {
        const v = new THREE.Vector3(wx, wy, wz)
        buildingObj.worldToLocal(v)
        return [v.x, v.y, v.z]
      }
      return [wx, wy, wz]
    }

    let lastSnapX = 0
    let lastSnapZ = 0
    let lastWorldNormal: THREE.Vector3 | undefined

    const captureNormal = (event: RoofEvent) => {
      if (!event.normal) return
      const n = new THREE.Vector3(event.normal[0], event.normal[1], event.normal[2])
      const nm = new THREE.Matrix3().getNormalMatrix(event.object.matrixWorld)
      n.applyMatrix3(nm).normalize()
      lastWorldNormal = n

      const up = new THREE.Vector3(0, 1, 0)
      const right = new THREE.Vector3().crossVectors(up, n)
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
      else right.normalize()
      const forward = new THREE.Vector3().crossVectors(right, n).normalize()
      const m = new THREE.Matrix4().makeBasis(right, n, forward)
      const q = new THREE.Quaternion().setFromRotationMatrix(m)
      setPreviewQuat([q.x, q.y, q.z, q.w])
    }

    const onRoofMove = (event: RoofEvent) => {
      const sx = Math.round(event.position[0] * 20) / 20
      const sz = Math.round(event.position[2] * 20) / 20
      if (sx !== lastSnapX || sz !== lastSnapZ) {
        triggerSFX('sfx:grid-snap')
        lastSnapX = sx
        lastSnapZ = sz
      }
      captureNormal(event)
      setPreviewPos(worldToBuildingLocal(event.position[0], event.position[1], event.position[2]))
      setHasHit(true)
      event.stopPropagation()
    }

    const onRoofEnter = (event: RoofEvent) => {
      captureNormal(event)
      setPreviewPos(worldToBuildingLocal(event.position[0], event.position[1], event.position[2]))
      setHasHit(true)
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const st = useScene.getState()

      const hit = resolveSegmentFromWorldPoint(
        roof,
        event.position[0],
        event.position[1],
        event.position[2],
        st,
      )
      if (!hit) return

      const targetSegmentId = hit.segment.id as AnyNodeId
      const finalRotation = original.rotation

      st.updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      useScene.temporal.getState().resume()

      captureNormal(event)
      let worldNormalArr: [number, number, number] | undefined
      if (lastWorldNormal) {
        worldNormalArr = [lastWorldNormal.x, lastWorldNormal.y, lastWorldNormal.z]
      } else {
        const current = st.nodes[node.id as AnyNodeId] as SolarPanelNode | undefined
        worldNormalArr = current?.surfaceNormal as [number, number, number] | undefined
      }
      st.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: finalRotation,
        surfaceNormal: worldNormalArr,
        visible: true,
        metadata: {},
      })

      // Reparent: remove from old segment's children, add to new.
      if (original.roofSegmentId && original.roofSegmentId !== (targetSegmentId as string)) {
        const oldSeg = st.nodes[original.roofSegmentId as AnyNodeId] as
          | RoofSegmentNode
          | undefined
        if (oldSeg) {
          st.updateNode(original.roofSegmentId as AnyNodeId, {
            children: (oldSeg.children ?? []).filter((id) => id !== node.id),
          })
        }
        const newSeg = st.nodes[targetSegmentId] as RoofSegmentNode | undefined
        if (newSeg && !(newSeg.children ?? []).includes(node.id)) {
          st.updateNode(targetSegmentId, {
            children: [...(newSeg.children ?? []), node.id],
          })
        }
        st.dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }
      st.dirtyNodes.add(targetSegmentId)
      st.dirtyNodes.add(node.id as AnyNodeId)

      useScene.temporal.getState().pause()

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      triggerSFX('sfx:item-place')
      exitMoveMode()
      event.stopPropagation()
    }

    const onCancel = () => {
      if (isNew) {
        useScene.temporal.getState().resume()
        // Unlist from parent segment before delete.
        const parentId = original.roofSegmentId
        if (parentId) {
          const parent = useScene.getState().nodes[parentId as AnyNodeId] as
            | RoofSegmentNode
            | undefined
          if (parent) {
            useScene.getState().updateNode(parentId as AnyNodeId, {
              children: (parent.children ?? []).filter((id) => id !== node.id),
            })
          }
        }
        useScene.getState().deleteNode(node.id as AnyNodeId)
        markToolCancelConsumed()
        exitMoveMode()
        return
      }

      useScene.getState().updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      if (original.roofSegmentId) {
        useScene.getState().dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('roof:move', onRoofMove)
    emitter.on('roof:enter', onRoofEnter)
    emitter.on('roof:click', onRoofClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('roof:move', onRoofMove)
      emitter.off('roof:enter', onRoofEnter)
      emitter.off('roof:click', onRoofClick)
      emitter.off('tool:cancel', onCancel)

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true
      useScene.temporal.getState().resume()
    }
  }, [exitMoveMode, node])

  return (
    <group position={previewPos} quaternion={previewQuat} ref={previewRef} visible={hasHit}>
      <group rotation-y={node.rotation ?? 0}>
        <mesh
          geometry={previewGeo}
          layers={EDITOR_LAYER}
          material={previewMaterial}
        />
      </group>
    </group>
  )
}
