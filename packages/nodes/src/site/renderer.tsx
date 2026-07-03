'use client'

import { type AnyNodeId, type SiteNode, useRegistry, useScene } from '@pascal-app/core'
import { getSceneTheme } from '@pascal-app/viewer/scene-themes'
import { NodeRenderer } from '@pascal-app/viewer/node-renderer'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { unionPolygons } from '@pascal-app/viewer/polygon-union'
import { createSafeEmptyGeometry } from '@pascal-app/viewer/safe-geometry'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  Path,
  Shape,
  ShapeGeometry,
} from 'three'
import { MeshLambertNodeMaterial } from 'three/webgpu'
import { collectRecessedSlabGroundHolePolygons } from './ground-holes'

const Y_OFFSET = 0.01

const signedArea2 = (polygon: ReadonlyArray<readonly [number, number]>) =>
  polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) return sum
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)

const ensureWinding = (
  polygon: ReadonlyArray<readonly [number, number]>,
  winding: 'ccw' | 'cw',
): [number, number][] => {
  const points = polygon.map(([x, z]) => [x, z] as [number, number])
  const area2 = signedArea2(points)
  const isCcw = area2 > 0
  return (winding === 'ccw' && !isCcw) || (winding === 'cw' && isCcw) ? points.reverse() : points
}

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

export const SiteRenderer = ({ node }: { node: SiteNode }) => {
  const ref = useRef<Group>(null!)
  const slabPolygonsCache = useRef<[number, number][][]>([])

  useRegistry(node.id, 'site', ref)

  const bgColor = useViewer((state) => getSceneTheme(state.sceneTheme).ground)
  const groundMaterial = useMemo(() => {
    const material = new MeshLambertNodeMaterial({ color: bgColor })
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1
    return material
  }, [bgColor])

  const slabPolygons = useScene((state) => {
    const next = collectRecessedSlabGroundHolePolygons(state.nodes)
    const prev = slabPolygonsCache.current

    if (next.length === prev.length && next.every((polygon, index) => polygon === prev[index])) {
      return prev
    }

    slabPolygonsCache.current = next
    return next
  })

  // Ground shape: site polygon with recessed slab footprints punched as holes
  const groundShape = useMemo(() => {
    if (!node?.polygon?.points || node.polygon.points.length < 3) return null

    const pts = ensureWinding(node.polygon.points, 'ccw')
    const shape = new Shape()
    shape.moveTo(pts[0]![0], -pts[0]![1])
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], -pts[i]![1])
    shape.closePath()

    if (slabPolygons.length > 0) {
      const shapeHoleInputs = slabPolygons.map((polygon) =>
        polygon.map((point) => [point[0], -point[1]] as [number, number]),
      )
      const holeRingsRaw =
        shapeHoleInputs.length === 1 ? shapeHoleInputs : unionPolygons(shapeHoleInputs)
      const holeRings = holeRingsRaw.map((ring) => ensureWinding(ring, 'cw'))

      for (const ring of holeRings) {
        if (ring.length < 3) continue
        const hole = new Path()
        hole.moveTo(ring[0]![0], ring[0]![1])
        for (let i = 1; i < ring.length; i++) hole.lineTo(ring[i]![0], ring[i]![1])
        hole.closePath()
        shape.holes.push(hole)
      }
    }

    return shape
  }, [node?.polygon?.points, slabPolygons])

  const groundGeometry = useMemo(() => {
    if (!groundShape) return null

    const geometry = new ShapeGeometry(groundShape)
    const position = geometry.getAttribute('position')
    if (position && position.count >= 3) return geometry

    geometry.dispose()
    return createSafeEmptyGeometry()
  }, [groundShape])

  // Create boundary line geometry
  const lineGeometry = useMemo(() => {
    if (!node?.polygon?.points || node.polygon.points.length < 2) return null
    return createBoundaryLineGeometry(node.polygon.points)
  }, [node?.polygon?.points])

  useEffect(() => {
    return () => {
      groundGeometry?.dispose()
      lineGeometry?.dispose()
    }
  }, [groundGeometry, lineGeometry])

  const handlers = useNodeEvents(node, 'site')

  if (!(node && lineGeometry)) {
    return null
  }

  return (
    <group ref={ref} {...handlers}>
      {/* Render children (buildings and items) */}
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId as AnyNodeId} />
      ))}

      {/* Ground fill: site polygon with slab holes, occludes below-grade geometry */}
      {groundGeometry && (
        <mesh
          geometry={groundGeometry}
          material={groundMaterial}
          position={[0, -0.05, 0]}
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
        />
      )}

      {/* Simple boundary line */}
      {/* @ts-ignore */}
      <line frustumCulled={false} geometry={lineGeometry} renderOrder={9}>
        <lineBasicMaterial color="#f59e0b" linewidth={2} opacity={0.6} transparent />
      </line>
    </group>
  )
}

export default SiteRenderer
