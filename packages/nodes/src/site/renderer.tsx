'use client'

import {
  type AnyNodeId,
  belowGradeFloorY,
  belowGradeFootprints,
  coveredBelowGradeFootprints,
  groundPitFloorY,
  intersection,
  type SiteNode,
  sightTriangle,
  siteFrontEdge,
  siteSetbackEnvelope,
  streetCorners,
  surfaceHeightAt,
  type TerrainField,
  terrainContours,
  terrainFieldOf,
  union,
  unionPolygons,
  useLiveNodeOverrides,
  useLiveTerrain,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  backdropColors,
  backdropGradient,
  groundWindowMaskNode,
  NodeRenderer,
  SITE_GROUND,
  siteGroundShown,
  UNDERGROUND_RIM,
  useImmersiveXRPresentation,
  useNodeEvents,
  useSceneAtmosphere,
  useSceneGroundReplacement,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type Group,
  Path,
  Shape,
  ShapeGeometry,
} from 'three'
import {
  cameraPosition,
  color,
  mix,
  positionWorld,
  smoothstep,
  float as tslFloat,
  vec2,
} from 'three/tsl'
import { MeshLambertNodeMaterial } from 'three/webgpu'
import { GenericFoundation } from './generic-foundation'
import {
  GroundHole,
  groundHoleColorNode,
  groundHoleShadowNode,
  solidGroundMaskNode,
} from './ground-hole'
import {
  GroundVeil,
  gradeRingGeometry,
  gradeRingMaterial,
  groundVeilMaterial,
  horizonVeilMaterial,
  noopRaycast,
} from './ground-veil'
import { GroundWindowSystem } from './ground-window-system'
import {
  buildPatternedRibbon,
  PROPERTY_LINE_PATTERN,
  SETBACK_LINE_PATTERN,
  updateRibbonHeights,
} from './line-ribbon'
import { getRecessedSlabGroundHoles } from './recessed-slab-ground-holes'
import {
  buildDrapedPolyline,
  type DrapedPolyline,
  terrainGridKey,
  updateDrapedHeights,
} from './terrain-drape'
import { HORIZON_PLANE_Y, terrainBlockBase } from './terrain-geometry'
import { TerrainRenderer } from './terrain-renderer'

const Y_OFFSET = 0.01

/** The flat lot's fill, just under grade; the plan's shapes lie in XY, turned to lie flat. */
const GROUND_FILL_POSITION: [number, number, number] = [0, -0.05, 0]
const FLAT_ON_THE_GROUND: [number, number, number] = [-Math.PI / 2, 0, 0]

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
type Ribbons = {
  property: BufferGeometry
  envelope: BufferGeometry | null
  triangles: BufferGeometry[]
}

