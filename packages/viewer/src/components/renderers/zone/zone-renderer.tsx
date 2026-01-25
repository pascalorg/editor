import { useRegistry, type ZoneNode } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, type Group, Shape } from 'three'
import { color, float, uv } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'

const Y_OFFSET = 0.01
const WALL_HEIGHT = 2.3

/**
 * Creates a gradient material for zone walls using TSL
 * Gradient goes from zone color at bottom to transparent at top
 */
const createWallGradientMaterial = (zoneColor: string) => {
  const baseColor = color(new Color(zoneColor))

  // Use UV y coordinate for vertical gradient (0 at bottom, 1 at top)
  const gradientT = uv().y

  // Fade opacity from 0.6 at bottom to 0 at top
  const opacity = float(0.6).mul(float(1).sub(gradientT))

  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: opacity,
    side: DoubleSide,
    depthWrite: false,
  })
}

/**
 * Creates a floor material for zones using TSL
 */
const createFloorMaterial = (zoneColor: string) => {
  const baseColor = color(new Color(zoneColor))

  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: float(0.15),
    side: DoubleSide,
    depthWrite: false,
  })
}

/**
 * Creates wall geometry for zone borders
 * Each wall segment is a vertical quad from one polygon point to the next
 */
const createWallGeometry = (polygon: Array<[number, number]>): BufferGeometry => {
  const geometry = new BufferGeometry()

  if (polygon.length < 2) return geometry

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // Create a wall segment for each edge of the polygon
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!
    const next = polygon[(i + 1) % polygon.length]!

    const baseIndex = i * 4

    // Four vertices per wall segment (two triangles forming a quad)
    // Bottom-left
    positions.push(current[0]!, Y_OFFSET, current[1]!)
    uvs.push(0, 0)

    // Bottom-right
    positions.push(next[0]!, Y_OFFSET, next[1]!)
    uvs.push(1, 0)

    // Top-right
    positions.push(next[0]!, Y_OFFSET + WALL_HEIGHT, next[1]!)
    uvs.push(1, 1)

    // Top-left
    positions.push(current[0]!, Y_OFFSET + WALL_HEIGHT, current[1]!)
    uvs.push(0, 1)

    // Two triangles for the quad
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3)
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

export const ZoneRenderer = ({ node }: { node: ZoneNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, 'zone', ref)

  // Create floor shape from polygon
  const floorShape = useMemo(() => {
    if (!node?.polygon || node.polygon.length < 3) return null
    const shape = new Shape()
    const firstPt = node.polygon[0]!

    // Shape is in X-Y plane, we rotate it to X-Z plane
    // Negate Y (which becomes Z) to get correct orientation
    shape.moveTo(firstPt[0]!, -firstPt[1]!)

    for (let i = 1; i < node.polygon.length; i++) {
      const pt = node.polygon[i]!
      shape.lineTo(pt[0]!, -pt[1]!)
    }
    shape.closePath()

    return shape
  }, [node?.polygon])

  // Create wall geometry from polygon
  const wallGeometry = useMemo(() => {
    if (!node?.polygon || node.polygon.length < 2) return null
    return createWallGeometry(node.polygon)
  }, [node?.polygon])

  // Create materials
  const floorMaterial = useMemo(() => {
    if (!node?.color) return null
    return createFloorMaterial(node.color)
  }, [node?.color])

  const wallMaterial = useMemo(() => {
    if (!node?.color) return null
    return createWallGradientMaterial(node.color)
  }, [node?.color])

  const handlers = useNodeEvents(node, 'zone')

  if (!node || !floorShape || !wallGeometry || !floorMaterial || !wallMaterial) {
    return null
  }

  return (
    <group ref={ref} {...handlers}>
      {/* Floor fill */}
      <mesh position={[0, Y_OFFSET, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMaterial}>
        <shapeGeometry args={[floorShape]} />
      </mesh>

      {/* Wall borders with gradient */}
      <mesh geometry={wallGeometry} material={wallMaterial} />
    </group>
  )
}
