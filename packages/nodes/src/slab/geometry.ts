import {
  type AnyNode,
  type AnyNodeId,
  area,
  type BuildingNode,
  computePlateSurfacePartition,
  cutterContextNodes,
  FenceNode,
  FOUNDATION_SLOT_DEFAULT,
  floorBuildUpMatches,
  floorBuildUpOf,
  floorLayerDepths,
  type GeometryContext,
  getLevelElevations,
  getMaterialPresetByRef,
  getRenderableSlabPolygon,
  gradedTerrainFieldOf,
  intersection,
  isBuildingFoundationOn,
  isDeckSlab,
  isFloorPlate,
  type LevelNode,
  levelBaseElevationAt,
  liftedManualSlab,
  type MaterialSchema,
  OUTDOOR_ROOM_DEFAULTS,
  type PlateSurfacePartition,
  type PlateTopCell,
  parseFloorStepRole,
  plateFinishKey,
  plateLevelContext,
  resolveFloorStepFinish,
  type SiteNode,
  SLAB_SIDE_SLOT_DEFAULT,
  SLAB_TOP_SLOT_DEFAULT,
  type SlabNode,
  type SlabSlotId,
  slabPolygonContextFromGeometry,
  surfaceHeightAt,
  terrainFieldOf,
  useScene,
  withHostedCutterHoles,
} from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  buildTerrainPerimeterFillGeometry,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  generateSlabGeometry,
  type RenderShading,
  registerMaterialCacheCleanup,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  useViewer,
} from '@pascal-app/viewer'
import { type BufferGeometry, FrontSide, Group, type Material, Mesh, type Texture } from 'three'
import { generateFenceSlotGeometries } from '../fence/geometry-parts'
import { creaseCrossings } from '../site/terrain-drape'
import { buildDeckGeometry } from './deck-geometry'
import {
  clipPlateTerrainFill,
  hollowSlabFaces,
  type SlabCavity,
  splitPlateFaces,
  splitSlabFacesByFacing,
} from './surface-split'

/**
 * Stage B builder for slab. Reuses `generateSlabGeometry` (pure
 * triangulation + hole CSG from viewer) and the same material cache
 * pattern the legacy slab renderer used.
 *
 * Materials follow the unified slot model: the single `surface` slot resolves
 * `node.slots.surface` (a shared scene material or `library:` finish) → the
 * legacy inline `node.material` / `materialPreset` (pre-slot-model scenes) →
 * the declared slot default colour. Textures-off collapses to the themed
 * `floor` role — the guaranteed monochrome escape hatch.
 */
type SlabMaterial = Material & {
  alphaMap?: Texture | null
  depthWrite: boolean
  opacity: number
  transparent: boolean
}

const slabMaterialCache = new Map<string, Material>()
registerMaterialCacheCleanup(() => {
  const previous = [...slabMaterialCache.values()]
  slabMaterialCache.clear()
  const state = useScene.getState()
  for (const node of Object.values(state.nodes)) {
    if (node.type === 'slab') state.markDirty(node.id as AnyNodeId)
  }
  return () => {
    for (const material of previous) material.dispose()
  }
})

