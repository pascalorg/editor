'use client'

import {
  type AnyNodeId,
  type SiteNode,
  type SlabNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  getSceneTheme,
  NodeRenderer,
  unionPolygons,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  Path,
  Shape,
  ShapeGeometry,
} from 'three'
import { color, float, mix, positionWorld, smoothstep, vec2 } from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'

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

  const bgColor = useViewer((state) => getSceneTheme(state.sceneTheme).ground)
  const backgroundColor = useViewer((state) => getSceneTheme(state.sceneTheme).background)
  const livePolygon = useLiveNodeOverrides(
    (state) => (state.overrides.get(node.id)?.polygon as SiteNode['polygon'] | undefined) ?? null,
  )
  const polygonPoints = livePolygon?.points ?? node.polygon?.points

  // Centroid + radius of the lot polygon, for the presentation fade below.
  const fadeBounds = useMemo(() => {
    if (!polygonPoints || polygonPoints.length < 3) return null
    let cx = 0
    let cz = 0
    for (const [x, z] of polygonPoints) {
      cx += x ?? 0
      cz += z ?? 0
    }
    cx /= polygonPoints.length
    cz /= polygonPoints.length
    let radius = 0
    for (const [x, z] of polygonPoints) {
      radius = Math.max(radius, Math.hypot((x ?? 0) - cx, (z ?? 0) - cz))
    }
    return { cx, cz, radius }
  }, [polygonPoints])

  // Lit (not Basic) so the site ground receives the directional shadow — Basic
  // is unlit, which is why shadows used to stop dead at the slab edge. polygonOffset
  // keeps it tucked behind the grid/slab as before.
  //
  // The ground fill fades radially into the theme background toward the lot
  // boundary so the scene reads as a deliberate presentation vignette instead
  // of a hard-edged plate floating on the backdrop.
  const groundMaterial = useMemo(() => {
    const material = new MeshLambertNodeMaterial({ color: bgColor })
    if (fadeBounds) {
      const center = vec2(fadeBounds.cx, fadeBounds.cz)
      const dist = positionWorld.xz.sub(center).length()
      const fade = smoothstep(
        float(fadeBounds.radius * 0.45),
        float(fadeBounds.radius * 0.98),
        dist,
      )
      material.colorNode = mix(color(bgColor), color(backgroundColor), fade)
    }
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1
    return material
  }, [bgColor, backgroundColor, fadeBounds])

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
    if (!polygonPoints || polygonPoints.length < 3) return null

    const pts = polygonPoints
    const shape = new Shape()
    shape.moveTo(pts[0]![0], -pts[0]![1])
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], -pts[i]![1])
    shape.closePath()

    if (slabPolygons.length > 0) {
      for (const ring of unionPolygons(slabPolygons.map((p) => p.map((pt) => [pt[0], -pt[1]])))) {
        if (ring.length < 3) continue
        const hole = new Path()
        hole.moveTo(ring[0]![0], ring[0]![1])
        for (let i = 1; i < ring.length; i++) hole.lineTo(ring[i]![0], ring[i]![1])
        hole.closePath()
        shape.holes.push(hole)
      }
    }

    return shape
  }, [polygonPoints, slabPolygons])

  // Create boundary line geometry
  const lineGeometry = useMemo(() => {
    if (!polygonPoints || polygonPoints.length < 2) return null
    return createBoundaryLineGeometry(polygonPoints)
  }, [polygonPoints])
  useEffect(() => () => lineGeometry?.dispose(), [lineGeometry])

  const groundGeometry = useMemo(() => {
    if (!groundShape) return null
    return new ShapeGeometry(groundShape)
  }, [groundShape])
  useEffect(() => () => groundGeometry?.dispose(), [groundGeometry])

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
