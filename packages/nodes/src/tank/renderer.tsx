'use client'

import { type TankNode, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function buildHorizontalLiquidGeometry(radius: number, length: number, level: number) {
  const clamped = Math.min(1, Math.max(0, level))
  if (clamped <= 0) return null
  if (clamped >= 1) {
    const full = new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, length * 0.96, 48)
    full.rotateZ(Math.PI / 2)
    return full
  }

  const yLevel = -radius + radius * 2 * clamped
  const alpha = Math.asin(Math.min(1, Math.max(-1, yLevel / radius)))
  const start = Math.PI - alpha
  const end = Math.PI * 2 + alpha
  const steps = 36
  const cross: Array<[number, number]> = []
  for (let i = 0; i <= steps; i += 1) {
    const theta = start + ((end - start) * i) / steps
    cross.push([radius * Math.sin(theta), radius * Math.cos(theta)])
  }

  const half = (length * 0.96) / 2
  const vertices: number[] = []
  for (const x of [-half, half]) {
    for (const [y, z] of cross) vertices.push(x, y, z)
  }

  const indices: number[] = []
  const n = cross.length
  for (let i = 1; i < n - 1; i += 1) indices.push(0, i, i + 1)
  for (let i = 1; i < n - 1; i += 1) indices.push(n, n + i + 1, n + i)
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n
    indices.push(i, next, n + next, i, n + next, n + i)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildSphericalLiquidGeometry(radius: number, level: number) {
  const clamped = Math.min(1, Math.max(0, level))
  if (clamped <= 0) return null
  const fillRadius = radius * 0.9
  if (clamped >= 1) return new THREE.SphereGeometry(fillRadius, 64, 32)

  const yTop = -fillRadius + fillRadius * 2 * clamped
  const radialSegments = 56
  const heightSegments = 18
  const vertices: number[] = []
  const indices: number[] = []

  for (let yIndex = 0; yIndex <= heightSegments; yIndex += 1) {
    const y = -fillRadius + ((yTop + fillRadius) * yIndex) / heightSegments
    const ringRadius = Math.sqrt(Math.max(0, fillRadius * fillRadius - y * y))
    for (let i = 0; i < radialSegments; i += 1) {
      const theta = (i / radialSegments) * Math.PI * 2
      vertices.push(Math.cos(theta) * ringRadius, y, Math.sin(theta) * ringRadius)
    }
  }

  for (let yIndex = 0; yIndex < heightSegments; yIndex += 1) {
    const row = yIndex * radialSegments
    const nextRow = (yIndex + 1) * radialSegments
    for (let i = 0; i < radialSegments; i += 1) {
      const next = (i + 1) % radialSegments
      indices.push(row + i, row + next, nextRow + next, row + i, nextRow + next, nextRow + i)
    }
  }

  const bottomCenter = vertices.length / 3
  vertices.push(0, -fillRadius, 0)
  const topCenter = vertices.length / 3
  vertices.push(0, yTop, 0)
  const topRow = heightSegments * radialSegments
  for (let i = 0; i < radialSegments; i += 1) {
    const next = (i + 1) % radialSegments
    indices.push(bottomCenter, next, i)
    indices.push(topCenter, topRow + i, topRow + next)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function LiquidWaveSurface({
  material,
  shape,
}: {
  material: THREE.Material
  shape:
    | { kind: 'circle'; radius: number; y: number }
    | { kind: 'rect'; width: number; depth: number; y: number }
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => {
    if (shape.kind === 'circle') return new THREE.CircleGeometry(shape.radius, 80)
    return new THREE.PlaneGeometry(shape.width, shape.depth, 32, 10)
  }, [shape])
  const basePositions = useMemo(() => {
    const position = geometry.attributes.position
    if (!position) return []
    const values: number[] = []
    for (let i = 0; i < position.count; i += 1) values.push(position.getZ(i))
    return values
  }, [geometry])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  useFrame(({ clock }) => {
    const position = meshRef.current?.geometry.attributes.position
    if (!position) return
    const t = clock.elapsedTime
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i)
      const y = position.getY(i)
      const baseZ = basePositions[i] ?? 0
      const wave =
        Math.sin(x * 8.5 + t * 3.2) * 0.035 +
        Math.cos(y * 11 - t * 2.6) * 0.026 +
        Math.sin((x + y) * 5.5 + t * 2.1) * 0.014
      position.setZ(i, baseZ + wave)
    }
    position.needsUpdate = true
  })

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, shape.y, 0]}
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
    ></mesh>
  )
}