function getSlabSlotMaterial(
  node: SlabNode,
  slotId: SlabSlotId,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
  sceneMaterials: GeometryContext['materials'],
): Material {
  // Textures-off mode takes the themed 'floor' role colour for every face — the
  // guaranteed escape hatch, independent of any slot override. FrontSide —
  // DoubleSide on the role material's NodeMaterial poisons the MRT scene pass
  // (see `materials.ts` line 77 / glazing fix 9400f1c5). Slab side faces still
  // render correctly because `generateSlabGeometry` emits outward-facing normals.
  if (!textures) {
    return createSurfaceRoleMaterial('floor', colorPreset, FrontSide, sceneTheme)
  }

  if (slotId === 'foundation') {
    const finish = node.foundation?.material ?? FOUNDATION_SLOT_DEFAULT
    return typeof finish === 'string'
      ? (resolveMaterialRef(finish, sceneMaterials, shading) ??
          resolveSlotDefaultMaterial(finish, shading, 0.8))
      : createMaterial(finish, shading)
  }

  // Unified slot override — shared scene material or catalog `library:` finish.
  // `side` is the pre-split key: it answers for any face when it is the only
  // one set, and each split key answers for its own face when it is.
  const slotRef =
    slotId === 'side'
      ? (node.slots?.side ?? node.slots?.edge ?? node.slots?.riser ?? node.slots?.underside)
      : (node.slots?.[slotId] ?? (slotId === 'surface' ? undefined : node.slots?.side))
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading)
    if (resolved) return resolved
  }

  // Legacy inline material / preset (pre-slot-model scenes) applied to the whole
  // slab — map it onto the top face only; sides take their own default.
  if (slotId === 'surface' && (node.materialPreset || node.material)) {
    return getLegacySlabMaterial(node, shading)
  }

  // Declared slot default — a catalog `library:` finish or a flat colour.
  const slotDefault = slotId === 'surface' ? SLAB_TOP_SLOT_DEFAULT : SLAB_SIDE_SLOT_DEFAULT
  return resolveSlotDefaultMaterial(slotDefault, shading, 0.8)
}

function getLegacySlabMaterial(node: SlabNode, shading: RenderShading): Material {
  // Cached by `{material, materialPreset}` signature so slabs sharing settings
  // share the GPU resource; cached entry mutation (preset apply) is preserved
  // so async texture loads still update the rendered material after re-mount.
  const cacheKey = JSON.stringify({
    shading,
    material: node.material ?? null,
    materialPreset: node.materialPreset ?? null,
  })
  const cached = slabMaterialCache.get(cacheKey)
  if (cached) return cached

  const preset = getMaterialPresetByRef(node.materialPreset)
  const material = preset
    ? createDefaultMaterial('#ffffff', 0.5, shading)
    : node.material
      ? createMaterial(node.material, shading).clone()
      : createDefaultMaterial('#e5e5e5', 0.8, shading)

  if (preset) {
    applyMaterialPresetToMaterials(material, preset)
  }

  const slabMaterial = material as SlabMaterial
  slabMaterial.transparent = false
  slabMaterial.opacity = 1
  slabMaterial.alphaMap = null
  // FrontSide — user-supplied materials may be NodeMaterials, and DoubleSide
  // on any NodeMaterial in the MRT scene pass poisons the render context
  // (see `materials.ts` line 77 / glazing fix 9400f1c5).
  slabMaterial.side = FrontSide
  slabMaterial.depthWrite = true
  slabMaterial.needsUpdate = true

  material.userData.__pascalCachedMaterial = true
  slabMaterialCache.set(cacheKey, material)
  return material
}

function designedFoundationUnder(ctx: GeometryContext | undefined): boolean {
  const level = ctx?.parent
  if (level?.type !== 'level' || !level.parentId) return false
  return isBuildingFoundationOn(ctx?.resolve<BuildingNode>(level.parentId as AnyNodeId))
}

/**
 * The plank flooring decks were given before they had boards (the old deck room default, and the
 * porch generator's decks): laid on each board it reads as flooring, so boards still carrying it
 * draw the deck default's plain grain.
 */
const LEGACY_DECK_FINISH = 'library:wood-floorplank1'

/**
 * A porch or patio slab outside the house (a plate the structure kernel tags `metadata.floor:
 * 'porch-slab'`): it stands down in the ground, its edge drawn down to the ground the house's
 * foundation grades round it (`foundationGradingPads`), never floating over it.
 */
function isOutdoorGroundSlab(node: SlabNode): boolean {
  return (
    isFloorPlate(node) &&
    node.plateRole !== 'base' &&
    node.support !== 'open' &&
    (node.metadata as Record<string, unknown> | undefined)?.floor === 'porch-slab'
  )
}

/**
 * The ground a skirt runs down to: the site's terrain, or (`graded`) the terrain as drawn, graded to
 * the buildings' foundations, for a slab that stands in that graded ground.
 */
