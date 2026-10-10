'use client'

import { emitter } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { type DustPool, dustSpriteSize } from '../../lib/construction-dust'
import { GRID_LAYER } from '../../lib/layers'
import { createDustMaterial } from './dust-material'

/**
 * Draws a reveal's dust: one instanced mesh of camera-facing soft discs, as
 * many as the pool holds, on the grid layer: inside the scene pass, so walls
 * in front hide it (on the overlay layer it showed through them, Victor run
 * 12), with no depth written, so the ink never outlines it; thumbnails leave
 * it out. Renders nothing itself; it owns the mesh, adds it to the scene and
 * disposes it on unmount.
 */
export function ConstructionDust({ pool, clock }: { pool: DustPool; clock: { current: number } }) {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const height = useThree((state) => state.size.height)

  const dust = useMemo(() => {
    const geometry = new PlaneGeometry(1, 1)
    const alpha = new InstancedBufferAttribute(new Float32Array(pool.capacity), 1)
    alpha.setUsage(DynamicDrawUsage)
    const material = createDustMaterial(alpha)
    const mesh = new InstancedMesh(geometry, material, pool.capacity)
    mesh.name = 'construction-dust'
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.layers.set(GRID_LAYER)
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    mesh.count = 0
    mesh.visible = false
    return { mesh, alpha, geometry, material }
  }, [pool])

  useEffect(() => {
    scene.add(dust.mesh)
    // A capture clones the scene in the same tick: no dust in it, whatever the camera layers.
    const hide = (policy: undefined | { readOnly: true }) => {
      if (policy?.readOnly) return
      dust.mesh.visible = false
      dust.mesh.count = 0
    }
    emitter.on('thumbnail:before-capture', hide)
    return () => {
      emitter.off('thumbnail:before-capture', hide)
      scene.remove(dust.mesh)
      dust.geometry.dispose()
      dust.material.dispose()
      dust.mesh.dispose()
    }
  }, [dust, scene])

  const write = useMemo(() => {
    const matrix = new Matrix4()
    const position = new Vector3()
    const size = new Vector3()
    const facing = new Quaternion()
    return {
      facing,
      sprite: (slot: number, x: number, y: number, z: number, scale: number, alpha: number) => {
        position.set(x, y, z)
        const drawn = dustSpriteSize(scale, camera, height, position)
        size.set(drawn, drawn, drawn)
        dust.mesh.setMatrixAt(slot, matrix.compose(position, facing, size))
        dust.alpha.setX(slot, alpha)
      },
    }
  }, [dust, camera, height])

  useFrame(() => {
    const { mesh, alpha } = dust
    if (pool.takeWarm()) {
      // One sprite with no size and no alpha: drawn, so its pipeline is built, and nothing to see.
      write.facing.copy(camera.quaternion)
      write.sprite(0, 0, 0, 0, 0, 0)
      mesh.count = 1
      mesh.visible = true
      mesh.instanceMatrix.needsUpdate = true
      alpha.needsUpdate = true
      return
    }
    if (!mesh.visible && pool.quietAt(clock.current)) return
    write.facing.copy(camera.quaternion)
    const count = pool.step(clock.current, write.sprite)
    mesh.count = count
    mesh.visible = count > 0
    if (count === 0) return
    mesh.instanceMatrix.needsUpdate = true
    alpha.needsUpdate = true
  })

  return null
}
