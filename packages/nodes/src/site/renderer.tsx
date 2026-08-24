'use client'

import {
  type AnyNodeId,
  type SiteNode,
  type TerrainField,
  terrainFieldOf,
  unionPolygons,
  useLiveNodeOverrides,
  useLiveTerrain,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  backdropGradient,
  deepSkyColor,
  getSceneTheme,
  horizonHazeColor,
  NodeRenderer,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, type Group, Path, Shape, ShapeGeometry } from 'three'
import { cameraPosition, color, float, mix, positionWorld, smoothstep, vec2 } from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'
import { getRecessedSlabGroundHoles } from './recessed-slab-ground-holes'
import {
  buildDrapedPolyline,
  type DrapedPolyline,
  terrainGridKey,
  updateDrapedHeights,
} from './terrain-drape'
import { HORIZON_PLANE_Y, terrainFootprint } from './terrain-geometry'
import { TerrainRenderer } from './terrain-renderer'

const Y_OFFSET = 0.01

// The horizon disc is presentation-only — clicks must fall through to the
// real site polygon / grid, so its raycast is a no-op.
const noopRaycast = () => {}

/**
 * The site boundary line, laid on the ground rather than across it.
 *
 * On flat ground this is the ring it always was: the polygon's own vertices at
 * `Y_OFFSET`, closed. On sculpted ground `buildDrapedPolyline` subdivides each
 * edge at the mesh's creases so the line lies *on* the rendered surface — the lot
 * line is on screen in every frame, and a flat ring slicing through a hill is the
 * most conspicuous way sculpted ground reads as broken.
 *
 * UVs keep their `(u, 0)` layout, now measured as normalized XZ arc length rather
 * than vertex index, so a dashed or gradient material spaces evenly along the
 * perimeter instead of bunching on short edges.
 */
