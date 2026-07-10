'use client'

import { useLiveNodeOverrides, useRegistry, type ZoneNode } from '@pascal-app/core'
import { useNodeEvents, useViewer, ZONE_LAYER } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, type Group, Shape } from 'three'
import { color, float, uniform, uv } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

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

  const opacity = uniform(0)
  // Fade opacity from 0.6 at bottom to 0 at top
  const finalOpacity = float(0.6).mul(float(1).sub(gradientT)).mul(opacity)

  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: finalOpacity,
    side: DoubleSide,
    depthWrite: true,
    depthTest: false,
    userData: {
      uOpacity: opacity,
    },
  })
}

/**
 * Creates a floor material for zones using TSL
 */
const createFloorMaterial = (zoneColor: string) => {
  const baseColor = color(new Color(zoneColor))
  const opacity = uniform(0)
  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: float(0.25).mul(opacity),
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
    userData: { uOpacity: opacity },
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

  // When zones are toggled off (editor outside the zones layer) the visuals
  // unmount entirely — a drei <Html> keeps costing per-frame matrix work and
  // live DOM even at opacity 0. The registered group stays so the zone keeps
  // its scene identity (selection registry, GLB export polygon stamping).
  const showZones = useViewer((s) => s.showZones)

  // Group-transform drags publish a translated/rotated polygon to
  // `useLiveNodeOverrides`; merge it so the zone previews live instead of
  // snapping only on commit (slab/ceiling get this via their systems'
  // `getEffectiveNode`). Per-node subscription — unrelated overrides don't
  // re-render this zone.
  const livePolygon = useLiveNodeOverrides((s) => s.overrides.get(node.id)?.polygon) as
    | Array<[number, number]>
    | undefined
  const polygon = livePolygon ?? node?.polygon

  // Create floor shape from polygon
  const floorShape = useMemo(() => {
    if (!polygon || polygon.length < 3) return null
    const shape = new Shape()
    const firstPt = polygon[0]!

    // Shape is in X-Y plane, we rotate it to X-Z plane
    // Negate Y (which becomes Z) to get correct orientation
    shape.moveTo(firstPt[0]!, -firstPt[1]!)

    for (let i = 1; i < polygon.length; i++) {
      const pt = polygon[i]!
      shape.lineTo(pt[0]!, -pt[1]!)
    }
    shape.closePath()

    return shape
  }, [polygon])

  // Create wall geometry from polygon
  const wallGeometry = useMemo(() => {
    if (!polygon || polygon.length < 2) return null
    return createWallGeometry(polygon)
  }, [polygon])

  // Calculate polygon centroid for label positioning using the geometric centroid formula
  // This correctly handles polygons regardless of vertex distribution along edges
  const centroid = useMemo(() => {
    if (!polygon || polygon.length < 3) return [0, 0] as [number, number]

    let signedArea = 0
    let cx = 0
    let cz = 0

    for (let i = 0; i < polygon.length; i++) {
      const [x0, z0] = polygon[i]!
      const [x1, z1] = polygon[(i + 1) % polygon.length]!

      // Cross product for signed area
      const cross = x0 * z1 - x1 * z0
      signedArea += cross
      cx += (x0 + x1) * cross
      cz += (z0 + z1) * cross
    }

    signedArea /= 2
    const factor = 1 / (6 * signedArea)

    return [cx * factor, cz * factor] as [number, number]
  }, [polygon])

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

  if (!(node && floorShape && wallGeometry && floorMaterial && wallMaterial)) {
    return null
  }

  return (
    <group ref={ref} {...handlers} userData={{ labelPosition: [centroid[0], 1, centroid[1]] }}>
      {showZones && (
        <>
          <Html
            name="label"
            position={[centroid[0], 1, centroid[1]]}
            style={{ pointerEvents: 'none' }}
            zIndexRange={[10, 0]}
          >
            <div
              id={`${node.id}-label`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transform: 'translate3d(-50%, -50%, 0)',
                opacity: 0,
                transition: 'opacity 0.3s ease-in-out',
              }}
            >
              <div
                style={{
                  width: 'max-content',
                  color: 'white',
                  textShadow: `-1px -1px 0 ${node.color}, 1px -1px 0 ${node.color}, -1px 1px 0 ${node.color}, 1px 1px 0 ${node.color}`,
                  textAlign: 'center',
                }}
              >
                <span>{node.name}</span>
              </div>
              <div
                className="label-pin"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  marginTop: '2px',
                  opacity: 0,
                  transition: 'opacity 0.5s ease-in-out',
                }}
              >
                <div
                  style={{
                    width: '2px',
                    height: '40px',
                    backgroundColor: node.color,
                  }}
                />
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: node.color,
                    border: '1px solid white',
                  }}
                />
              </div>
            </div>
          </Html>

          {/* Floor fill */}
          <mesh
            layers={ZONE_LAYER}
            material={floorMaterial}
            name="floor"
            position={[0, Y_OFFSET, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <shapeGeometry args={[floorShape]} />
          </mesh>

          {/* Wall borders with gradient */}
          <mesh geometry={wallGeometry} layers={ZONE_LAYER} material={wallMaterial} name="walls" />
        </>
      )}
    </group>
  )
}

export default ZoneRenderer