function redrapeRibbons(r: Ribbons | null, field: TerrainField | null): void {
  if (!r) return
  updateRibbonHeights(r.property, field, Y_OFFSET)
  if (r.envelope) updateRibbonHeights(r.envelope, field, Y_OFFSET + 0.01)
  for (const g of r.triangles) updateRibbonHeights(g, field, Y_OFFSET + 0.012)
}

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
  const immersiveXR = useImmersiveXRPresentation()
  const atmosphere = useSceneAtmosphere()
  const groundReplaced = useSceneGroundReplacement()

  useRegistry(node.id, 'site', ref)

  const theme = useViewer((state) => state.sceneAppearance)
  const bgColor = theme.ground
  const { background: backgroundColor, sky: skyColor, haze, skyDeep } = backdropColors(theme)
  const maxLightIntensity = Math.max(1, ...theme.lights.map((light) => light.intensity))
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

  // Where the ground meets the levels below grade. `all` says whether the scene has any (the
  // ground materials carry the hole's mask from then on); `shown` is what the hole is cut over and
  // the grade ring runs along under the veil: the level shown and the ones between it and grade, as
  // the level display hides them. While the level shown is not below grade the last such set is
  // kept, so a hole easing shut keeps its shape. `covered` is the part of them under the house
  // itself, whatever level is shown: the ground stands open there (see `holes`).
  const shownLevelId = useViewer((state) =>
    state.hideLevelsAboveSelection ? state.selection.levelId : null,
  )
  const belowGrade = useViewer((state) => state.belowGrade)
  const groundMode = useViewer((state) => state.groundMode)
  const buriedCache = useRef<{
    all: [number, number][][]
    shown: [number, number][][]
    floorY: number | null
    drawnFloorY: number | null
    covered: [number, number][][]
  }>({ all: [], shown: [], floorY: null, drawnFloorY: null, covered: [] })
  const buried = useScene((state: S) => {
    const prev = buriedCache.current
    const found = belowGradeFootprints(state.nodes)
    const all = polygonsMatch(found, prev.all) ? prev.all : found
    const foundCovered = all.length > 0 ? coveredBelowGradeFootprints(state.nodes) : []
    const covered = polygonsMatch(foundCovered, prev.covered) ? prev.covered : foundCovered
    let shown: [number, number][][] = []
    let floorY: number | null = null
    let drawnFloorY: number | null = null
    if (all.length > 0) {
      shown = shownLevelId ? belowGradeFootprints(state.nodes, shownLevelId) : []
      floorY = shownLevelId ? belowGradeFloorY(state.nodes, shownLevelId) : null
      drawnFloorY = shownLevelId ? groundPitFloorY(state.nodes, shownLevelId) : null
      if (shown.length === 0) shown = prev.shown.length > 0 ? prev.shown : all
      floorY ??= prev.floorY
      drawnFloorY ??= prev.drawnFloorY
    }
    if (polygonsMatch(shown, prev.shown)) shown = prev.shown
    if (
      all === prev.all &&
      shown === prev.shown &&
      floorY === prev.floorY &&
      drawnFloorY === prev.drawnFloorY &&
      covered === prev.covered
    )
      return prev
    buriedCache.current = { all, shown, floorY, drawnFloorY, covered }
    return buriedCache.current
  })
  // Where the pit's walls start: the ground itself, flat or the sculpted terrain.
  const groundTopAt = useMemo(
    () => (x: number, z: number) =>
      persistedField ? surfaceHeightAt(persistedField, x, z) : GROUND_FILL_POSITION[1],
    [persistedField],
  )
  // Lit (not Basic) so the site ground receives the directional shadow — Basic
  // is unlit, which is why shadows used to stop dead at the slab edge. polygonOffset
  // keeps it tucked behind the grid/slab as before.
  // The hole's nodes are in the material from the moment the scene has a level below grade (once,
  // not when a floor is picked), the opening a uniform; without one the materials stay plain.
  const hasBasement = buried.all.length > 0
  const groundMaterial = useMemo(() => {
    const material = new MeshLambertNodeMaterial({ color: bgColor })
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1
    // The ground window cuts the solid ground where it stands in the eye's way (viewer
    // lib/ground-window), and the hole opens over a level below grade (ground-hole.tsx), its
    // edge a noise threshold with a thin slate rim; with both closed the mask passes everywhere.
    if (hasBasement) {
      ;(material as unknown as { maskNode: unknown }).maskNode = solidGroundMaskNode()
      material.colorNode = groundHoleColorNode(UNDERGROUND_RIM)
      material.receivedShadowNode = groundHoleShadowNode()
    } else {
      ;(material as unknown as { maskNode: unknown }).maskNode = groundWindowMaskNode()
    }
    return material
  }, [bgColor, hasBasement])

  // Presentation horizon: a large ground disc under the lot, fading into the
  // active fog radiance (or the theme backdrop when there is no atmosphere) so
  // the scene sits on an "infinite" plane instead of a hard-edged plate. Never pickable.
  const horizonMaterial = useMemo(() => {
    if (!fadeBounds || groundReplaced) return null
    const material = new MeshLambertNodeMaterial({ color: bgColor })
    const center = vec2(fadeBounds.cx, fadeBounds.cz)
    const dist = positionWorld.xz.sub(center).length()
    const fade = smoothstep(
      tslFloat(fadeBounds.radius * 1.05),
      tslFloat(fadeBounds.radius * 5),
      dist,
    )
    // Contact vignette: a soft darkening that hugs the lot so the parcel
    // reads as sitting on the ground instead of floating on an even field.
    // The linear cut competes with the tone mapper's shoulder — bright themes
    // (studio's key light runs at intensity 4) compress a fixed 15% to almost
    // nothing — so the strength scales with the theme's strongest light.
    const vignetteStrength = Math.min(0.45, 0.13 * maxLightIntensity)
    const halo = tslFloat(1)
      .sub(smoothstep(tslFloat(fadeBounds.radius * 0.95), tslFloat(fadeBounds.radius * 2.6), dist))
      .mul(vignetteStrength)
    const haloFactor = tslFloat(1).sub(halo)
    material.colorNode = mix(color(bgColor), color('#000000'), fade).mul(haloFactor)
    // Dissolve, not tint: albedo fades to black while emissive fades up to the
    // exact active horizon source, evaluated with this fragment's world-space
    // view direction. fogRadiance excludes celestial discs and stars so they
    // cannot leave bright spots around the ground seam.
    const viewDir = positionWorld.sub(cameraPosition).normalize()
    const backdrop = atmosphere
      ? atmosphere.fogRadiance(viewDir)
      : backdropGradient({
          dirY: viewDir.y,
          background: color(backgroundColor),
          haze: color(haze),
          sky: color(skyColor),
          skyDeep: color(skyDeep),
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
    if (hasBasement) {
      ;(material as unknown as { maskNode: unknown }).maskNode = solidGroundMaskNode()
      material.receivedShadowNode = groundHoleShadowNode()
    } else {
      ;(material as unknown as { maskNode: unknown }).maskNode = groundWindowMaskNode()
    }
    return material
  }, [
    hasBasement,
    atmosphere,
    bgColor,
    backgroundColor,
    skyColor,
    haze,
    skyDeep,
    maxLightIntensity,
    fadeBounds,
    groundReplaced,
  ])

  // Over a level below grade the ground is drawn as a veil (ground-veil.tsx).
  const groundVeil = useMemo(() => groundVeilMaterial(bgColor), [bgColor])
  useEffect(() => () => groundVeil.dispose(), [groundVeil])
  const horizonVeil = useMemo(
    () =>
      fadeBounds && polygonPoints && !groundReplaced
        ? horizonVeilMaterial(bgColor, polygonPoints, fadeBounds)
        : null,
    [bgColor, fadeBounds, polygonPoints, groundReplaced],
  )
  useEffect(() => () => horizonVeil?.dispose(), [horizonVeil])

  // Cache computed polygons to keep the selector stable across unrelated store updates.
  const slabPolygonsCache = useRef<[number, number][][]>([])
  const slabPolygons = useScene((state: S) => {
    const next = getRecessedSlabGroundHoles(state.nodes)

    const prev = slabPolygonsCache.current
    if (polygonsMatch(next, prev)) return prev
    slabPolygonsCache.current = next
    return next
  })

  // What the ground is cut open over: the recessed slabs, and the basement under the house. The
  // house covers that part of a basement, so the ground there is open whatever level is shown:
  // from outside nothing changes, and a stairwell, a floor opening or a walkthrough on the stair
  // meets the basement, not a sheet of ground across it. A basement reaching out under the garden
  // stays closed past the house (no pit in the garden) until its level is shown, and the hole of
  // the level shown does the rest as it does. The one case it closes: the level display has the
  // storeys away over a level below grade and the person keeps the ground Solid, nothing covers
  // it then and Solid asks for solid ground. Clipped to the lot, as a hole past its line breaks
  // the triangulation.
  const coverOpen = !(belowGrade && groundMode === 'solid')
  const holes = useMemo(() => {
    if (!coverOpen || buried.covered.length === 0 || !polygonPoints || polygonPoints.length < 3)
      return slabPolygons
    const inLot = intersection(union(buried.covered), polygonPoints as [number, number][])
    const covered = inLot.filter((piece) => piece.holes.length === 0).map((piece) => piece.outer)
    return covered.length > 0 ? [...slabPolygons, ...covered] : slabPolygons
  }, [coverOpen, buried.covered, polygonPoints, slabPolygons])

  const gradeRings = useMemo(
    () => buried.shown.map((outline) => gradeRingGeometry(outline, persistedField)),
    [buried.shown, persistedField],
  )
  useEffect(
    () => () => {
      for (const ring of gradeRings) ring.dispose()
    },
    [gradeRings],
  )
  const gradeRing = useMemo(gradeRingMaterial, [])
  useEffect(() => () => gradeRing.dispose(), [gradeRing])

  // Ground shape: site polygon with slab footprints punched as holes
  const groundShape = useMemo(() => {
    if (!polygonPoints || polygonPoints.length < 3) return null

    const pts = polygonPoints
    const shape = new Shape()
    shape.moveTo(pts[0]![0], -pts[0]![1])
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], -pts[i]![1])
    shape.closePath()

    addSlabHoles(shape, holes)

    return shape
  }, [polygonPoints, holes])

  // With terrain the lot is a block — its ground cut to the property line, its
  // skirt dropping to one flat base — and the disc lies just under that base, so
  // nothing of it caps the lot and nothing of the block stands proud of it from
  // the far side. The recessed slabs are still punched: a basement can go deeper.
  const horizonY = useMemo(
    () => (terrainGrid ? terrainBlockBase(terrainGrid) - 0.02 : HORIZON_PLANE_Y),
    [terrainGrid],
  )

  const horizonGeometry = useMemo(() => {
    if (!fadeBounds || groundReplaced) return null
    const radius = Math.max(fadeBounds.radius * 8, 400)
    const shape = new Shape()
    const segments = 64
    shape.moveTo(radius, 0)
    for (let index = 1; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2
      shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
    shape.closePath()
    addSlabHoles(shape, holes, fadeBounds.cx, fadeBounds.cz)
    return new ShapeGeometry(shape)
  }, [fadeBounds, holes, groundReplaced])
  useEffect(() => () => horizonGeometry?.dispose(), [horizonGeometry])
  useEffect(() => () => horizonMaterial?.dispose(), [horizonMaterial])

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

  // A site with drafted setbacks draws the PROPERTY LINE as the standard line —
  // dark, thick, a long dash and two dots — and the SETBACK lines in black
  // dashes, both ribbons lying on the draped ground (line-ribbon.ts). Any other
  // site keeps the plain amber boundary. Keyed on the same grid as the
  // boundary; a dab mid-stroke moves the thin ring only, the ribbons follow
  // on the commit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the grid, not the field — see above.
  const ribbons = useMemo(() => {
    const setbacks = node.setbacks
    if (!setbacks || !boundary || !polygonPoints || polygonPoints.length < 3) return null
    const field = useLiveTerrain.getState().fieldOf(node.id) ?? persistedField
    const property = buildPatternedRibbon(boundary.ring.positions, PROPERTY_LINE_PATTERN, 0.22)
    let envelopeGeometry: BufferGeometry | null = null
    const triangleGeometries: BufferGeometry[] = []
    const points = polygonPoints.map(([x, z]) => [x ?? 0, z ?? 0] as [number, number])
    // the live ring, measured the one way the site plan and the agents measure it
    const lot = { ...node, polygon: { type: 'polygon' as const, points } }
    const front = siteFrontEdge(lot)
    const streetEdges = node.streetEdges ?? []
    const sightTriangleM =
      typeof node.sightTriangleFt === 'number' && node.sightTriangleFt > 0
        ? node.sightTriangleFt * 0.3048
        : 0
    const envelope = siteSetbackEnvelope(lot)
    if (envelope.length >= 3) {
      const draped = buildDrapedPolyline({
        points: envelope,
        field,
        lift: Y_OFFSET + 0.01,
        closed: true,
      })
      envelopeGeometry = buildPatternedRibbon(draped.positions, SETBACK_LINE_PATTERN, 0.1)
    }
    // the corner sight triangles, dashed like the setbacks
    if (sightTriangleM > 0) {
      for (const [a, b] of streetCorners(points, [front, ...streetEdges])) {
        const tri = sightTriangle(points, a, b, sightTriangleM)
        if (!tri) continue
        const draped = buildDrapedPolyline({
          points: [tri.corner, tri.a, tri.b],
          field,
          lift: Y_OFFSET + 0.012,
          closed: true,
        })
        triangleGeometries.push(buildPatternedRibbon(draped.positions, SETBACK_LINE_PATTERN, 0.08))
      }
    }
    return { property, envelope: envelopeGeometry, triangles: triangleGeometries }
  }, [
    boundary,
    polygonPoints,
    node.setbacks,
    node.frontEdge,
    node.streetEdges,
    node.sightTriangleFt,
    node.northRotation,
    terrainKey,
    node.id,
  ])
  useEffect(
    () => () => {
      ribbons?.property.dispose()
      ribbons?.envelope?.dispose()
      for (const g of ribbons?.triangles ?? []) g.dispose()
    },
    [ribbons],
  )

  // Per-dab height rewrite, imperative for the same reason `TerrainRenderer`'s
  // upload is: a stroke pushes dozens of patches a second, and routing each through
  // a React render would rebuild the ring's buffers at pointer rate. The XZ of every
  // vertex is a function of the grid alone, so a dab only ever moves Y.
  //
  // A ref, not the memo value in a dependency, so the subscription outlives a
  // polygon edit without resubscribing.
  const boundaryRef = useRef<{ geometry: BufferGeometry; ring: DrapedPolyline } | null>(null)
  boundaryRef.current = boundary
  const ribbonsRef = useRef<Ribbons | null>(null)
  ribbonsRef.current = ribbons
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
          redrapeRibbons(ribbonsRef.current, field)
        }
        return
      }
      if (!stroke.lastPatch || stroke.lastPatch === lastPatch) return
      lastPatch = stroke.lastPatch
      updateDrapedHeights(current.ring, stroke.field, Y_OFFSET)
      markPositionsDirty(current.geometry)
      // the property and setback ribbons follow the same dab
      redrapeRibbons(ribbonsRef.current, stroke.field)
    })
  }, [node.id, node.terrain])

  // The CONTOUR LINES on the ground (toggleable in 3D, drawn as faint,
  // translucent near-black lines): the site's surveyed lines (the dossier's 3DEP set) at the
  // site-plan interval, else the heightfield's own contours; each draped
  // on the ground and merged into one line-segments buffer. Rebuilt on the
  // terrain COMMIT (the persisted field), not per dab.
  const contourGeometry = useMemo(() => {
    if (!node.contours3d) return null
    const intervalIn = node.contourIntervalIn ?? 12
    if (!(intervalIn > 0)) return null
    const field = persistedField
    const lot = (polygonPoints ?? []) as [number, number][]
    const stepFt = intervalIn / 12
    const surveyed = node.terrainContours
    const multiple = (a: number, b: number) => Math.abs(a / b - Math.round(a / b)) < 1e-9
    let lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = []
    if (surveyed && surveyed.lines.length > 0 && multiple(stepFt, surveyed.intervalFt)) {
      lines = surveyed.lines.filter((l) => multiple(l.elevationFt, stepFt)).map((l) => l.points)
    } else if (field) {
      lines = terrainContours(field, intervalIn * 0.0254, lot).map((c) => c.points)
    }
    const chunks: Float32Array[] = []
    let total = 0
    for (const points of lines) {
      if (points.length < 2) continue
      const draped = buildDrapedPolyline({ points, field, lift: Y_OFFSET + 0.005, closed: false })
      const n = draped.positions.length / 3
      if (n < 2) continue
      const seg = new Float32Array((n - 1) * 6)
      for (let i = 0; i < n - 1; i++) {
        seg[i * 6] = draped.positions[i * 3] ?? 0
        seg[i * 6 + 1] = draped.positions[i * 3 + 1] ?? 0
        seg[i * 6 + 2] = draped.positions[i * 3 + 2] ?? 0
        seg[i * 6 + 3] = draped.positions[i * 3 + 3] ?? 0
        seg[i * 6 + 4] = draped.positions[i * 3 + 4] ?? 0
        seg[i * 6 + 5] = draped.positions[i * 3 + 5] ?? 0
      }
      chunks.push(seg)
      total += seg.length
    }
    if (total === 0) return null
    const merged = new Float32Array(total)
    let at = 0
    for (const c of chunks) {
      merged.set(c, at)
      at += c.length
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(merged, 3))
    geometry.computeBoundingSphere()
    return geometry
  }, [node.contours3d, node.contourIntervalIn, node.terrainContours, persistedField, polygonPoints])
  useEffect(() => () => contourGeometry?.dispose(), [contourGeometry])

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

  // The Site is the one kind whose `visible` flag stops at itself: hiding it
  // drops the parcel's own presentation — ground fill, sculpted ground, lot
  // line — while everything standing on the site keeps its own flag (the
  // exporter and the 2D plan draw the same line). The horizon disc is a world
  // backdrop rather than part of the parcel, so `visible` does not hide it.
  // `showGround` hides both ground and horizon when authored geometry supplies them, unless a level
  // below grade is shown: the level display hides that geometry then, and the ground stands in.
  const showSiteSurfaces = node.visible !== false
  const showGround = siteGroundShown(node, { belowGrade })

  if (!(node && lineGeometry)) {
    return null
  }

  return (
    <group ref={ref} {...handlers}>
      <GroundWindowSystem />
      <GenericFoundation />
      <GroundHole
        drawnFloorY={buried.drawnFloorY}
        floorY={buried.floorY}
        footprints={buried.shown}
        present={hasBasement}
        topAt={groundTopAt}
        topsoil={bgColor}
        topY={GROUND_FILL_POSITION[1]}
      />
      {/* Render children (buildings and items) */}
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId as AnyNodeId} />
      ))}

      {/* Sculpted ground, when the site has terrain */}
      {showSiteSurfaces && showGround && showTerrain && (
        <TerrainRenderer
          holes={holes}
          material={groundMaterial}
          polygon={polygonPoints}
          site={node}
          veil={groundVeil}
        />
      )}

      {/* Ground fill: site polygon with slab holes, occludes below-grade geometry */}
      {showSiteSurfaces && showGround && groundGeometry && !showTerrain && (
        <>
          <mesh
            geometry={groundGeometry}
            material={groundMaterial}
            position={GROUND_FILL_POSITION}
            receiveShadow
            rotation={FLAT_ON_THE_GROUND}
            userData={{ [SITE_GROUND]: 'solid' }}
          />
          <GroundVeil
            geometry={groundGeometry}
            material={groundVeil}
            position={GROUND_FILL_POSITION}
            rotation={FLAT_ON_THE_GROUND}
          />
        </>
      )}

      {/* Infinite-ground presentation disc fading into the sky at the horizon */}
      {showGround && !immersiveXR && horizonGeometry && horizonMaterial && fadeBounds && (
        <mesh
          geometry={horizonGeometry}
          material={horizonMaterial}
          position={[fadeBounds.cx, horizonY, fadeBounds.cz]}
          raycast={noopRaycast}
          receiveShadow
          rotation={FLAT_ON_THE_GROUND}
          userData={{ pascalExport: 'strip', [SITE_GROUND]: 'solid' }}
        />
      )}
      {showGround && !immersiveXR && horizonGeometry && horizonVeil && fadeBounds && (
        <GroundVeil
          geometry={horizonGeometry}
          material={horizonVeil}
          position={[fadeBounds.cx, horizonY, fadeBounds.cz]}
          rotation={FLAT_ON_THE_GROUND}
        />
      )}

      {showSiteSurfaces &&
        gradeRings.map((geometry, index) => (
          <GroundVeil geometry={geometry} key={index} material={gradeRing} shows="veiled" />
        ))}

      {showSiteSurfaces && ribbons && (
        <>
          {/* The property line: dark, thick, long dash + two dots, on the ground */}
          <mesh
            frustumCulled={false}
            geometry={ribbons.property}
            raycast={noopRaycast}
            renderOrder={9}
          >
            <meshBasicMaterial
              color="#1c1917"
              depthWrite={false}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
          {/* The setback envelope: black dashes */}
          {ribbons.envelope && (
            <mesh
              frustumCulled={false}
              geometry={ribbons.envelope}
              raycast={noopRaycast}
              renderOrder={9}
            >
              <meshBasicMaterial
                color="#000000"
                depthWrite={false}
                opacity={0.85}
                side={DoubleSide}
                toneMapped={false}
                transparent
              />
            </mesh>
          )}
          {/* The corner sight triangles */}
          {ribbons.triangles.map((g, i) => (
            <mesh frustumCulled={false} geometry={g} key={i} raycast={noopRaycast} renderOrder={9}>
              <meshBasicMaterial
                color="#000000"
                depthWrite={false}
                opacity={0.85}
                side={DoubleSide}
                toneMapped={false}
                transparent
              />
            </mesh>
          ))}
          {/* The thin ring the sculpt tool moves live */}
          {/* @ts-expect-error */}
          <line frustumCulled={false} geometry={lineGeometry} renderOrder={8}>
            <lineBasicMaterial color="#1c1917" opacity={0.5} transparent />
          </line>
        </>
      )}

      {/* Simple boundary line */}
      {showSiteSurfaces && !ribbons && (
        // @ts-expect-error
        <line frustumCulled={false} geometry={lineGeometry} renderOrder={9}>
          <lineBasicMaterial color="#f59e0b" linewidth={2} opacity={0.6} transparent />
        </line>
      )}

      {/* The contour lines: thin, translucent, barely black, on the ground */}
      {showSiteSurfaces && contourGeometry && (
        <lineSegments
          frustumCulled={false}
          geometry={contourGeometry}
          raycast={noopRaycast}
          renderOrder={8}
        >
          <lineBasicMaterial
            color="#000000"
            depthWrite={false}
            opacity={0.22}
            toneMapped={false}
            transparent
          />
        </lineSegments>
      )}
    </group>
  )
}

export default SiteRenderer