const createBoundaryLineGeometry = (
  points: Array<[number, number]>,
  field: TerrainField | null,
): { geometry: BufferGeometry; ring: DrapedPolyline } => {
  const geometry = new BufferGeometry()
  const ring = buildDrapedPolyline({ points, field, lift: Y_OFFSET, closed: true })
  const uvs = new Float32Array(ring.uvs.length * 2)
  for (let index = 0; index < ring.uvs.length; index++) {
    uvs[index * 2] = ring.uvs[index] ?? 0
  }
  // `BufferAttribute`, not `Float32BufferAttribute`: the latter copies its input
  // into a fresh array, which would leave `ring.positions` a detached CPU copy and
  // silently break the in-place dab rewrite below. This shares the buffer.
  geometry.setAttribute('position', new BufferAttribute(ring.positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  return { geometry, ring }
}

/**
 * Re-upload a draped ring's positions after an in-place height rewrite.
 *
 * No `addUpdateRange`: a dab can move any subset of the ring's vertices (the brush
 * is a disc, the ring is a loop, and the two intersect in up to four arcs), so a
 * range would either be the whole buffer or a list. The whole buffer is a few KB.
 */
function markPositionsDirty(geometry: BufferGeometry): void {
  const attribute = geometry.getAttribute('position') as BufferAttribute
  attribute.needsUpdate = true
  geometry.computeBoundingSphere()
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

  // Persisted terrain only. A stroke is applied imperatively further down, for the
  // same reason `TerrainRenderer` does it: a dab must not re-render this subtree.
  const persistedField = useMemo(
    () => terrainFieldOf({ id: node.id, terrain: node.terrain }),
    [node.id, node.terrain],
  )

  // The terrain *grid* — mounting, resizing, or re-origining it. `hasTerrain`
  // catches the first dab on a site that had no terrain at all, which is the one
  // case where a stroke legitimately changes the grid and everything keyed on it
  // (the horizon punch, the boundary subdivision) has to rebuild.
  const hasTerrain = useLiveTerrain((state) => state.strokes.has(node.id))
  const terrainGrid = hasTerrain
    ? (useLiveTerrain.getState().fieldOf(node.id) ?? persistedField)
    : persistedField
  const terrainKey = terrainGridKey(terrainGrid)

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

  // The terrain footprint is punched out alongside the recessed slabs, and for the
  // same reason: the disc must not cap ground that is modelled below it.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `terrainKey` is the grid signature the footprint is a function of; depending on the field itself would rebuild an 800 m disc every dab.
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
    const holes = terrainGrid ? [...slabPolygons, terrainFootprint(terrainGrid)] : slabPolygons
    addSlabHoles(shape, holes, fadeBounds.cx, fadeBounds.cz)
    return new ShapeGeometry(shape)
  }, [fadeBounds, slabPolygons, terrainKey])
  useEffect(() => () => horizonGeometry?.dispose(), [horizonGeometry])

  // Boundary line geometry, subdivided against the terrain grid when there is one.
  //
  // Keyed on `terrainKey`, not on the field: the crease set depends on the grid
  // (origin/spacing/extent) and not on the heights, so a sculpt stroke — which
  // produces a new field object every dab — must not rebuild this. Heights are
  // rewritten in place by the subscription below.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the grid, not the field — see above.
  const boundary = useMemo(() => {
    if (!polygonPoints || polygonPoints.length < 2) return null
    // The live field, not the persisted one: mounting mid-stroke (the very first
    // dab on a terrain-free site remounts this subtree) must drape against the
    // ground actually on screen.
    const field = useLiveTerrain.getState().fieldOf(node.id) ?? persistedField
    return createBoundaryLineGeometry(polygonPoints, field)
  }, [polygonPoints, terrainKey, node.id])
  useEffect(() => () => boundary?.geometry.dispose(), [boundary])
  const lineGeometry = boundary?.geometry ?? null

  // Per-dab height rewrite, imperative for the same reason `TerrainRenderer`'s
  // upload is: a stroke pushes dozens of patches a second, and routing each through
  // a React render would rebuild the ring's buffers at pointer rate. The XZ of every
  // vertex is a function of the grid alone, so a dab only ever moves Y.
  //
  // A ref, not the memo value in a dependency, so the subscription outlives a
  // polygon edit without resubscribing.
  const boundaryRef = useRef<{ geometry: BufferGeometry; ring: DrapedPolyline } | null>(null)
  boundaryRef.current = boundary
  useEffect(() => {
    let lastPatch = useLiveTerrain.getState().strokeOf(node.id)?.lastPatch ?? null
    return useLiveTerrain.subscribe((state) => {
      const current = boundaryRef.current
      if (!current) return
      const stroke = state.strokes.get(node.id)
      if (!stroke) {
        // The stroke ended. Its heights are now the node's, and the commit
        // re-rendered this subtree with them — but a *cancelled* stroke (Escape)
        // commits nothing, so the ring has to be put back explicitly.
        if (lastPatch) {
          lastPatch = null
          const field = terrainFieldOf({ id: node.id, terrain: node.terrain })
          updateDrapedHeights(current.ring, field, Y_OFFSET)
          markPositionsDirty(current.geometry)
        }
        return
      }
      if (!stroke.lastPatch || stroke.lastPatch === lastPatch) return
      lastPatch = stroke.lastPatch
      updateDrapedHeights(current.ring, stroke.field, Y_OFFSET)
      markPositionsDirty(current.geometry)
    })
  }, [node.id, node.terrain])

  const groundGeometry = useMemo(() => {
    if (!groundShape) return null
    return new ShapeGeometry(groundShape)
  }, [groundShape])
  useEffect(() => () => groundGeometry?.dispose(), [groundGeometry])

  const handlers = useNodeEvents(node, 'site')

  // Terrain replaces the flat ground fill rather than sitting on top of it: two
  // coplanar ground surfaces z-fight, and the flat one would poke through any
  // excavation. `hasTerrain` (above) is subscribed at the site level rather than
  // inside TerrainRenderer so a stroke that starts on a site with no persisted
  // terrain still mounts the mesh.
  const showTerrain = terrainGrid !== null

  if (!(node && lineGeometry)) {
    return null
  }

  return (
    <group ref={ref} {...handlers}>
      {/* Render children (buildings and items) */}
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId as AnyNodeId} />
      ))}

      {/* Sculpted ground, when the site has terrain */}
      {showTerrain && <TerrainRenderer material={groundMaterial} site={node} />}

      {/* Ground fill: site polygon with slab holes, occludes below-grade geometry */}
      {groundGeometry && !showTerrain && (
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
          position={[fadeBounds.cx, HORIZON_PLANE_Y, fadeBounds.cz]}
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
