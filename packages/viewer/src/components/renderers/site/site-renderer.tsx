import { type SiteNode, type SlabNode, useRegistry, useScene } from '@pascal-app/core'
import polygonClipping from 'polygon-clipping'
import { useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group, Path, Shape } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { NodeRenderer } from '../node-renderer'

const Y_OFFSET = 0.01

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
    positions.push(x ?? 0, Y_OFFSET, z ?? 0)
  }
  // Close the loop
  positions.push(points[0]?.[0] ?? 0, Y_OFFSET, points[0]?.[1] ?? 0)

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

  return geometry
}

type S = ReturnType<typeof useScene.getState>

export const SiteRenderer = ({ node }: { node: SiteNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, 'site', ref)

  const theme = useViewer((state) => state.theme)
  const bgColor = theme === 'dark' ? '#1f2433' : '#fafafa'

  // Cache slab polygon references to keep the selector stable across unrelated store updates
  const slabPolygonsCache = useRef<[number, number][][]>([])
  const slabPolygons = useScene((state: S) => {
    const nodeList = Object.values(state.nodes)

    const levelIndexById = new Map<string, number>()
    let lowestLevelIndex = Number.POSITIVE_INFINITY
    nodeList.forEach((n) => {
      if (n.type !== 'level') return
      levelIndexById.set(n.id, n.level)
      lowestLevelIndex = Math.min(lowestLevelIndex, n.level)
    })

    const next = nodeList
      .filter(
        (n): n is SlabNode =>
          n.type === 'slab' &&
          n.visible &&
          n.polygon.length >= 3 &&
          // Only recessed slabs should punch through the site ground.
          // Positive slabs are real floor geometry and should not create a
          // ghost footprint in the background ground fill.
          (n.elevation ?? 0.05) < 0,
      )
      .filter((n) => {
        if (!Number.isFinite(lowestLevelIndex)) return true
        const parentLevel = n.parentId ? levelIndexById.get(n.parentId as string) : undefined
        return parentLevel === lowestLevelIndex
      })
      .map((n) => n.polygon as [number, number][])

    const prev = slabPolygonsCache.current
    if (next.length === prev.length && next.every((p, i) => p === prev[i])) return prev
    slabPolygonsCache.current = next
    return next
  })

  // Ground shape: site polygon with slab footprints punched as holes
  const groundShape = useMemo(() => {
    if (!node?.polygon?.points || node.polygon.points.length < 3) return null

    const pts = node.polygon.points
    const shape = new Shape()
    shape.moveTo(pts[0]![0], -pts[0]![1])
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], -pts[i]![1])
    shape.closePath()

    if (slabPolygons.length > 0) {
      const multiPolygons = slabPolygons.map((p) => [
        p.map((pt) => [pt[0], -pt[1]] as [number, number]),
      ])
      const unioned = polygonClipping.union(
        multiPolygons[0] as polygonClipping.Polygon,
        ...(multiPolygons.slice(1) as polygonClipping.Polygon[]),
      )
      for (const geom of unioned) {
        const ring = geom[0]
        if (ring && ring.length > 0) {
          const hole = new Path()
          hole.moveTo(ring[0]![0], ring[0]![1])
          for (let i = 1; i < ring.length; i++) hole.lineTo(ring[i]![0], ring[i]![1])
          hole.closePath()
          shape.holes.push(hole)
        }
      }
    }

    return shape
  }, [node?.polygon?.points, slabPolygons])

  // Create boundary line geometry
  const lineGeometry = useMemo(() => {
    if (!node?.polygon?.points || node.polygon.points.length < 2) return null
    return createBoundaryLineGeometry(node.polygon.points)
  }, [node?.polygon?.points])

  const handlers = useNodeEvents(node, 'site')

  if (!(node && lineGeometry)) {
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

      {/* Ground fill: site polygon with slab holes, occludes below-grade geometry */}
      {groundShape && (
        <mesh position={[0, -0.05, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <shapeGeometry args={[groundShape]} />
          <meshStandardMaterial
            color={bgColor}
            depthWrite={true}
            polygonOffset={true}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
      )}

      {/* Simple boundary line */}
      {/* @ts-ignore */}
      <line frustumCulled={false} geometry={lineGeometry} renderOrder={9}>
        <lineBasicMaterial color="#f59e0b" linewidth={2} opacity={0.6} transparent />
      </line>
    </group>
  )
}