function createVerticalLiquidGeometry(radius: number, height: number) {
  const radialSegments = 80
  const heightSegments = 8
  const vertices: number[] = []
  const indices: number[] = []
  const topRingIndices: number[] = []

  for (let yIndex = 0; yIndex <= heightSegments; yIndex += 1) {
    const y = (height * yIndex) / heightSegments
    for (let i = 0; i < radialSegments; i += 1) {
      const theta = (i / radialSegments) * Math.PI * 2
      vertices.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius)
      if (yIndex === heightSegments) topRingIndices.push(yIndex * radialSegments + i)
    }
  }

  for (let yIndex = 0; yIndex < heightSegments; yIndex += 1) {
    const row = yIndex * radialSegments
    const nextRow = (yIndex + 1) * radialSegments
    for (let i = 0; i < radialSegments; i += 1) {
      const next = (i + 1) % radialSegments
      indices.push(row + i, row + next, nextRow + next, row + i, nextRow + next, nextRow + i)
    }
  }

  const bottomCenter = vertices.length / 3
  vertices.push(0, 0, 0)
  const topCenter = vertices.length / 3
  vertices.push(0, height, 0)

  for (let i = 0; i < radialSegments; i += 1) {
    const next = (i + 1) % radialSegments
    indices.push(bottomCenter, next, i)
    indices.push(topCenter, topRingIndices[i] ?? 0, topRingIndices[next] ?? 0)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return { geometry, topRingIndices, topCenterIndex: topCenter, baseTopY: height }
}

