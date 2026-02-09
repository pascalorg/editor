import { type SiteNode, useRegistry } from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Group, Shape } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

const Y_OFFSET = 0.01
const LINE_HEIGHT = 0.5

/**
 * Creates simple line geometry for site boundary
 * Single horizontal line at ground level
 */
const createBoundaryLineGeometry = (points: Array<[number, number]>): BufferGeometry => {
  const geometry = new BufferGeometry()

  if (points.length < 2) return geometry

  const positions: number[] = []

  // Create a simple line loop at ground level
  for (const [x, z] of points) {
    positions.push(x!, Y_OFFSET, z!)
  }
  // Close the loop
  positions.push(points[0]![0]!, Y_OFFSET, points[0]![1]!)

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

  return geometry
}

export const SiteRenderer = ({ node }: { node: SiteNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, 'site', ref)

  // Create floor shape from polygon points
  const floorShape = useMemo(() => {
    if (!node?.polygon?.points || node.polygon.points.length < 3) return null
    const shape = new Shape()
    const firstPt = node.polygon.points[0]!

    // Shape is in X-Y plane, we rotate it to X-Z plane
    // Negate Y (which becomes Z) to get correct orientation
    shape.moveTo(firstPt[0]!, -firstPt[1]!)

    for (let i = 1; i < node.polygon.points.length; i++) {
      const pt = node.polygon.points[i]!
      shape.lineTo(pt[0]!, -pt[1]!)
    }
    shape.closePath()

    return shape
  }, [node?.polygon?.points])

  // Create boundary line geometry
  const lineGeometry = useMemo(() => {
    if (!node?.polygon?.points || node.polygon.points.length < 2) return null
    return createBoundaryLineGeometry(node.polygon.points)
  }, [node?.polygon?.points])

  // Edge distances for labels
  const edges = useMemo(() => {
    const polygon = node?.polygon?.points ?? []
    if (polygon.length < 2) return []
    return polygon.map(([x1, z1], i) => {
      const [x2, z2] = polygon[(i + 1) % polygon.length]!
      const midX = (x1! + x2) / 2
      const midZ = (z1! + z2) / 2
      const dist = Math.sqrt((x2 - x1!) ** 2 + (z2 - z1!) ** 2)
      return { midX, midZ, dist }
    })
  }, [node?.polygon?.points])

  const handlers = useNodeEvents(node, 'site')

  if (!node || !floorShape || !lineGeometry) {
    return null
  }

  return (
    <group ref={ref} {...handlers}>
      {/* Render children (buildings and items) */}
      {node.children.map((child) => (
        <NodeRenderer
          key={typeof child === 'string' ? child : child.id}
          nodeId={typeof child === 'string' ? child : child.id}
        />
      ))}

      {/* Transparent floor fill */}
      <mesh position={[0, Y_OFFSET - 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[floorShape]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0.05}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Simple boundary line */}
      {/* @ts-ignore */}
      <line geometry={lineGeometry} frustumCulled={false} renderOrder={9}>
        <lineBasicMaterial
          color="#f59e0b"
          linewidth={2}
          transparent
          opacity={0.6}
        />
      </line>

      {/* Edge distance labels */}
      {edges.map((edge, i) => (
        <Html
          center
          key={`edge-${i}`}
          position={[edge.midX, 0.5, edge.midZ]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[10, 0]}
        >
          <div className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 font-mono text-white text-xs backdrop-blur-sm">
            {edge.dist.toFixed(2)}m
          </div>
        </Html>
      ))}
    </group>
  )
}
