'use client'

import { type SeparatorNode, useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { separatorFloorElevation, useEditor } from '@pascal-app/editor'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group } from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

const separatorMaterial = new LineBasicNodeMaterial({ color: '#818cf8', depthWrite: false })
const hitMaterial = new MeshBasicNodeMaterial({ transparent: true, opacity: 0, depthWrite: false })

/**
 * An invisible wall in 3D: a dashed line on the floor, shown while its room or
 * it is selected. A push or end drag moves it live (`useLiveNodeOverrides`).
 */
export default function SeparatorRenderer({ node }: { node: SeparatorNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'separator', ref)
  const roomId = useEditor((s) => s.room?.zoneId)
  const viewerRoomId = useViewer((s) => s.selection.zoneId)
  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id))
  const zone = useScene((s) => {
    const id = roomId ?? viewerRoomId
    return id ? s.nodes[id as keyof typeof s.nodes] : undefined
  })
  const inRoom = zone?.type === 'zone' && zone.boundarySeparatorIds.includes(node.id)
  const visible = inRoom || selected
  // Selected on its own, it lies on the floor of a room it closes.
  const ownFloor = useScene((s) =>
    selected && !inRoom ? separatorFloorElevation(s.nodes, node.id) : null,
  )
  const live = useLiveNodeOverrides((s) => s.overrides.get(node.id)) as
    | Partial<SeparatorNode>
    | undefined
  const start = live?.start ?? node.start
  const end = live?.end ?? node.end
  const events = useNodeEvents(node, 'separator')
  const y =
    zone?.type === 'zone' && inRoom
      ? (zone.floor?.elevation ?? 0.05) + 0.02
      : ownFloor !== null
        ? ownFloor + 0.02
        : 0.07
  const dx = end[0] - start[0],
    dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  const geometry = useMemo(() => {
    const positions: number[] = []
    if (Number.isFinite(length)) {
      for (let distance = 0; distance < length; distance += 0.25) {
        positions.push(distance, 0, 0, Math.min(distance + 0.15, length), 0, 0)
      }
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
  }, [length])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <group ref={ref} visible={visible}>
      {visible && (
        <>
          <lineSegments
            geometry={geometry}
            material={separatorMaterial}
            position={[start[0], y, start[1]]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
            raycast={() => {}}
          />
          <mesh
            {...events}
            material={hitMaterial}
            position={[(start[0] + end[0]) / 2, y, (start[1] + end[1]) / 2]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
          >
            <boxGeometry args={[length, 0.03, 0.1]} />
          </mesh>
        </>
      )}
    </group>
  )
}