function terrainFillContext(ctx: GeometryContext | undefined, foundation: boolean, graded = false) {
  if (!ctx) return null
  const level = ctx.parent
  if (level?.type !== 'level' || !level.parentId) return null
  const building = ctx.resolve<BuildingNode>(level.parentId as AnyNodeId)
  if (building?.type !== 'building' || !building.parentId) return null
  const site = ctx.resolve<SiteNode>(building.parentId as AnyNodeId)
  if (site?.type !== 'site') return null
  const field = graded
    ? gradedTerrainFieldOf(useScene.getState().nodes, site)
    : terrainFieldOf(site)

  const nodes: Record<string, AnyNode> = {
    [site.id]: site,
    [building.id]: building,
    [level.id]: level as LevelNode,
  }
  for (const childId of building.children) {
    const child = ctx.resolve<AnyNode>(childId as AnyNodeId)
    if (child) nodes[child.id] = child
  }
  const elevation = getLevelElevations(nodes).get(level.id)
  if (!elevation) return null
  const baseWorldY = (building.position?.[1] ?? 0) + elevation.baseY
  if (Math.abs(baseWorldY) >= 1e-4 && !(foundation && level.level === 0)) return null

  return {
    baseWorldY,
    building,
    field,
  }
}

function buildSlabTerrainFillGeometry(
  node: SlabNode,
  polygon: Array<[number, number]>,
  ctx: GeometryContext | undefined,
  partition: PlateSurfacePartition | null,
  outdoor = false,
): BufferGeometry | null {
  const terrain = terrainFillContext(ctx, node.plateRole === 'base' || outdoor, outdoor)
  if (!terrain || polygon.length < 3) return null

  let area2 = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const [ax, az] = polygon[index]!
    const [bx, bz] = polygon[(index + 1) % polygon.length]!
    area2 += ax * bz - bx * az
  }
  const contour = area2 < 0 ? [...polygon].reverse() : polygon
  const angle = terrain.building.rotation?.[1] ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [offsetX, , offsetZ] = terrain.building.position ?? [0, 0, 0]
  const toSite = (x: number, z: number): [number, number] => [
    cos * x + sin * z + offsetX,
    -sin * x + cos * z + offsetZ,
  ]

  const points: Array<[number, number]> = []
  for (let index = 0; index < contour.length; index += 1) {
    const [ax, az] = contour[index]!
    const [bx, bz] = contour[(index + 1) % contour.length]!
    const [siteAx, siteAz] = toSite(ax, az)
    const [siteBx, siteBz] = toSite(bx, bz)
    points.push([ax, az])
    if (terrain.field) {
      for (const t of creaseCrossings(terrain.field, siteAx, siteAz, siteBx, siteBz)) {
        points.push([ax + (bx - ax) * t, az + (bz - az) * t])
      }
    }
  }

  const top = node.elevation - node.thickness
  const localPoints = points.map(([x, z]) => ({ x, z }))
  const bottomY = points.map(([x, z]) => {
    const [siteX, siteZ] = toSite(x, z)
    const ground = terrain.field ? surfaceHeightAt(terrain.field, siteX, siteZ) : 0
    return Math.min(top, ground - terrain.baseWorldY)
  })
  const geometry = buildTerrainPerimeterFillGeometry(localPoints, bottomY, top, 1e-4)
  if (!geometry || !partition?.sides.some((side) => side.dropTo !== undefined)) return geometry
  const clipped = clipPlateTerrainFill(geometry, partition)
  geometry.dispose()
  return clipped
}

/**
 * Material for one partition cell of a plate top: the room's finish when the
 * cell has one, the plate's own `surface` slot when it does not. Identical
 * finishes resolve to the same cached instance, so two rooms painted alike stay
 * in one batch bucket.
 */
function getPlateCellMaterial(
  node: SlabNode,
  cell: PlateTopCell,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
  sceneMaterials: GeometryContext['materials'],
): Material {
  if (!textures) return createSurfaceRoleMaterial('floor', colorPreset, FrontSide, sceneTheme)
  const finish = cell.finish
  if (typeof finish === 'string') {
    const resolved = resolveMaterialRef(finish, sceneMaterials, shading)
    if (resolved) return resolved
  } else if (finish) {
    return createMaterial(finish as MaterialSchema, shading)
  }
  return getSlabSlotMaterial(
    node,
    'surface',
    shading,
    textures,
    colorPreset,
    sceneTheme,
    sceneMaterials,
  )
}

