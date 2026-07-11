'use client'

import {
  type FireplaceNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildFireplaceGeometry } from './geometry'

const FIRE_COLORS: Record<string, THREE.Color> = {
  orange: new THREE.Color(0xff6600),
  amber: new THREE.Color(0xffaa00),
  blue: new THREE.Color(0x4488ff),
  white: new THREE.Color(0xffeecc),
}

const FIRE_SIZES = {
  none: { count: 0, scale: 0, height: 0 },
  small: { count: 12, scale: 0.5, height: 0.25 },
  medium: { count: 20, scale: 1.0, height: 0.4 },
  large: { count: 30, scale: 1.3, height: 0.55 },
  roaring: { count: 45, scale: 1.6, height: 0.7 },
}

function FireParticles({
  count,
  fireboxWidth,
  fireboxHeight,
  fireboxDepth,
  sillHeight,
  hearthHeight,
  baseColor,
}: {
  count: number
  fireboxWidth: number
  fireboxHeight: number
  fireboxDepth: number
  sillHeight: number
  hearthHeight: number
  baseColor: THREE.Color
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      x: (Math.random() - 0.5) * fireboxWidth * 0.7,
      z: (Math.random() - 0.5) * fireboxDepth * 0.5,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.6,
      size: 0.03 + Math.random() * 0.06,
      life: Math.random(),
      maxLife: 0.8 + Math.random() * 0.6,
    }))
  }, [count, fireboxWidth, fireboxDepth])

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    return mat
  }, [baseColor])

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 6, 6), [])

  useFrame((state, delta) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const p = particles[i]!
      p.life += delta * p.speed
      if (p.life > p.maxLife) {
        p.life = 0
        p.x = (Math.random() - 0.5) * fireboxWidth * 0.7
        p.z = (Math.random() - 0.5) * fireboxDepth * 0.5
      }
      const lifeFrac = p.life / p.maxLife
      const y = lifeFrac * fireboxHeight * 0.8
      const wobble = Math.sin(t * 2 + p.phase) * 0.03
      const scale = p.size * (1 - lifeFrac * 0.5)
      dummy.position.set(p.x + wobble, hearthHeight + sillHeight + y, p.z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      castShadow={false}
      receiveShadow={false}
    />
  )
}

function FireLight({
  fireboxY,
  fireboxZ,
  intensity,
  color,
}: {
  fireboxY: number
  fireboxZ: number
  intensity: number
  color: THREE.Color
}) {
  const lightRef = useRef<THREE.PointLight>(null!)
  useFrame((state) => {
    if (!lightRef.current) return
    const t = state.clock.elapsedTime
    const flicker = 0.8 + Math.sin(t * 7) * 0.1 + Math.sin(t * 13) * 0.05
    lightRef.current.intensity = intensity * flicker
  })
  return (
    <pointLight
      ref={lightRef}
      position={[0, fireboxY, fireboxZ]}
      color={color}
      intensity={intensity}
      distance={4}
      decay={2}
    />
  )
}

const FireplaceRenderer = ({ node: storeNode }: { node: FireplaceNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'fireplace', ref)
  const handlers = useNodeEvents(storeNode, 'fireplace')
  const liveTransform = useLiveTransforms((state) => state.get(storeNode.id))
  const shading = useViewer((s) => s.shading)

  const overrides = useLiveNodeOverrides((s) => s.get(storeNode.id))
  const node: FireplaceNode = overrides
    ? ({ ...storeNode, ...overrides } as FireplaceNode)
    : storeNode

  const geometry = useMemo(
    () => buildFireplaceGeometry(node, undefined, shading),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      node.width,
      node.height,
      node.depth,
      node.style,
      node.cornerAngle,
      node.fireboxWidth,
      node.fireboxHeight,
      node.fireboxDepth,
      node.fireboxSillHeight,
      node.mantelHeight,
      node.mantelOverhang,
      node.mantelThickness,
      node.mantelWidth,
      node.hearthDepth,
      node.hearthHeight,
      node.hearthWidth,
      node.surroundWidth,
      node.lintelHeight,
      node.material,
      node.materialPreset,
      node.mantelMaterial,
      node.mantelMaterialPreset,
      node.hearthMaterial,
      node.hearthMaterialPreset,
      node.fireboxMaterial,
      node.fireboxMaterialPreset,
      shading,
    ],
  )

  useScene.getState().markDirty(node.id)

  const fireConfig = FIRE_SIZES[node.fire]
  const fireColor = FIRE_COLORS[node.fireColor] ?? FIRE_COLORS.orange!
  const fireboxY = node.hearthHeight + node.fireboxSillHeight + node.fireboxHeight / 2
  const fireboxZ = -node.depth / 2 + node.fireboxDepth / 2

  return (
    <group
      ref={ref}
      position={node.position}
      rotation={[0, (node.rotation * Math.PI) / 180, 0]}
      visible={node.visible}
      {...handlers}
      {...liveTransform}
    >
      <primitive object={geometry} />
      {fireConfig.count > 0 && (
        <>
          <FireParticles
            count={fireConfig.count}
            fireboxWidth={node.fireboxWidth}
            fireboxHeight={node.fireboxHeight}
            fireboxDepth={node.fireboxDepth}
            sillHeight={node.fireboxSillHeight}
            hearthHeight={node.hearthHeight}
            baseColor={fireColor}
          />
          <FireLight
            fireboxY={fireboxY}
            fireboxZ={fireboxZ}
            intensity={fireConfig.scale * 2}
            color={fireColor}
          />
        </>
      )}
    </group>
  )
}

export default FireplaceRenderer
