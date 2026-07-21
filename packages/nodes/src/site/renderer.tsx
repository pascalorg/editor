'use client'

import {
  type AnyNodeId,
  type SiteNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  backdropGradient,
  deepSkyColor,
  getSceneTheme,
  horizonHazeColor,
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
import { cameraPosition, color, float, mix, positionWorld, smoothstep, vec2 } from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'
import { getRecessedSlabGroundHoles } from './recessed-slab-ground-holes'

const Y_OFFSET = 0.01

// The horizon disc is presentation-only — clicks must fall through to the
// real site polygon / grid, so its raycast is a no-op.
const noopRaycast = () => {}

/**
 * Creates simple line geometry for site boundary
 * Single horizontal line at ground level
 */
const createBoundaryLineGeometry = (points: Array<[number, number]>): BufferGeometry => {
  const geometry = new BufferGeometry()

  if (points.length < 2) return geometry

  const positions: number[] = []
  const uvs: number[] = []

  // Create a simple line loop at ground level
  points.forEach(([x, z], index) => {
    positions.push(x ?? 0, Y_OFFSET, z ?? 0)
    uvs.push(points.length > 1 ? index / (points.length - 1) : 0, 0)
  })
  // Close the loop
  positions.push(points[0]?.[0] ?? 0, Y_OFFSET, points[0]?.[1] ?? 0)
  uvs.push(1, 0)

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))

  return geometry
}

type S = ReturnType<typeof useScene.getState>

function polygonsMatch(
  a: Array<Array<[number, number]>>,
  b: Array<Array<[number, number]>>,
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (polygon, polygonIndex) =>
        polygon.length === b[polygonIndex]?.length &&
        polygon.every(
          (point, pointIndex) =>
            point[0] === b[polygonIndex]?.[pointIndex]?.[0] &&
            point[1] === b[polygonIndex]?.[pointIndex]?.[1],
        ),
    )
  )
}

function addSlabHoles(
  shape: Shape,
  slabPolygons: Array<Array<[number, number]>>,
  originX = 0,
  originZ = 0,
) {
  const localPolygons = slabPolygons.map((polygon) =>
    polygon.map(([x, z]): [number, number] => [x - originX, -(z - originZ)]),
  )
  for (const ring of unionPolygons(localPolygons)) {
    if (ring.length < 3) continue
    const hole = new Path()
    hole.moveTo(ring[0]![0], ring[0]![1])
    for (let index = 1; index < ring.length; index += 1) {
      hole.lineTo(ring[index]![0], ring[index]![1])
    }
    hole.closePath()
    shape.holes.push(hole)
  }
}

export const SiteRenderer = ({ node }: { node: SiteNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, 'site', ref)

  const bgColor = useViewer((state) => getSceneTheme(state.sceneTheme).ground)
  const backgroundColor = useViewer((state) => getSceneTheme(state.sceneTheme).background)
  const skyColor = useViewer((state) => {
    const theme = getSceneTheme(state.sceneTheme)
    return theme.backgroundSky ?? theme.background
  })
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const maxLightIntensity = useViewer((state) =>
    Math.max(1, ...getSceneTheme(state.sceneTheme).lights.map((light) => light.intensity)),
  )
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
  const groundMaterial = useMemo(() => {
    const material = new MeshLambertNodeMaterial({ color: bgColor })
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1
    return material
  }, [bgColor])

  // Presentation horizon: a large ground disc under the lot, in the same
  // theme ground colour, fading radially into the theme background so the
  // scene sits on an "infinite" plane that dissolves into the sky instead of
  // a hard-edged plate floating on the backdrop. Never pickable.
  const horizonMaterial = useMemo(() => {
    if (!fadeBounds) return null
    const material = new MeshLambertNodeMaterial({ color: bgColor })
    const center = vec2(fadeBounds.cx, fadeBounds.cz)
    const dist = positionWorld.xz.sub(center).length()
    const fade = smoothstep(float(fadeBounds.radius * 1.05), float(fadeBounds.radius * 5), dist)
    // Contact vignette: a soft darkening that hugs the lot so the parcel
    // reads as sitting on the ground instead of floating on an even field.
    // The linear cut competes with the tone mapper's shoulder — bright themes
    // (studio's key light runs at intensity 4) compress a fixed 15% to almost
    // nothing — so the strength scales with the theme's strongest light.
    const vignetteStrength = Math.min(0.45, 0.13 * maxLightIntensity)
    const halo = float(1)
      .sub(smoothstep(float(fadeBounds.radius * 0.95), float(fadeBounds.radius * 2.6), dist))
      .mul(vignetteStrength)
    const haloFactor = float(1).sub(halo)
    material.colorNode = mix(color(bgColor), color('#000000'), fade).mul(haloFactor)
    // Dissolve, not tint: the albedo (lighting response, incl. shadows) fades
    // to black while an emissive term fades up to the backdrop gradient — the
    // exact formula the post pipeline composites (viewer lib/backdrop.ts),
    // evaluated with this fragment's view direction, so the far end is
    // literally the backdrop (incl. the horizon haze) from any camera pose.
    const viewDirY = positionWorld.sub(cameraPosition).normalize().y
    const backdrop = backdropGradient({
      dirY: viewDirY,
      background: color(backgroundColor),
      haze: color(horizonHazeColor(skyColor, appearance)),
      sky: color(skyColor),
      skyDeep: color(deepSkyColor(skyColor)),
    })
    // The halo also scales the in-band emissive: the dissolve starts at 1.05R,
    // so without it the (bright) backdrop dilutes the vignette exactly where
    // it should read. halo is 0 past 2.6R while the dissolve completes at 5R,
    // so the far field stays the pure backdrop — the seam guarantee holds.
    ;(material as unknown as { emissiveNode: unknown }).emissiveNode = mix(
      color('#000000'),
      backdrop,
      fade,
    ).mul(haloFactor)
    material.polygonOffset = true
    material.polygonOffsetFactor = 2
    material.polygonOffsetUnits = 2
    return material
  }, [bgColor, backgroundColor, skyColor, appearance, maxLightIntensity, fadeBounds])

  // Cache computed polygons to keep the selector stable across unrelated store updates.
  const slabPolygonsCache = useRef<[number, number][][]>([])
  const slabPolygons = useScene((state: S) => {
    const next = getRecessedSlabGroundHoles(state.nodes)

    const prev = slabPolygonsCache.current
    if (polygonsMatch(next, prev)) return prev
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

    addSlabHoles(shape, slabPolygons)

    return shape
  }, [polygonPoints, slabPolygons])

  const horizonGeometry = useMemo(() => {
    if (!fadeBounds) return null
    const radius = Math.max(fadeBounds.radius * 8, 400)
    const shape = new Shape()
    const segments = 64
    shape.moveTo(radius, 0)
    for (let index = 1; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2
      shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
    shape.closePath()
    addSlabHoles(shape, slabPolygons, fadeBounds.cx, fadeBounds.cz)
    return new ShapeGeometry(shape)
  }, [fadeBounds, slabPolygons])
  useEffect(() => () => horizonGeometry?.dispose(), [horizonGeometry])

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

      {/* Infinite-ground presentation disc fading into the sky at the horizon */}
      {horizonGeometry && horizonMaterial && fadeBounds && (
        <mesh
          geometry={horizonGeometry}
          material={horizonMaterial}
          position={[fadeBounds.cx, -0.07, fadeBounds.cz]}
          raycast={noopRaycast}
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          userData={{ pascalExport: 'strip' }}
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