/**
 * A floor plate's partition, or `null` when this slab is not a plate (or the
 * level neighbourhood is unavailable, as in a bare geometry test). Memoised in
 * core on the topology + finish signature; never recomputed per frame.
 */
function platePartitionOf(
  node: SlabNode,
  ctx: GeometryContext | undefined,
  platform: boolean,
): PlateSurfacePartition | null {
  if (!isFloorPlate(node) || !ctx) return null
  const context = plateLevelContext(ctx.parent, ctx.resolve)
  return computePlateSurfacePartition(node, { ...context, platform })
}

/**
 * The joist band of a floor framed inside its slab, as Bones frames it: a slab whose thickness is
 * its layers' (`floorBuildUpMatches`), neither a pool, a platform nor a sunken plate, on a storey
 * with one under it (a lowest storey's floor stands on the ground or its foundation, with no joists
 * in it). Null for every other slab, and for a band with no depth.
 */
export function slabFramingCavity(
  node: SlabNode,
  ctx: Pick<GeometryContext, 'parent' | 'resolve'> | undefined,
): SlabCavity | null {
  if (node.recessed || (node.plateRole !== undefined && node.plateRole !== 'base')) return null
  if (!floorBuildUpMatches(node)) return null
  const level = ctx?.parent
  if (!ctx || level?.type !== 'level' || !level.parentId) return null
  const building = ctx.resolve<AnyNode>(level.parentId as AnyNodeId)
  if (building?.type !== 'building') return null
  const overStorey = building.children.some((id) => {
    const other = ctx.resolve<AnyNode>(id as AnyNodeId)
    return other?.type === 'level' && other.level < level.level
  })
  if (!overStorey) return null
  const { flooring, sheathing, ceiling } = floorLayerDepths(floorBuildUpOf(node))
  const elevation = node.elevation ?? 0.05
  const top = elevation - flooring - sheathing
  const bottom = elevation - node.thickness + ceiling
  return top - bottom > 1e-4 ? { top, bottom, ceiling: ceiling > 1e-6 } : null
}

/**
 * `framingShown`: the viewer's "Framing" (`useViewer.framingShown`, read when the generic geometry
 * system builds; the slab system rebuilds the framed floors when it flips). A floor framed inside
 * its slab (`slabFramingCavity`) then opens its joist band.
 */
