'use client'

import { type SiteNode, useRegistry } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type Mesh,
  Shape,
} from 'three'
import { float, color } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

const Y_OFFSET = 0.01

const createFloorMaterial = () => {
  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: color(0xffffff),
    opacityNode: float(0.04),
    side: DoubleSide,
    depthWrite: false,
  })
}

export const SiteRenderer = ({ node }: { node: SiteNode }) => {
  const ref = useRef<Group>(null!)
  const lineRef = useRef<Mesh>(null!)
  const { invalidate } = useThree()

  useRegistry(node.id, 'site', ref)

  const polygon = node.polygon?.points ?? []

  // Floor shape
  const floorShape = useMemo(() => {
    if (polygon.length < 3) return null
    const shape = new Shape()
    const first = polygon[0]!
    shape.moveTo(first[0]!, -first[1]!)
    for (let i = 1; i < polygon.length; i++) {
      const pt = polygon[i]!
      shape.lineTo(pt[0]!, -pt[1]!)
    }
    shape.closePath()
    return shape
  }, [polygon])

  const floorMaterial = useMemo(() => createFloorMaterial(), [])

  // Update line geometry
  useEffect(() => {
    if (!lineRef.current || polygon.length < 2) return

    const positions: number[] = []
    for (const [x, z] of polygon) {
      positions.push(x!, Y_OFFSET + 0.005, z!)
    }
    // Close loop
    const first = polygon[0]!
    positions.push(first[0]!, Y_OFFSET + 0.005, first[1]!)

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

    lineRef.current.geometry.dispose()
    lineRef.current.geometry = geometry

    invalidate()
  }, [polygon, invalidate])

  // Edge distances
  const edges = useMemo(() => {
    if (polygon.length < 2) return []
    return polygon.map(([x1, z1], i) => {
      const [x2, z2] = polygon[(i + 1) % polygon.length]!
      const midX = (x1! + x2) / 2
      const midZ = (z1! + z2) / 2
      const dist = Math.sqrt((x2 - x1!) ** 2 + (z2 - z1!) ** 2)
      return { midX, midZ, dist }
    })
  }, [polygon])

  if (polygon.length < 3) return null

  return (
    <group ref={ref}>
      {/* Floor fill */}
      {floorShape && (
        <mesh position={[0, Y_OFFSET, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMaterial}>
          <shapeGeometry args={[floorShape]} />
        </mesh>
      )}

      {/* Border line */}
      {/* @ts-ignore */}
      <line ref={lineRef} frustumCulled={false} renderOrder={5}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color={0xffffff}
          linewidth={1}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.4}
        />
      </line>

      {/* Edge distance labels */}
      {edges.map((edge, i) => (
        <Html
          center
          key={`edge-${i}`}
          position={[edge.midX, 0.5, edge.midZ]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 font-mono text-white text-xs backdrop-blur-sm">
            {edge.dist.toFixed(2)}m
          </div>
        </Html>
      ))}
    </group>
  )
}
