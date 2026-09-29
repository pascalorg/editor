'use client'

import { type SeparatorNode, useRegistry, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group } from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

const separatorMaterial = new LineBasicNodeMaterial({ color: '#818cf8', depthWrite: false })
const hitMaterial = new MeshBasicNodeMaterial({ transparent: true, opacity: 0, depthWrite: false })

export default function SeparatorRenderer({ node }: { node: SeparatorNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'separator', ref)
  const roomId = useEditor((s) => s.room?.zoneId)
  const viewerRoomId = useViewer((s) => s.selection.zoneId)
  const zone = useScene((s) => {
    const id = roomId ?? viewerRoomId
    return id ? s.nodes[id as keyof typeof s.nodes] : undefined
  })
  const visible = zone?.type === 'zone' && zone.boundarySeparatorIds.includes(node.id)
  const events = useNodeEvents(node, 'separator')
  const y = zone?.type === 'zone' ? (zone.floor?.elevation ?? 0.05) + 0.02 : 0.07
  const dx = node.end[0] - node.start[0],
    dz = node.end[1] - node.start[1]
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
            position={[node.start[0], y, node.start[1]]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
            raycast={() => {}}
          />
          <mesh
            {...events}
            material={hitMaterial}
            position={[(node.start[0] + node.end[0]) / 2, y, (node.start[1] + node.end[1]) / 2]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
          >
            <boxGeometry args={[length, 0.03, 0.1]} />
          </mesh>
        </>
      )}
    </group>
  )
}