export function buildSlabGeometry(
  node: SlabNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
  framingShown = useViewer.getState().framingShown,
): Group {
  if (ctx) node = withHostedCutterHoles(node, cutterContextNodes(node, ctx))
  if (ctx && !node.plateRole && !node.autoFromWalls)
    node = liftedManualSlab(plateLevelContext(ctx.parent, ctx.resolve).nodes ?? {}, node)
  const group = new Group()
  const polygonContext = slabPolygonContextFromGeometry(ctx)
  const polygon = getRenderableSlabPolygon(node, polygonContext)
  const baseNodes: Record<string, AnyNode> = {}
  if (ctx?.parent && !ctx.levelBaseAt && isFloorPlate(node)) {
    let ancestor: AnyNode | undefined = ctx.parent
    while (ancestor && !baseNodes[ancestor.id]) {
      baseNodes[ancestor.id] = ancestor
      if ('children' in ancestor)
        for (const id of ancestor.children) {
          const child = ctx.resolve<AnyNode>(id as AnyNodeId)
          if (child?.type === 'level') baseNodes[id] = child
        }
      ancestor = ancestor.parentId
        ? ctx.resolve<AnyNode>(ancestor.parentId as AnyNodeId)
        : undefined
    }
  }
  const levelBaseAt =
    ctx?.levelBaseAt ??
    ((x: number, z: number) =>
      node.parentId ? levelBaseElevationAt(baseNodes, node.parentId, x, z) : 0)
  const platform =
    isFloorPlate(node) &&
    node.support !== 'open' &&
    !node.plateRole &&
    !node.recessed &&
    node.elevation - node.thickness > 1e-4 &&
    [polygon, ...(node.holes ?? [])].some((ring) =>
      ring.some(([x, z], i) => {
        const [endX, endZ] = ring[(i + 1) % ring.length]!
        const count = Math.max(1, Math.ceil(Math.hypot(endX - x, endZ - z) / 0.25))
        for (let j = 0; j < count; j++)
          if (
            node.elevation - node.thickness >
            levelBaseAt(x + ((endX - x) * j) / count, z + ((endZ - z) * j) / count) + 1e-4
          )
            return true
        return false
      }),
    )
  // A deck is its boards on its frame (`buildDeckGeometry`), never a solid slab.
  if (isDeckSlab(node))
    return buildDeckGeometry(node, ctx, {
      polygon,
      partition: platePartitionOf(node, ctx, node.plateRole === 'platform'),
      boardMaterial: (cell) =>
        (cell ? cell.finish : (node.slots?.surface ?? node.materialPreset)) === LEGACY_DECK_FINISH
          ? getPlateCellMaterial(
              node,
              {
                role: cell?.role ?? 'surface',
                finish: OUTDOOR_ROOM_DEFAULTS.deck.finish,
                materialKey: plateFinishKey(OUTDOOR_ROOM_DEFAULTS.deck.finish),
                polygons: cell?.polygons ?? [],
              },
              shading,
              textures,
              colorPreset,
              sceneTheme,
              ctx?.materials,
            )
          : cell
            ? getPlateCellMaterial(
                node,
                cell,
                shading,
                textures,
                colorPreset,
                sceneTheme,
                ctx?.materials,
              )
            : getSlabSlotMaterial(
                node,
                'surface',
                shading,
                textures,
                colorPreset,
                sceneTheme,
                ctx?.materials,
              ),
      look: { shading, textures, colorPreset, sceneTheme },
    })
  const solid = generateSlabGeometry(node, polygonContext, platform ? levelBaseAt : undefined)
  // With the frame shown, a floor framed inside its slab opens its joist band.
  const cavity = framingShown && !platform ? slabFramingCavity(node, ctx) : null
  const hollow = cavity ? hollowSlabFaces(solid, cavity) : null
  const merged = hollow?.body ?? solid
  const elevation = node.elevation ?? 0.05
  const partition = platePartitionOf(node, ctx, platform || node.plateRole === 'platform')

  const addMesh = (geometry: BufferGeometry, slotId: string, material: Material) => {
    // A slot with no triangles (collapsed or fully holed polygon) gets no mesh,
    // so the build settles instead of emitting empty buffers.
    if (geometry.getAttribute('position').count === 0) {
      geometry.dispose()
      return
    }
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    const step = parseFloorStepRole(slotId)
    const edgeOwner = /^edge:(.+)$/.exec(slotId)?.[1]
    mesh.userData.slotId = step ? 'riser' : edgeOwner ? 'edge' : slotId
    mesh.userData.paintRole = slotId
    if (step || edgeOwner) mesh.userData.ownerZoneId = step?.zoneId ?? edgeOwner
    // Solid slabs bake [elevation − thickness, elevation] into the geometry;
    // recessed shells are authored from floor to rim and translated so the
    // floor sits at `elevation`.
    if (node.recessed) mesh.position.y = elevation
    group.add(mesh)
  }

  if (partition) {
    // A plate draws one mesh per partition cell and one per exposure role. Each
    // mesh keeps a single material, so node batching still buckets them by
    // material uuid and repeated finishes share one bucket.
    const cellByRole = new Map(partition.cells.map((cell) => [cell.role, cell]))
    const levelZones = ctx ? plateLevelContext(ctx.parent, ctx.resolve).zones : []
    for (const { role, geometry } of splitPlateFaces(merged, partition, node)) {
      const step = parseFloorStepRole(role)
      const zoneId = step?.zoneId ?? /^edge:(.+)$/.exec(role)?.[1]
      const zone = zoneId ? ctx?.resolve<AnyNode>(zoneId as AnyNodeId) : undefined
      const base = ctx
        ? plateLevelContext(ctx.parent, ctx.resolve)
            .slabs.filter((slab) => slab.plateRole === 'base')
            .sort(
              (a, b) =>
                area(
                  intersection(
                    { outer: b.polygon, holes: b.holes },
                    { outer: node.polygon, holes: node.holes },
                  ),
                ) -
                  area(
                    intersection(
                      { outer: a.polygon, holes: a.holes },
                      { outer: node.polygon, holes: node.holes },
                    ),
                  ) || a.id.localeCompare(b.id),
            )[0]
        : undefined
      const finish =
        zone?.type === 'zone'
          ? step
            ? resolveFloorStepFinish(zone, step.key, step.step, levelZones)
            : (zone.floorEdgeFinish ?? base?.slots?.edge)
          : undefined
      const cell =
        cellByRole.get(role) ??
        (zone?.type === 'zone' && (step || finish !== undefined)
          ? {
              role,
              finish: finish ?? SLAB_TOP_SLOT_DEFAULT,
              materialKey: plateFinishKey(finish ?? SLAB_TOP_SLOT_DEFAULT),
              polygons: [],
            }
          : undefined)
      const material = cell
        ? getPlateCellMaterial(
            node,
            cell,
            shading,
            textures,
            colorPreset,
            sceneTheme,
            ctx?.materials,
          )
        : getSlabSlotMaterial(
            node,
            role as SlabSlotId,
            shading,
            textures,
            colorPreset,
            sceneTheme,
            ctx?.materials,
          )
      addMesh(geometry, role, material)
    }
  } else {
    const { top, side } = splitSlabFacesByFacing(merged)
    // One mesh per slot, each tagged with its slot id so the unified slot paint
    // resolves the hit (`resolveRole` reads `userData.slotId`) and previews it.
    for (const [slotId, geometry] of [
      ['surface', top],
      ['side', side],
    ] as const) {
      addMesh(
        geometry,
        slotId,
        getSlabSlotMaterial(
          node,
          slotId,
          shading,
          textures,
          colorPreset,
          sceneTheme,
          ctx?.materials,
        ),
      )
    }
  }
  if (hollow) {
    // the open band's faces: the subfloor's underside, the ceiling's top, the rim turned in
    const slotId: SlabSlotId = partition ? 'underside' : 'side'
    addMesh(
      hollow.cavity,
      slotId,
      getSlabSlotMaterial(node, slotId, shading, textures, colorPreset, sceneTheme, ctx?.materials),
    )
  }
  merged.dispose()
  if (merged !== solid) solid.dispose()

  // A building standing on its designed foundation draws that under the plate, not this skirt.
  const foundation =
    node.plateRole === 'base' && node.foundation?.type === 'solid' && !designedFoundationUnder(ctx)
  // A porch or patio slab runs down into the ground beside the house, whatever stands under it.
  const outdoor = isOutdoorGroundSlab(node)
  if (
    (foundation || outdoor || (!node.plateRole && node.fillToTerrain)) &&
    !node.recessed &&
    !platform &&
    group.children.length > 0
  ) {
    const terrainFill = buildSlabTerrainFillGeometry(
      node,
      getRenderableSlabPolygon(node, polygonContext),
      ctx,
      partition,
      outdoor,
    )
    if (terrainFill) {
      // The skirt hangs below the plate perimeter and always faces out: the slab's concrete.
      const slotId: SlabSlotId = foundation || outdoor ? 'foundation' : partition ? 'edge' : 'side'
      addMesh(
        terrainFill,
        slotId,
        getSlabSlotMaterial(
          node,
          slotId,
          shading,
          textures,
          colorPreset,
          sceneTheme,
          ctx?.materials,
        ),
      )
    }
  }
  for (const [index, segment] of (node.railing ?? []).entries()) {
    const geometries = generateFenceSlotGeometries(
      FenceNode.parse({
        id: `fence_${index}`,
        ...segment,
        height: 1.1,
        style: 'rail',
        baseStyle: 'floating',
        baseHeight: 0,
        postCap: 'none',
      }),
    )
    for (const geometry of Object.values(geometries)) {
      if (!geometry.getAttribute('position')) {
        geometry.dispose()
        continue
      }
      geometry.translate(0, elevation, 0)
      addMesh(
        geometry,
        'edge',
        getSlabSlotMaterial(
          node,
          'edge',
          shading,
          textures,
          colorPreset,
          sceneTheme,
          ctx?.materials,
        ),
      )
    }
  }
  return group
}
