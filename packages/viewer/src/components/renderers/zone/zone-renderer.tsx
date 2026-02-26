import { useRegistry, type ZoneNode, useScene } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useMemo, useRef, useState, useEffect } from 'react'
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, type Group, Shape } from 'three'
import { color, float, uniform, uv } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'

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

  const opacity = uniform(0);
  // Fade opacity from 0.6 at bottom to 0 at top
  const finalOpacity = float(0.6).mul(float(1).sub(gradientT)).mul(opacity);

  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: finalOpacity,
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
    userData: {
      uOpacity: opacity,
    }
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
    userData: { uOpacity: opacity}
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
  const updateNode = useScene((s) => s.updateNode)
  const isEditor = useViewer((state) => state.isEditor)

  const [isEditing, setIsEditing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [editValue, setEditValue] = useState(node.name || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      setEditValue(node.name || '')
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 0)
    }
  }, [isEditing, node.name])

  const handleSave = () => {
    const trimmed = editValue.trim()
    if (trimmed !== node.name) {
      updateNode(node.id, { name: trimmed || 'Zone' })
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsEditing(false)
    }
  }

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

  // Calculate polygon centroid for label positioning using the geometric centroid formula
  // This correctly handles polygons regardless of vertex distribution along edges
  const centroid = useMemo(() => {
    if (!node?.polygon || node.polygon.length < 3) return [0, 0] as [number, number]

    const polygon = node.polygon
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
    <group ref={ref} {...handlers} userData={{
      labelPosition: [centroid[0], 1, centroid[1]]
    }}>
      <Html name="label" position={[centroid[0], 1, centroid[1]]} style={{
        pointerEvents: isEditor ? 'auto' : 'none'
      }}
          zIndexRange={[10, 0]}>
        <div style={{
          transform: 'translate3d(-50%, -50%, 0)',
          width: 'max-content',
          color: 'white',
          textShadow: `-1px -1px 0 ${node.color}, 1px -1px 0 ${node.color}, -1px 1px 0 ${node.color}, 1px 1px 0 ${node.color}`,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          cursor: isEditor && !isEditing ? 'text' : 'default',
        }}
        onMouseEnter={() => isEditor && setIsHovered(true)}
        onMouseLeave={() => isEditor && setIsHovered(false)}
        onClick={(e) => {
          if (isEditor && !isEditing) {
            e.stopPropagation()
            setIsEditing(true)
          }
        }}>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              placeholder="Zone"
              style={{
                background: 'transparent',
                color: 'white',
                textShadow: 'inherit',
                border: 'none',
                borderBottom: '1px solid white',
                outline: 'none',
                padding: 0,
                margin: 0,
                fontSize: 'inherit',
                fontFamily: 'inherit',
                width: `${Math.max(editValue.length, 4) + 1}ch`,
                minWidth: '50px',
                textAlign: 'center'
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span>{node.name}</span>
              {isEditor && (
                <div style={{ opacity: isHovered ? 1 : 0, transition: 'opacity 0.2s', display: 'flex', alignItems: 'center' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                    <path d="m15 5 4 4"/>
                  </svg>
                </div>
              )}
            </>
          )}
        </div>
      </Html>
      {/* Floor fill */}
      <mesh position={[0, Y_OFFSET, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floorMaterial} name="floor">
        <shapeGeometry args={[floorShape]} />
      </mesh>

      {/* Wall borders with gradient */}
      <mesh geometry={wallGeometry} material={wallMaterial} name="walls" />
    </group>
  )
}
