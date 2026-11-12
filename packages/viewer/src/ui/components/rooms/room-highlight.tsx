'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type Object3D,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { OVERLAY_LAYER } from '../../../lib/layers'
import { getRoomAssembly, type RoomAssemblyHeights } from '../../lib/room-assembly-overlay'
import type { RoomSelectionRecord } from '../../lib/room-selection'

const noRaycast = () => {}
const outlineMaterial = new LineBasicNodeMaterial({
  color: '#818cf8',
  depthTest: false,
  depthWrite: false,
})
const fillMaterial = (opacity: number) =>
  new MeshBasicNodeMaterial({
    color: '#818cf8',
    depthTest: false,
    depthWrite: false,
    opacity,
    side: DoubleSide,
    transparent: true,
  })
const floorMaterial = fillMaterial(0.18)
// Walls and the ceiling stack over the floor when seen from above.
const surfaceMaterial = fillMaterial(0.1)

function positions(array: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(array, 3))
  return geometry
}

/** A room's floor, wall faces and outline in the highlight colour, riding its level's object. */
export function RoomAssemblyMesh({
  room,
  heights,
  levelObject,
}: {
  room: RoomSelectionRecord
  heights: RoomAssemblyHeights
  levelObject: () => Object3D | undefined
}) {
  const ref = useRef<Group>(null)
  const assembly = useMemo(() => getRoomAssembly(room.geometry, heights), [room, heights])
  const geometry = useMemo(
    () => ({
      floor: positions(assembly.floor),
      surfaces: positions(assembly.surfaces),
      outline: positions(assembly.outline),
    }),
    [assembly],
  )
  useEffect(
    () => () => {
      geometry.floor.dispose()
      geometry.surfaces.dispose()
      geometry.outline.dispose()
    },
    [geometry],
  )
  useFrame(() => {
    const level = levelObject()
    if (!ref.current) return
    ref.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      ref.current.matrix.copy(level.matrixWorld)
    }
  })
  return (
    <group matrixAutoUpdate={false} ref={ref}>
      <mesh
        geometry={geometry.floor}
        layers={OVERLAY_LAYER}
        material={floorMaterial}
        raycast={noRaycast}
        renderOrder={100}
      />
      <mesh
        geometry={geometry.surfaces}
        layers={OVERLAY_LAYER}
        material={surfaceMaterial}
        raycast={noRaycast}
        renderOrder={100}
      />
      <lineSegments
        geometry={geometry.outline}
        layers={OVERLAY_LAYER}
        material={outlineMaterial}
        raycast={noRaycast}
        renderOrder={101}
      />
    </group>
  )
}