function VerticalLiquidMesh({
  height,
  material,
  radius,
}: {
  height: number
  material: THREE.Material
  radius: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const built = useMemo(() => createVerticalLiquidGeometry(radius, height), [radius, height])

  useEffect(() => {
    return () => built.geometry.dispose()
  }, [built.geometry])

  useFrame(({ clock }) => {
    const position = meshRef.current?.geometry.attributes.position
    if (!position) return

    const t = clock.elapsedTime
    let sum = 0
    for (const index of built.topRingIndices) {
      const x = position.getX(index)
      const z = position.getZ(index)
      const wave =
        Math.sin(x * 8.5 + t * 3.2) * 0.035 +
        Math.cos(z * 11 - t * 2.6) * 0.026 +
        Math.sin((x + z) * 5.5 + t * 2.1) * 0.014
      const y = built.baseTopY + wave
      position.setY(index, y)
      sum += y
    }
    position.setY(built.topCenterIndex, sum / Math.max(1, built.topRingIndices.length))
    position.needsUpdate = true
    meshRef.current?.geometry.computeVertexNormals()
  })

  return (
    <mesh castShadow geometry={built.geometry} material={material} receiveShadow ref={meshRef} />
  )
}

function TankMeshes({ node, preview = false }: { node: TankNode; preview?: boolean }) {
  const radius = Math.max(0.05, node.diameter / 2)
  const shellOpacity = preview ? 0.25 : node.shellOpacity
  const shellIsTransparent = shellOpacity < 0.98
  const shellMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: node.shellColor,
        metalness: shellIsTransparent ? 0.02 : 0.25,
        roughness: shellIsTransparent ? 0.08 : 0.35,
        transparent: shellIsTransparent,
        opacity: shellOpacity,
        depthWrite: !shellIsTransparent,
        premultipliedAlpha: shellIsTransparent,
      }),
    [node.shellColor, shellIsTransparent, shellOpacity],
  )
  const liquidMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: node.liquidColor,
        transparent: true,
        opacity: preview ? 0.38 : 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [node.liquidColor, preview],
  )
  const horizontalLiquidGeometry = useMemo(
    () => buildHorizontalLiquidGeometry(radius, node.length, node.liquidLevel),
    [radius, node.length, node.liquidLevel],
  )
  const sphericalLiquidGeometry = useMemo(
    () => buildSphericalLiquidGeometry(radius, node.liquidLevel),
    [radius, node.liquidLevel],
  )

  if (node.kind === 'spherical') {
    const legHeight = Math.max(0.25, radius * 0.55)
    const centerY = legHeight + radius * 0.85
    const legRadius = Math.max(0.025, radius * 0.035)
    const legSpread = radius * 0.62
    const yLevel = -radius * 0.9 + radius * 1.8 * Math.min(1, Math.max(0, node.liquidLevel))
    const surfaceRadius = Math.sqrt(Math.max(0, (radius * 0.9) ** 2 - yLevel * yLevel))

    return (
      <>
        {(
          [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ] as Array<[number, number]>
        ).map(([xSign, zSign]) => (
          <mesh
            castShadow
            key={`${xSign}-${zSign}`}
            material={shellMaterial}
            position={[xSign * legSpread, legHeight / 2, zSign * legSpread]}
            receiveShadow
          >
            <cylinderGeometry args={[legRadius, legRadius * 1.25, legHeight, 16]} />
          </mesh>
        ))}
        <mesh
          castShadow={!shellIsTransparent}
          material={shellMaterial}
          position={[0, centerY, 0]}
          receiveShadow={!shellIsTransparent}
        >
          <sphereGeometry args={[radius, 64, 32]} />
        </mesh>
        <mesh material={shellMaterial} position={[0, centerY, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 1.005, Math.max(0.01, radius * 0.018), 12, 96]} />
        </mesh>
        {sphericalLiquidGeometry && (
          <mesh
            castShadow
            geometry={sphericalLiquidGeometry}
            material={liquidMaterial}
            position={[0, centerY, 0]}
            receiveShadow
          />
        )}
        {node.liquidLevel > 0 && node.liquidLevel < 1 && surfaceRadius > 0.03 && (
          <LiquidWaveSurface
            material={liquidMaterial}
            shape={{
              kind: 'circle',
              radius: surfaceRadius,
              y: centerY + yLevel + 0.006,
            }}
          />
        )}
      </>
    )
  }

  if (node.kind === 'horizontal') {
    const yLevel = -radius + radius * 2 * Math.min(1, Math.max(0, node.liquidLevel))
    const chordDepth =
      node.liquidLevel > 0 && node.liquidLevel < 1
        ? Math.max(0.04, Math.sqrt(Math.max(0, radius * radius - yLevel * yLevel)) * 2 * 0.92)
        : radius * 2 * 0.92

    return (
      <>
        <mesh
          castShadow={!shellIsTransparent}
          material={shellMaterial}
          receiveShadow={!shellIsTransparent}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[radius, radius, node.length, 48]} />
        </mesh>
        {horizontalLiquidGeometry && (
          <mesh
            castShadow
            geometry={horizontalLiquidGeometry}
            material={liquidMaterial}
            receiveShadow
          />
        )}
        {node.liquidLevel > 0 && (
          <LiquidWaveSurface
            material={liquidMaterial}
            shape={{
              kind: 'rect',
              width: node.length * 0.88,
              depth: chordDepth,
              y: Math.min(radius - 0.01, yLevel + 0.006),
            }}
          />
        )}
      </>
    )
  }

  const liquidHeight = Math.max(0.001, node.height * node.liquidLevel)

  return (
    <>
      <mesh
        castShadow={!shellIsTransparent}
        material={shellMaterial}
        position={[0, node.height / 2, 0]}
        receiveShadow={!shellIsTransparent}
      >
        <cylinderGeometry args={[radius, radius, node.height, 48]} />
      </mesh>
      {node.liquidLevel > 0 && (
        <VerticalLiquidMesh
          height={liquidHeight}
          material={liquidMaterial}
          radius={radius * 0.92}
        />
      )}
    </>
  )
}

export function TankRenderer({ node }: { node: TankNode }) {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'tank', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const handlers = useNodeEvents(node, 'tank')

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <TankMeshes node={node} />
    </group>
  )
}

export function TankPreview({ node }: { node: TankNode }) {
  const ref = useRef<THREE.Group>(null)

  useEffect(() => {
    ref.current?.traverse((obj) => {
      ;(obj as unknown as { raycast: () => void }).raycast = () => {}
    })
  }, [])

  return (
    <group ref={ref}>
      <TankMeshes node={node} preview />
    </group>
  )
}

export default TankRenderer
