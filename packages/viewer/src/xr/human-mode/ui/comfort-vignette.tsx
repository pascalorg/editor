'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, type Mesh, type MeshBasicMaterial } from 'three'
import { OVERLAY_LAYER } from '../../../lib/layers'
import { useXRPlayerMode, XR_PLAYER_MODES } from '../../mode-switching/store/player-mode'
import { resolveComfortOpacity } from '../lib/comfort'
import { getArtificialMovementSpeed } from '../lib/locomotion'

export function ComfortVignette() {
  const camera = useThree((state) => state.camera)
  const mode = useXRPlayerMode((state) => state.mode)
  const mesh = useRef<Mesh | null>(null)
  const material = useRef<MeshBasicMaterial | null>(null)

  useEffect(() => {
    if (!mesh.current) return
    const currentMesh = mesh.current
    camera.add(currentMesh)
    return () => {
      camera.remove(currentMesh)
    }
  }, [camera])

  useFrame((_, delta) => {
    if (!material.current) return
    const target =
      mode === XR_PLAYER_MODES.HUMAN ? resolveComfortOpacity(getArtificialMovementSpeed()) : 0
    material.current.opacity = MathUtils.damp(material.current.opacity, target, 18, delta)
  })

  return (
    <mesh
      frustumCulled={false}
      layers={OVERLAY_LAYER}
      position={[0, 0, -0.15]}
      ref={mesh}
      renderOrder={2000}
    >
      <planeGeometry args={[0.5, 0.5]} />
      <meshBasicMaterial
        color="black"
        depthTest={false}
        depthWrite={false}
        opacity={0}
        ref={material}
        toneMapped={false}
        transparent
      />
    </mesh>
  )
}
