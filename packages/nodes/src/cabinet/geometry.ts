import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode,
  type CabinetNode,
  type GeometryContext,
  getMaterialPresetByRef,
  type MaterialSchema,
} from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  applyWorldScaleBoxUVs,
  Brush,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  csgEvaluator,
  csgGeometry,
  glassMaterial as defaultGlassMaterial,
  prepareBrushForCSG,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  SUBTRACTION,
} from '@pascal-app/viewer'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import {
  COOKTOP_FLAME_COUNT,
  cooktopFlameSeed,
  createCooktopFlameGeometry,
  updateCooktopFlameTube,
} from './cooktop-flame'
import { type CabinetSlotId, cabinetSlots } from './slots'
import {
  type CabinetCompartment,
  type CabinetCooktopCompartmentType,
  type CabinetFridgeCompartmentType,
  type CabinetHoodCompartmentType,
  type CooktopLayout,
  compartmentCooktopActiveBurners,
  compartmentCooktopBurnersOn,
  compartmentCooktopKnobProgress,
  compartmentCooktopLayout,
  compartmentCooktopShowGrate,
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentPullOutPantryRackStyle,
  compartmentShelfCount,
  DEFAULT_CEILING_HEIGHT,
  HOOD_CANOPY_DEPTH,
  HOOD_CURVED_BODY_HEIGHT,
  HOOD_DUCT_SIZE,
  isHoodCompartmentType,
  normalizeCabinetStack,
  type PullOutPantryRackStyle,
} from './stack'

const DRAWER_MIN_OPEN = 0.32
const HANDLE_EDGE_INSET = 0.045
const HANDLE_TOP_INSET = 0.05
const HANDLE_SLOT_LONG = 0.09
const HANDLE_SLOT_SHORT = 0.016
const HANDLE_CUTOUT_WIDTH = 0.13
const HANDLE_CUTOUT_DIP = 0.014
const ADJACENT_RUN_EPSILON = 1e-4
const ADJACENT_RUN_Z_TOLERANCE = 0.03
const holeDummyMaterial = new MeshBasicMaterial()
const CABINET_SLOT_DEFAULTS = Object.fromEntries(
  cabinetSlots().map((slot) => [slot.slotId, slot.default]),
) as Record<CabinetSlotId, string>

function prepareCsgGeometry(geometry: BufferGeometry) {
  const indexCount = geometry.getIndex()?.count ?? 0
  geometry.clearGroups()
  if (indexCount > 0) geometry.addGroup(0, indexCount, 0)
}

function subtractFrontCutters(
  base: BufferGeometry,
  cutters: BufferGeometry[],
  label: string,
): BufferGeometry {
  prepareCsgGeometry(base)
  for (const cutter of cutters) prepareCsgGeometry(cutter)

  const baseBrush = new Brush(base, holeDummyMaterial as unknown as MeshStandardMaterial)
  baseBrush.updateMatrixWorld()
  prepareBrushForCSG(baseBrush)

  const cutterBrushes = cutters.map((geometry) => {
    const brush = new Brush(geometry, holeDummyMaterial as unknown as MeshStandardMaterial)
    brush.updateMatrixWorld()
    prepareBrushForCSG(brush)
    return brush
  })

  let current: Brush = baseBrush
  const intermediates: Brush[] = []
  try {
    for (const cutter of cutterBrushes) {
      const next = csgEvaluator.evaluate(current, cutter, SUBTRACTION) as Brush
      prepareBrushForCSG(next)
      if (current !== baseBrush) intermediates.push(current)
      current = next
    }

    const result = csgGeometry(current).clone()
    prepareCsgGeometry(result)
    result.computeVertexNormals()

    base.dispose()
    for (const cutter of cutters) cutter.dispose()
    for (const brush of intermediates) brush.geometry.dispose()
    if (current !== baseBrush) current.geometry.dispose()
    return result
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[cabinet] ${label} CSG failed:`, error)
    for (const cutter of cutters) cutter.dispose()
    for (const brush of intermediates) brush.geometry.dispose()
    if (current !== baseBrush) current.geometry.dispose()
    return base
  }
}

function buildCutoutFrontGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null,
): BufferGeometry {
  const cutoutWidth = Math.min(
    drawer ? HANDLE_CUTOUT_WIDTH : 0.11,
    Math.max(0.045, width * (drawer ? 0.32 : 0.24)),
  )
  const dip = Math.min(HANDLE_CUTOUT_DIP, Math.max(0.007, height * 0.14))
  const frontShape = new Shape()
  const halfWidth = width / 2
  const halfHeight = height / 2
  const half = cutoutWidth / 2
  const flatHalf = half * 0.18
  if (drawer || hinge == null) {
    const shoulderY = halfHeight - dip * 0.08
    const bottomY = halfHeight - dip

    frontShape.moveTo(-halfWidth, -halfHeight)
    frontShape.lineTo(halfWidth, -halfHeight)
    frontShape.lineTo(halfWidth, halfHeight)
    frontShape.lineTo(half, halfHeight)
    frontShape.bezierCurveTo(half * 0.76, shoulderY, half * 0.52, bottomY, flatHalf, bottomY)
    frontShape.lineTo(-flatHalf, bottomY)
    frontShape.bezierCurveTo(-half * 0.52, bottomY, -half * 0.76, shoulderY, -half, halfHeight)
    frontShape.lineTo(-halfWidth, halfHeight)
    frontShape.lineTo(-halfWidth, -halfHeight)
  } else {
    const side = hinge === 'left' ? 1 : -1
    const edgeX = side * halfWidth
    const innerX = edgeX - side * dip

    frontShape.moveTo(-halfWidth, -halfHeight)
    if (side > 0) {
      frontShape.lineTo(halfWidth, -halfHeight)
      frontShape.lineTo(halfWidth, -half)
      frontShape.bezierCurveTo(edgeX, -half * 0.76, innerX, -half * 0.52, innerX, -flatHalf)
      frontShape.lineTo(innerX, flatHalf)
      frontShape.bezierCurveTo(innerX, half * 0.52, edgeX, half * 0.76, edgeX, half)
      frontShape.lineTo(halfWidth, halfHeight)
      frontShape.lineTo(-halfWidth, halfHeight)
    } else {
      frontShape.lineTo(halfWidth, -halfHeight)
      frontShape.lineTo(halfWidth, halfHeight)
      frontShape.lineTo(-halfWidth, halfHeight)
      frontShape.lineTo(-halfWidth, half)
      frontShape.bezierCurveTo(edgeX, half * 0.76, innerX, half * 0.52, innerX, flatHalf)
      frontShape.lineTo(innerX, -flatHalf)
      frontShape.bezierCurveTo(innerX, -half * 0.52, edgeX, -half * 0.76, edgeX, -half)
      frontShape.lineTo(-halfWidth, -halfHeight)
    }
    frontShape.lineTo(-halfWidth, -halfHeight)
  }

  const geometry = new ExtrudeGeometry(frontShape, {
    depth: node.frontThickness,
    bevelEnabled: false,
    curveSegments: 32,
    steps: 1,
  })
  geometry.translate(0, 0, -node.frontThickness / 2)
  geometry.computeVertexNormals()
  return geometry
}

function buildFrontGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null = null,
): BufferGeometry {
  if (node.handleStyle === 'cutout')
    return buildCutoutFrontGeometry(node, width, height, drawer, hinge)
  if (node.handleStyle === 'hole') return buildHoleFrontGeometry(node, width, height, drawer, hinge)
  return createWorldScaleBoxGeometry(width, height, node.frontThickness)
}

function buildHoleFrontGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null,
): BufferGeometry {
  const base = createWorldScaleBoxGeometry(width, height, node.frontThickness)
  const radius = drawer ? 0.011 : 0.01
  const x =
    hinge == null
      ? 0
      : (hinge === 'right' ? -1 : 1) * (width / 2 - HANDLE_EDGE_INSET - HANDLE_SLOT_SHORT / 2)
  const y = drawer
    ? height / 2 - HANDLE_TOP_INSET
    : height / 2 - HANDLE_TOP_INSET - HANDLE_SLOT_LONG / 2
  const holeOffsets = drawer ? [-0.022, 0.022] : [0]
  const cutters = holeOffsets.map((offset) => {
    const cutter = new CylinderGeometry(radius, radius, node.frontThickness + 0.012, 24)
    cutter.rotateX(Math.PI / 2)
    cutter.translate(x + offset, y, 0)
    return cutter
  })
  return subtractFrontCutters(base, cutters, 'hole handle')
}

type CabinetGeometryNode = CabinetNode | CabinetModuleNode
type CabinetSlotMaterials = Record<CabinetSlotId, Material>
type FridgeSection = 'fresh' | 'freezer'

function createWorldScaleBoxGeometry(width: number, height: number, depth: number): BoxGeometry {
  const geometry = new BoxGeometry(width, height, depth)
  applyWorldScaleBoxUVs(geometry, width, height, depth)
  return geometry
}

function cabinetTotalHeight(
  node: Pick<
    CabinetGeometryNode,
    'carcassHeight' | 'countertopThickness' | 'plinthHeight' | 'showPlinth' | 'withCountertop'
  >,
) {
  return (
    (node.showPlinth ? node.plinthHeight : 0) +
    node.carcassHeight +
    (node.withCountertop ? node.countertopThickness : 0)
  )
}

function getLegacyCabinetMaterial(
  node: CabinetGeometryNode,
  shading: RenderShading,
): Material | null {
  if (node.materialPreset) {
    const preset = getMaterialPresetByRef(node.materialPreset)
    if (preset) {
      const base = createDefaultMaterial('#ffffff', 0.6, shading)
      applyMaterialPresetToMaterials(base, preset)
      return base
    }
  }
  if (node.material) return createMaterial(node.material as MaterialSchema, shading)
  return null
}

function getCabinetSlotMaterial(
  node: CabinetGeometryNode,
  slotId: CabinetSlotId,
  materials: GeometryContext['materials'],
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): Material {
  if (!textures) {
    if (slotId === 'glass') return defaultGlassMaterial
    return createSurfaceRoleMaterial('joinery', colorPreset, FrontSide, sceneTheme)
  }

  const slotRef = node.slots?.[slotId]
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, materials, shading)
    if (resolved) return resolved
  }

  if (
    slotId === 'front' ||
    slotId === 'carcass' ||
    slotId === 'countertop' ||
    slotId === 'plinth'
  ) {
    const legacy = getLegacyCabinetMaterial(node, shading)
    if (legacy) return legacy
  }

  return resolveSlotDefaultMaterial(
    CABINET_SLOT_DEFAULTS[slotId],
    shading,
    slotId === 'hardware' || slotId === 'appliance' ? 0.45 : 0.8,
  )
}

function getCabinetSlotMaterials(
  node: CabinetGeometryNode,
  ctx: GeometryContext | undefined,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): CabinetSlotMaterials {
  return {
    front: getCabinetSlotMaterial(
      node,
      'front',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    carcass: getCabinetSlotMaterial(
      node,
      'carcass',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    countertop: getCabinetSlotMaterial(
      node,
      'countertop',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    plinth: getCabinetSlotMaterial(
      node,
      'plinth',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    hardware: getCabinetSlotMaterial(
      node,
      'hardware',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    glass: getCabinetSlotMaterial(
      node,
      'glass',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    appliance: getCabinetSlotMaterial(
      node,
      'appliance',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    applianceInterior: getCabinetSlotMaterial(
      node,
      'applianceInterior',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
  }
}

function stampSlot<T extends Mesh>(mesh: T, slotId: CabinetSlotId): T {
  mesh.userData.slotId = slotId
  return mesh
}

function getRunModules(ctx?: GeometryContext): CabinetModuleNode[] {
  return (ctx?.children ?? []).filter(
    (child): child is CabinetModuleNode => child.type === 'cabinet-module',
  )
}

function getRunSpans(modules: CabinetModuleNode[]) {
  const sorted = [...modules].sort((a, b) => a.position[0] - b.position[0])
  const spans: Array<{
    minX: number
    maxX: number
    centerX: number
    centerZ: number
    width: number
    depth: number
    minZ: number
    maxZ: number
    topY: number
    hasCountertop: boolean
  }> = []

  for (const module of sorted) {
    const minX = module.position[0] - module.width / 2
    const maxX = module.position[0] + module.width / 2
    const minZ = module.position[2] - module.depth / 2
    const maxZ = module.position[2] + module.depth / 2
    const topY = module.position[1] + module.carcassHeight
    const hasCountertop = (module.cabinetType ?? 'base') !== 'tall'
    const current = spans.at(-1)
    if (
      !current ||
      minX - current.maxX > 1e-4 ||
      current.hasCountertop !== hasCountertop ||
      Math.abs(current.topY - topY) > 1e-4
    ) {
      spans.push({
        minX,
        maxX,
        centerX: module.position[0],
        centerZ: module.position[2],
        width: module.width,
        depth: module.depth,
        minZ,
        maxZ,
        topY,
        hasCountertop,
      })
      continue
    }

    current.maxX = Math.max(current.maxX, maxX)
    current.minZ = Math.min(current.minZ, minZ)
    current.maxZ = Math.max(current.maxZ, maxZ)
    current.width = Math.max(0.01, current.maxX - current.minX)
    current.centerX = (current.minX + current.maxX) / 2
    current.depth = Math.max(0.01, current.maxZ - current.minZ)
    current.centerZ = (current.minZ + current.maxZ) / 2
    current.topY = Math.max(current.topY, topY)
  }

  return spans
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function modulesForRun(node: CabinetNode, ctx?: GeometryContext): CabinetModuleNode[] {
  return (node.children ?? [])
    .map((id) => ctx?.resolve<AnyNode>(id))
    .filter((child): child is CabinetModuleNode => child?.type === 'cabinet-module')
}

function siblingCabinetSpansInRunLocal(node: CabinetNode, ctx?: GeometryContext) {
  if (!ctx) return []

  const localX = [Math.cos(node.rotation), -Math.sin(node.rotation)] as const
  const localZ = [Math.sin(node.rotation), Math.cos(node.rotation)] as const
  const spans: Array<{ minX: number; maxX: number; depth: number; z: number }> = []

  for (const sibling of ctx.siblings) {
    if (sibling.type !== 'cabinet' || sibling.id === node.id) continue
    if (Math.abs(angleDelta(sibling.rotation, node.rotation)) > 1e-3) continue

    const siblingModules = modulesForRun(sibling, ctx)
    const siblingSpans =
      siblingModules.length > 0
        ? getRunSpans(siblingModules)
        : [
            {
              minX: -sibling.width / 2,
              maxX: sibling.width / 2,
              centerX: 0,
              centerZ: 0,
              width: sibling.width,
              depth: sibling.depth,
              minZ: -sibling.depth / 2,
              maxZ: sibling.depth / 2,
              topY: sibling.carcassHeight,
              hasCountertop: sibling.runTier !== 'tall',
            },
          ]
    const dx = sibling.position[0] - node.position[0]
    const dz = sibling.position[2] - node.position[2]
    const originX = dx * localX[0] + dz * localX[1]
    const originZ = dx * localZ[0] + dz * localZ[1]

    for (const span of siblingSpans) {
      spans.push({
        minX: originX + span.minX,
        maxX: originX + span.maxX,
        depth: span.depth,
        z: originZ + span.centerZ,
      })
    }
  }

  return spans
}

function hasAdjacentCabinetSpan({
  depth,
  edgeX,
  overhang,
  side,
  siblingSpans,
}: {
  depth: number
  edgeX: number
  overhang: number
  side: 'left' | 'right'
  siblingSpans: Array<{ minX: number; maxX: number; depth: number; z: number }>
}) {
  return siblingSpans.some((sibling) => {
    if (Math.abs(sibling.z) > (depth + sibling.depth) / 2 + ADJACENT_RUN_Z_TOLERANCE) {
      return false
    }
    const gap = side === 'left' ? edgeX - sibling.maxX : sibling.minX - edgeX
    return gap >= -ADJACENT_RUN_EPSILON && gap <= overhang + ADJACENT_RUN_EPSILON
  })
}

function buildCabinetRunGeometry(
  node: CabinetNode,
  ctx: GeometryContext | undefined,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): Group | null {
  const modules = getRunModules(ctx)
  if (modules.length === 0) return null

  const group = new Group()
  const materials = getCabinetSlotMaterials(node, ctx, shading, textures, colorPreset, sceneTheme)
  const plinth = node.showPlinth ? node.plinthHeight : 0
  const spans = getRunSpans(modules)
  const siblingSpans = siblingCabinetSpansInRunLocal(node, ctx)

  for (const span of spans) {
    const spanIndex = spans.indexOf(span)
    const previousSpan = spans[spanIndex - 1]
    const nextSpan = spans[spanIndex + 1]
    const hasInternalLeftNeighbor =
      previousSpan && !previousSpan.hasCountertop && span.minX - previousSpan.maxX <= 1e-4
    const hasInternalRightNeighbor =
      nextSpan && !nextSpan.hasCountertop && nextSpan.minX - span.maxX <= 1e-4
    const hasExternalLeftNeighbor = hasAdjacentCabinetSpan({
      depth: span.depth,
      edgeX: span.minX,
      overhang: node.countertopOverhang,
      side: 'left',
      siblingSpans,
    })
    const hasExternalRightNeighbor = hasAdjacentCabinetSpan({
      depth: span.depth,
      edgeX: span.maxX,
      overhang: node.countertopOverhang,
      side: 'right',
      siblingSpans,
    })
    const leftOverhang =
      hasInternalLeftNeighbor || hasExternalLeftNeighbor ? 0 : node.countertopOverhang
    const rightOverhang =
      hasInternalRightNeighbor || hasExternalRightNeighbor ? 0 : node.countertopOverhang
    const toeKickDepth = node.showPlinth
      ? Math.min(node.toeKickDepth, span.depth - node.boardThickness * 2)
      : 0
    const plinthDepth = Math.max(node.boardThickness, span.depth - toeKickDepth)
    if (node.showPlinth && plinth > 0) {
      addBox(
        group,
        [span.width, plinth, plinthDepth],
        [span.centerX, plinth / 2, span.minZ + plinthDepth / 2],
        materials.plinth,
        'cabinet-run-plinth',
        'plinth',
      )
    }

    if (node.withCountertop && span.hasCountertop && node.countertopThickness > 0) {
      addBox(
        group,
        [
          span.width + leftOverhang + rightOverhang,
          node.countertopThickness,
          span.depth + node.countertopOverhang,
        ],
        [
          span.centerX + (rightOverhang - leftOverhang) / 2,
          span.topY + node.countertopThickness / 2,
          span.centerZ + node.countertopOverhang / 2,
        ],
        materials.countertop,
        'cabinet-run-countertop',
        'countertop',
      )
    }
  }

  return group
}

function addBox(
  group: Group,
  size: [number, number, number],
  position: [number, number, number],
  materialOrColor: Material | string,
  name: string,
  slotId: CabinetSlotId = 'carcass',
) {
  const material =
    typeof materialOrColor === 'string'
      ? new MeshStandardMaterial({ color: materialOrColor, metalness: 0.08, roughness: 0.72 })
      : materialOrColor
  const geometry = createWorldScaleBoxGeometry(size[0], size[1], size[2])
  const mesh = stampSlot(new Mesh(geometry, material), slotId)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function buildFrustumGeometry(
  bottomWidth: number,
  bottomDepth: number,
  topWidth: number,
  topDepth: number,
  height: number,
  topOffsetZ: number,
): BufferGeometry {
  const bx = bottomWidth / 2
  const bz = bottomDepth / 2
  const tx = topWidth / 2
  const tz = topDepth / 2
  const b0 = [-bx, 0, -bz]
  const b1 = [bx, 0, -bz]
  const b2 = [bx, 0, bz]
  const b3 = [-bx, 0, bz]
  const t0 = [-tx, height, topOffsetZ - tz]
  const t1 = [tx, height, topOffsetZ - tz]
  const t2 = [tx, height, topOffsetZ + tz]
  const t3 = [-tx, height, topOffsetZ + tz]
  const quads: number[][][] = [
    [b3, b2, t2, t3],
    [b1, b0, t0, t1],
    [b0, b3, t3, t0],
    [b2, b1, t1, t2],
    [t0, t3, t2, t1],
    [b0, b1, b2, b3],
  ]
  const positions: number[] = []
  for (const [a, b, c, d] of quads) {
    positions.push(...a!, ...b!, ...c!, ...a!, ...c!, ...d!)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function resolveHoodDuctTopY(node: CabinetGeometryNode, ctx: GeometryContext | undefined): number {
  let baseY = node.position?.[1] ?? 0
  let cursor: AnyNode | null = ctx?.parent ?? null
  let guard = 0
  while (cursor && (cursor.type === 'cabinet' || cursor.type === 'cabinet-module') && guard < 8) {
    const position = (cursor as { position?: unknown }).position
    if (Array.isArray(position) && typeof position[1] === 'number') baseY += position[1]
    cursor = cursor.parentId ? (ctx?.resolve<AnyNode>(cursor.parentId as AnyNodeId) ?? null) : null
    guard += 1
  }
  let ceiling = DEFAULT_CEILING_HEIGHT
  const levelChildren = (cursor as { children?: unknown } | null)?.children
  if (Array.isArray(levelChildren)) {
    const wallHeights = levelChildren
      .map((id) => ctx?.resolve<AnyNode>(id as AnyNodeId))
      .filter((child): child is AnyNode => child?.type === 'wall')
      .map((wall) => (wall as { height?: number }).height ?? DEFAULT_CEILING_HEIGHT)
    if (wallHeights.length > 0) ceiling = Math.max(...wallHeights)
  }
  return ceiling - baseY
}

function addRangeHoodCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  kind: CabinetHoodCompartmentType,
  bottomY: number,
  height: number,
  ctx: GeometryContext | undefined,
  index: number,
) {
  const width = node.width
  const backZ = -node.depth / 2
  const canopyCenterZ = backZ + HOOD_CANOPY_DEPTH / 2
  const ductCenterZ = backZ + HOOD_DUCT_SIZE / 2 + 0.02
  const name = `cabinet-${kind}-${index}`

  let ductBottomY: number
  if (kind === 'hood-pyramid') {
    const frustum = buildFrustumGeometry(
      width,
      HOOD_CANOPY_DEPTH,
      HOOD_DUCT_SIZE + 0.04,
      HOOD_DUCT_SIZE + 0.04,
      height,
      ductCenterZ - canopyCenterZ,
    )
    const canopy = stampSlot(new Mesh(frustum, materials.appliance), 'appliance')
    canopy.name = `${name}-canopy`
    canopy.position.set(0, bottomY, canopyCenterZ)
    canopy.castShadow = true
    canopy.receiveShadow = true
    group.add(canopy)

    addBox(
      group,
      [width, 0.02, HOOD_CANOPY_DEPTH],
      [0, bottomY + 0.01, canopyCenterZ],
      materials.appliance,
      `${name}-rim`,
      'appliance',
    )
    ductBottomY = bottomY + height
  } else {
    const bodyDepth = Math.min(0.3, HOOD_CANOPY_DEPTH)
    const bodyCenterZ = backZ + bodyDepth / 2
    addBox(
      group,
      [width, HOOD_CURVED_BODY_HEIGHT, bodyDepth],
      [0, bottomY + HOOD_CURVED_BODY_HEIGHT / 2, bodyCenterZ],
      materials.appliance,
      `${name}-body`,
      'appliance',
    )

    const glassThickness = 0.008
    const zFront = backZ + bodyDepth
    const zBack = backZ + 0.04
    const yBottom = bottomY + HOOD_CURVED_BODY_HEIGHT
    const yTop = bottomY + height
    const profile = new Shape()
    profile.moveTo(zFront, yBottom)
    profile.quadraticCurveTo(zFront, yTop, zBack, yTop)
    profile.lineTo(zBack, yTop - glassThickness)
    profile.quadraticCurveTo(
      zFront - glassThickness,
      yTop - glassThickness,
      zFront - glassThickness,
      yBottom,
    )
    profile.lineTo(zFront, yBottom)
    const visorGeometry = new ExtrudeGeometry(profile, {
      depth: width,
      bevelEnabled: false,
      curveSegments: 24,
      steps: 1,
    })
    visorGeometry.rotateY(-Math.PI / 2)
    visorGeometry.translate(width / 2, 0, 0)
    visorGeometry.computeVertexNormals()
    const visor = stampSlot(new Mesh(visorGeometry, materials.glass), 'glass')
    visor.name = `${name}-glass-visor`
    visor.castShadow = true
    group.add(visor)
    ductBottomY = bottomY + HOOD_CURVED_BODY_HEIGHT
  }

  const ductTopY = Math.max(ductBottomY + 0.05, resolveHoodDuctTopY(node, ctx))
  const ductHeight = ductTopY - ductBottomY
  addBox(
    group,
    [HOOD_DUCT_SIZE, ductHeight, HOOD_DUCT_SIZE],
    [0, ductBottomY + ductHeight / 2, ductCenterZ],
    materials.appliance,
    `${name}-duct`,
    'appliance',
  )
}

function addBarHandle(
  group: Object3D,
  position: [number, number, number],
  length: number,
  vertical: boolean,
  name: string,
  material: Material,
) {
  const mesh = stampSlot(
    new Mesh(new CylinderGeometry(0.006, 0.006, length, 16), material),
    'hardware',
  )
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2] + 0.028)
  if (!vertical) mesh.rotation.z = Math.PI / 2
  mesh.castShadow = true
  group.add(mesh)

  const standOffDistance = length * 0.38
  for (const offset of [-standOffDistance, standOffDistance]) {
    const standoff = stampSlot(
      new Mesh(new CylinderGeometry(0.004, 0.004, 0.026, 10), material),
      'hardware',
    )
    standoff.name = `${name}-standoff`
    standoff.position.set(
      position[0] + (vertical ? 0 : offset),
      position[1] + (vertical ? offset : 0),
      position[2] + 0.014,
    )
    standoff.rotation.x = Math.PI / 2
    standoff.castShadow = true
    group.add(standoff)
  }
}

function addKnobHandle(
  group: Object3D,
  position: [number, number, number],
  name: string,
  material: Material,
) {
  const stem = stampSlot(
    new Mesh(new CylinderGeometry(0.005, 0.005, 0.02, 12), material),
    'hardware',
  )
  stem.name = `${name}-stem`
  stem.position.set(position[0], position[1], position[2] + 0.01)
  stem.rotation.x = Math.PI / 2
  stem.castShadow = true
  group.add(stem)

  const knob = stampSlot(new Mesh(new SphereGeometry(0.011, 16, 12), material), 'hardware')
  knob.name = name
  knob.position.set(position[0], position[1], position[2] + 0.022)
  knob.castShadow = true
  group.add(knob)
}

function resolveHandleY(node: CabinetGeometryNode, height: number, drawer: boolean): number {
  const position = node.handlePosition ?? 'auto'
  const topY = drawer
    ? height / 2 - HANDLE_TOP_INSET
    : height / 2 - HANDLE_TOP_INSET - HANDLE_SLOT_LONG / 2
  if (position === 'center') return 0
  if (position === 'top') return topY
  // 'auto' | 'edge': drawers pull from the top, doors from mid-height.
  return drawer ? topY : 0
}

function addHandleFeature(
  group: Object3D,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  hinge: 'left' | 'right' | null,
  vertical: boolean,
  drawer = false,
  name = 'handle',
  placement?: { x?: number; y?: number },
) {
  const style = node.handleStyle ?? 'bar'
  if (style === 'none') return

  const edgeX =
    hinge == null
      ? 0
      : (hinge === 'right' ? -1 : 1) * (width / 2 - HANDLE_EDGE_INSET - HANDLE_SLOT_SHORT / 2)

  if (style === 'bar') {
    const x = placement?.x ?? edgeX
    const y = placement?.y ?? resolveHandleY(node, height, drawer)
    const z = node.frontThickness / 2
    addBarHandle(group, [x, y, z], drawer ? 0.12 : 0.18, vertical, name, materials.hardware)
    return
  }

  if (style === 'knob') {
    const x = placement?.x ?? edgeX
    const y = placement?.y ?? resolveHandleY(node, height, drawer)
    const z = node.frontThickness / 2
    addKnobHandle(group, [x, y, z], name, materials.hardware)
    return
  }

  if (style === 'hole') {
    return
  }

  if (style === 'cutout') {
    return
  }

  const x =
    placement?.x ??
    (hinge == null
      ? 0
      : (hinge === 'right' ? -1 : 1) * (width / 2 - HANDLE_EDGE_INSET - HANDLE_SLOT_SHORT / 2))
  const y =
    placement?.y ??
    (drawer ? height / 2 - HANDLE_TOP_INSET : height / 2 - HANDLE_TOP_INSET - HANDLE_SLOT_LONG / 2)
  const z = node.frontThickness / 2
  const slotLength = drawer ? HANDLE_SLOT_LONG : 0.1
  const slotThickness = HANDLE_SLOT_SHORT
  const size: [number, number, number] = vertical
    ? [slotThickness, slotLength, Math.max(0.004, node.frontThickness * 0.4)]
    : [slotLength, slotThickness, Math.max(0.004, node.frontThickness * 0.4)]
  const mesh = stampSlot(
    new Mesh(new BoxGeometry(size[0], size[1], size[2]), materials.hardware),
    'hardware',
  )
  mesh.name = name
  mesh.position.set(x, y, z - node.frontThickness * 0.18)
  group.add(mesh)
}

function addDoorLeaf(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  hinge: 'left' | 'right',
  centerX: number,
  centerY: number,
  frontZ: number,
  name: string,
  glass = false,
) {
  const hingeGroup = new Group()
  hingeGroup.name = `${name}-hinge`
  hingeGroup.position.set(
    hinge === 'left' ? centerX - width / 2 : centerX + width / 2,
    centerY,
    frontZ,
  )
  hingeGroup.rotation.y = (hinge === 'left' ? -1 : 1) * (Math.PI / 2) * (node.operationState ?? 0)
  hingeGroup.userData.cabinetPose = {
    type: 'rotate',
    axis: 'y',
    angle: (hinge === 'left' ? -1 : 1) * (Math.PI / 2),
  }
  group.add(hingeGroup)

  if (glass) {
    const leafGroup = new Group()
    leafGroup.name = name
    leafGroup.position.set(hinge === 'left' ? width / 2 : -width / 2, 0, 0)
    hingeGroup.add(leafGroup)

    const frame = Math.max(0.03, Math.min(width, height) * 0.12)
    const glassWidth = Math.max(0.01, width - frame * 2)
    const glassHeight = Math.max(0.01, height - frame * 2)
    const glassDepth = Math.max(0.003, node.frontThickness * 0.25)
    addBox(
      leafGroup,
      [width, frame, node.frontThickness],
      [0, height / 2 - frame / 2, 0],
      materials.front,
      `${name}-frame-top`,
      'front',
    )
    addBox(
      leafGroup,
      [width, frame, node.frontThickness],
      [0, -height / 2 + frame / 2, 0],
      materials.front,
      `${name}-frame-bottom`,
      'front',
    )
    addBox(
      leafGroup,
      [frame, glassHeight, node.frontThickness],
      [-width / 2 + frame / 2, 0, 0],
      materials.front,
      `${name}-frame-left`,
      'front',
    )
    addBox(
      leafGroup,
      [frame, glassHeight, node.frontThickness],
      [width / 2 - frame / 2, 0, 0],
      materials.front,
      `${name}-frame-right`,
      'front',
    )
    const glassMesh = stampSlot(
      new Mesh(new BoxGeometry(glassWidth, glassHeight, glassDepth), materials.glass),
      'glass',
    )
    glassMesh.name = `${name}-glass`
    glassMesh.position.set(0, 0, node.frontThickness / 2 + glassDepth / 2 + 0.001)
    glassMesh.renderOrder = 2
    leafGroup.add(glassMesh)
    addHandleFeature(
      leafGroup,
      { ...node, handleStyle: 'bar' },
      materials,
      width,
      height,
      hinge,
      true,
      false,
      `${name}-handle`,
      {
        x: (hinge === 'right' ? -1 : 1) * (width / 2 - frame / 2),
        y: 0,
      },
    )
    return
  }

  const mesh = stampSlot(
    new Mesh(buildFrontGeometry(node, width, height, false, hinge), materials.front),
    'front',
  )
  mesh.name = name
  mesh.position.set(hinge === 'left' ? width / 2 : -width / 2, 0, 0)
  mesh.castShadow = true
  mesh.receiveShadow = true
  hingeGroup.add(mesh)

  addHandleFeature(mesh, node, materials, width, height, hinge, true, false, `${name}-handle`)
}

function addDoorFronts(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  openingWidth: number,
  openingHeight: number,
  centerX: number,
  centerY: number,
  frontZ: number,
  doorType: 'single-left' | 'single-right' | 'double' | 'glass',
) {
  const frontHeight = Math.max(0.01, openingHeight - 2 * node.frontGap)
  if (doorType === 'double' || doorType === 'glass') {
    const leafWidth = Math.max(0.01, (openingWidth - 3 * node.frontGap) / 2)
    const offset = leafWidth / 2 + node.frontGap / 2
    addDoorLeaf(
      group,
      node,
      materials,
      leafWidth,
      frontHeight,
      'left',
      centerX - offset,
      centerY,
      frontZ,
      `cabinet-door-left-${centerY.toFixed(3)}`,
      doorType === 'glass',
    )
    addDoorLeaf(
      group,
      node,
      materials,
      leafWidth,
      frontHeight,
      'right',
      centerX + offset,
      centerY,
      frontZ,
      `cabinet-door-right-${centerY.toFixed(3)}`,
      doorType === 'glass',
    )
    return
  }
  addDoorLeaf(
    group,
    node,
    materials,
    openingWidth - 2 * node.frontGap,
    frontHeight,
    doorType === 'single-left' ? 'left' : 'right',
    centerX,
    centerY,
    frontZ,
    `cabinet-door-single-${centerY.toFixed(3)}`,
  )
}

function addShelfBoards(
  group: Group,
  materials: CabinetSlotMaterials,
  openingWidth: number,
  openingDepth: number,
  board: number,
  y0: number,
  height: number,
  count: number,
) {
  if (count <= 0) return
  for (let i = 0; i < count; i++) {
    const y = y0 + (height * (i + 1)) / (count + 1)
    addBox(
      group,
      [openingWidth, board, openingDepth],
      [0, y, board / 2],
      materials.carcass,
      `cabinet-shelf-${y.toFixed(3)}-${i}`,
      'carcass',
    )
  }
}

function drawerOpenScale(index: number, count: number) {
  if (count <= 1) return 1
  return 1 - (index / (count - 1)) * (1 - DRAWER_MIN_OPEN)
}

function addDrawerFronts(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  faceWidth: number,
  faceHeight: number,
  centerY: number,
  y0: number,
  boxOpeningWidth: number,
  frontZ: number,
  count: number,
  boxBackZ: number,
  boxDepth: number,
) {
  const usableHeight = Math.max(0.01, faceHeight - 2 * node.frontGap)
  const drawerHeight = Math.max(0.01, (usableHeight - (count - 1) * node.frontGap) / count)
  const drawerSideThickness = Math.min(0.012, node.boardThickness * 0.7)
  const boxWidth = Math.max(0.01, boxOpeningWidth - 0.026)
  const boxHeight = Math.max(0.02, drawerHeight - 0.012)
  const boxCenterZ = boxBackZ + boxDepth / 2
  for (let i = 0; i < count; i++) {
    const openDistance = Math.min(boxDepth * 0.9, 0.35) * drawerOpenScale(i, count)
    const openOffset = (node.operationState ?? 0) * openDistance
    const y = y0 + node.frontGap + drawerHeight / 2 + i * (drawerHeight + node.frontGap)
    const frontWidth = faceWidth - 2 * node.frontGap

    const slideGroup = new Group()
    slideGroup.name = `cabinet-drawer-slide-${centerY.toFixed(3)}-${i}`
    slideGroup.position.set(0, 0, openOffset)
    slideGroup.userData.cabinetPose = { type: 'translate', axis: 'z', distance: openDistance }
    group.add(slideGroup)

    const frontMesh = stampSlot(
      new Mesh(buildFrontGeometry(node, frontWidth, drawerHeight, true), materials.front),
      'front',
    )
    frontMesh.name = `cabinet-drawer-front-${centerY.toFixed(3)}-${i}`
    frontMesh.position.set(0, y, frontZ)
    frontMesh.castShadow = true
    frontMesh.receiveShadow = true
    slideGroup.add(frontMesh)

    if (node.handleStyle !== 'cutout' && node.handleStyle !== 'hole') {
      const handleGroup = new Group()
      handleGroup.position.set(0, y, frontZ)
      handleGroup.name = `cabinet-drawer-handle-group-${centerY.toFixed(3)}-${i}`
      addHandleFeature(
        handleGroup,
        node,
        materials,
        frontWidth,
        drawerHeight,
        null,
        false,
        true,
        `cabinet-drawer-handle-${centerY.toFixed(3)}-${i}`,
      )
      slideGroup.add(handleGroup)
    }

    addBox(
      slideGroup,
      [drawerSideThickness, boxHeight, boxDepth],
      [-(boxWidth / 2) + drawerSideThickness / 2, y, boxCenterZ],
      materials.carcass,
      `cabinet-drawer-side-left-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
    addBox(
      slideGroup,
      [drawerSideThickness, boxHeight, boxDepth],
      [boxWidth / 2 - drawerSideThickness / 2, y, boxCenterZ],
      materials.carcass,
      `cabinet-drawer-side-right-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
    addBox(
      slideGroup,
      [boxWidth - 2 * drawerSideThickness, boxHeight, drawerSideThickness],
      [0, y, boxBackZ + drawerSideThickness / 2],
      materials.carcass,
      `cabinet-drawer-back-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
    addBox(
      slideGroup,
      [boxWidth - 2 * drawerSideThickness, drawerSideThickness, boxDepth - drawerSideThickness],
      [0, y - boxHeight / 2 + drawerSideThickness / 2, boxCenterZ],
      materials.carcass,
      `cabinet-drawer-bottom-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
  }
}

const OVEN_OPEN_ANGLE = (88 * Math.PI) / 180
const APPLIANCE_CAVITY_WALL = 0.02

const applianceDisplayMaterial = new MeshStandardMaterial({
  color: '#120c05',
  emissive: '#ff9a3d',
  emissiveIntensity: 0.85,
  roughness: 0.3,
})
const applianceLampMaterial = new MeshStandardMaterial({
  color: '#2b2417',
  emissive: '#ffd9a0',
  emissiveIntensity: 0.6,
  roughness: 0.4,
})
const microwaveScreenMaterial = new MeshStandardMaterial({
  color: '#05070a',
  emissive: '#111827',
  emissiveIntensity: 0.2,
  metalness: 0.05,
  roughness: 0.32,
})
const microwaveButtonMaterial = new MeshStandardMaterial({
  color: '#2f3338',
  metalness: 0.35,
  roughness: 0.42,
})
const microwaveStartButtonMaterial = new MeshStandardMaterial({
  color: '#1d6f45',
  emissive: '#16a34a',
  emissiveIntensity: 0.08,
  metalness: 0.2,
  roughness: 0.38,
})
const microwaveCancelButtonMaterial = new MeshStandardMaterial({
  color: '#7f1d1d',
  emissive: '#ef4444',
  emissiveIntensity: 0.08,
  metalness: 0.2,
  roughness: 0.38,
})
const microwavePanelMaterial = new MeshStandardMaterial({
  color: '#16191d',
  metalness: 0.55,
  roughness: 0.36,
})
const cooktopGlassMaterial = new MeshStandardMaterial({
  color: '#17191c',
  metalness: 0.45,
  roughness: 0.07,
})
const cooktopBurnerMaterial = new MeshStandardMaterial({
  color: '#7d8389',
  metalness: 0.85,
  roughness: 0.3,
})
const cooktopTrimMaterial = new MeshStandardMaterial({
  color: '#3a3d41',
  metalness: 0.85,
  roughness: 0.3,
})
const cooktopGrateMaterial = new MeshStandardMaterial({
  color: '#0d0e10',
  metalness: 0.55,
  roughness: 0.5,
})
const cooktopInductionZoneMaterial = new MeshStandardMaterial({
  color: '#07111f',
  emissive: '#2563eb',
  emissiveIntensity: 0.22,
  metalness: 0.05,
  roughness: 0.2,
})
const cooktopInductionActiveZoneMaterial = new MeshStandardMaterial({
  color: '#0b1f3a',
  emissive: '#38bdf8',
  emissiveIntensity: 0.75,
  metalness: 0.05,
  roughness: 0.18,
})
const cooktopKnobOnMaterial = new MeshStandardMaterial({
  color: '#ffb86b',
  emissive: '#f97316',
  emissiveIntensity: 0.45,
  metalness: 0.2,
  roughness: 0.24,
})
const cooktopKnobHitMaterial = new MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  transparent: true,
  opacity: 0,
})
const refrigeratorSilverMaterial = new MeshStandardMaterial({
  color: '#c9ccd0',
  metalness: 0.78,
  roughness: 0.32,
})
const refrigeratorBrassAccentMaterial = new MeshStandardMaterial({
  color: '#b3925f',
  metalness: 0.75,
  roughness: 0.3,
})
const refrigeratorDarkTrimMaterial = new MeshStandardMaterial({
  color: '#4d5257',
  metalness: 0.6,
  roughness: 0.42,
})
const refrigeratorSealMaterial = new MeshStandardMaterial({
  color: '#d9dbdd',
  metalness: 0.02,
  roughness: 0.6,
})
const refrigeratorLinerMaterial = new MeshStandardMaterial({
  color: '#f7f8f9',
  metalness: 0.02,
  roughness: 0.55,
})
const refrigeratorLinerAccentMaterial = new MeshStandardMaterial({
  color: '#eef0f2',
  metalness: 0.02,
  roughness: 0.48,
})
const refrigeratorDrawerMaterial = new MeshStandardMaterial({
  color: '#eef4f8',
  transparent: true,
  opacity: 0.45,
  metalness: 0.02,
  roughness: 0.18,
})
const refrigeratorBinMaterial = new MeshStandardMaterial({
  color: '#f4f6f8',
  transparent: true,
  opacity: 0.62,
  metalness: 0.02,
  roughness: 0.24,
})
const refrigeratorLightMaterial = new MeshStandardMaterial({
  color: '#fff7d6',
  emissive: '#fff1a8',
  emissiveIntensity: 0.32,
  roughness: 0.24,
})
const refrigeratorWaterMaterial = new MeshStandardMaterial({
  color: '#38bdf8',
  emissive: '#0ea5e9',
  emissiveIntensity: 0.18,
  metalness: 0.05,
  roughness: 0.22,
})
const ovenDialMaterial = new MeshStandardMaterial({
  color: '#d5d7d8',
  metalness: 0.72,
  roughness: 0.24,
})
const ovenIndicatorMaterial = new MeshStandardMaterial({
  color: '#f8fafc',
  emissive: '#f8fafc',
  emissiveIntensity: 0.12,
  metalness: 0.1,
  roughness: 0.32,
})
const ovenHeatElementMaterial = new MeshStandardMaterial({
  color: '#4a1f16',
  emissive: '#ff6b35',
  emissiveIntensity: 0.28,
  metalness: 0.35,
  roughness: 0.42,
})

function addApplianceHandle(
  group: Object3D,
  material: Material,
  position: [number, number, number],
  length: number,
  vertical: boolean,
  name: string,
) {
  const tube = stampSlot(
    new Mesh(new CylinderGeometry(0.009, 0.009, length, 16), material),
    'appliance',
  )
  tube.name = name
  tube.position.set(position[0], position[1], position[2] + 0.042)
  if (!vertical) tube.rotation.z = Math.PI / 2
  tube.castShadow = true
  group.add(tube)

  const standoffDistance = length * 0.38
  for (const offset of [-standoffDistance, standoffDistance]) {
    const standoff = stampSlot(
      new Mesh(new CylinderGeometry(0.006, 0.006, 0.04, 10), material),
      'appliance',
    )
    standoff.name = `${name}-standoff`
    standoff.position.set(
      position[0] + (vertical ? 0 : offset),
      position[1] + (vertical ? offset : 0),
      position[2] + 0.02,
    )
    standoff.rotation.x = Math.PI / 2
    standoff.castShadow = true
    group.add(standoff)
  }
}

function addMicrowaveVentSlats(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const slatWidth = Math.max(0.018, width * 0.52)
  for (let i = 0; i < 5; i += 1) {
    const slat = stampSlot(
      new Mesh(new BoxGeometry(slatWidth, 0.0035, 0.004), microwaveScreenMaterial),
      'appliance',
    )
    slat.name = `${name}-vent-${i}`
    slat.position.set(x, y - i * 0.009, z + 0.002)
    group.add(slat)
  }
}

function roundedButtonGeometry(width: number, height: number, depth: number, radius: number) {
  const shape = new Shape()
  const halfWidth = width / 2
  const halfHeight = height / 2
  const r = Math.min(radius, halfWidth, halfHeight)
  shape.moveTo(-halfWidth + r, -halfHeight)
  shape.lineTo(halfWidth - r, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r)
  shape.lineTo(halfWidth, halfHeight - r)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight)
  shape.lineTo(-halfWidth + r, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r)
  shape.lineTo(-halfWidth, -halfHeight + r)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight)

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(0.0015, depth * 0.3),
    bevelSize: Math.min(0.0015, r * 0.35),
    bevelSegments: 2,
    curveSegments: 8,
    steps: 1,
  })
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  return geometry
}

function addMicrowaveButton(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  material: Material,
  name: string,
) {
  const button = stampSlot(
    new Mesh(roundedButtonGeometry(width, height, 0.007, Math.min(width, height) * 0.28), material),
    'appliance',
  )
  button.name = name
  button.position.set(x, y, z + 0.004)
  button.castShadow = true
  group.add(button)

  const highlight = stampSlot(
    new Mesh(
      roundedButtonGeometry(width * 0.58, height * 0.16, 0.002, height * 0.06),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  highlight.name = `${name}-highlight`
  highlight.position.set(x, y + height * 0.22, z + 0.008)
  group.add(highlight)
}

function addMicrowaveDisplaySegments(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const segmentWidth = width * 0.16
  const segmentHeight = 0.004
  for (let i = 0; i < 3; i += 1) {
    const segment = stampSlot(
      new Mesh(new BoxGeometry(segmentWidth, segmentHeight, 0.002), applianceDisplayMaterial),
      'appliance',
    )
    segment.name = `${name}-display-segment-${i}`
    segment.position.set(x - width * 0.22 + i * width * 0.22, y, z + 0.006)
    group.add(segment)
  }
}

function addMicrowaveControls(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  panelWidth: number,
  panelHeight: number,
  name: string,
) {
  const shellWidth = panelWidth * 0.82
  const shellHeight = Math.min(panelHeight * 0.7, 0.27)
  const shellY = y
  const panelBack = stampSlot(
    new Mesh(
      roundedButtonGeometry(shellWidth, shellHeight, 0.004, panelWidth * 0.08),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  panelBack.name = `${name}-control-panel`
  panelBack.position.set(x, shellY, z + 0.001)
  group.add(panelBack)

  const displayWidth = Math.min(0.085, panelWidth * 0.56)
  const displayHeight = Math.min(0.024, shellHeight * 0.12)
  const displayY = shellY + shellHeight * 0.32
  const display = stampSlot(
    new Mesh(
      roundedButtonGeometry(displayWidth, displayHeight, 0.004, displayHeight * 0.2),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  display.name = `${name}-display`
  display.position.set(x, displayY, z + 0.002)
  group.add(display)
  addMicrowaveDisplaySegments(group, x, displayY, z, displayWidth, name)

  const buttonSize = Math.max(0.009, Math.min(0.014, panelWidth * 0.105))
  const gap = buttonSize * 1.55
  const quickY = shellY + shellHeight * 0.18
  const startY = shellY + shellHeight * 0.04

  addMicrowaveButton(
    group,
    x - gap * 0.58,
    quickY,
    z,
    buttonSize * 1.1,
    buttonSize * 0.72,
    microwaveButtonMaterial,
    `${name}-quick-button-30s`,
  )
  addMicrowaveButton(
    group,
    x + gap * 0.58,
    quickY,
    z,
    buttonSize * 1.1,
    buttonSize * 0.72,
    microwaveButtonMaterial,
    `${name}-quick-button-power`,
  )

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      addMicrowaveButton(
        group,
        x + (col - 1) * gap,
        startY - row * gap,
        z,
        buttonSize,
        buttonSize,
        microwaveButtonMaterial,
        `${name}-button-${row}-${col}`,
      )
    }
  }

  const actionY = startY - gap * 4.05
  addMicrowaveButton(
    group,
    x - gap * 0.62,
    actionY,
    z,
    buttonSize * 1.18,
    buttonSize * 0.82,
    microwaveCancelButtonMaterial,
    `${name}-cancel-button`,
  )
  addMicrowaveButton(
    group,
    x + gap * 0.62,
    actionY,
    z,
    buttonSize * 1.18,
    buttonSize * 0.82,
    microwaveStartButtonMaterial,
    `${name}-start-button`,
  )
}

function addOvenVentSlots(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const slatWidth = Math.max(0.045, width * 0.12)
  const gap = slatWidth * 1.35
  for (let i = 0; i < 6; i += 1) {
    const slat = stampSlot(
      new Mesh(new BoxGeometry(slatWidth, 0.004, 0.004), microwaveScreenMaterial),
      'appliance',
    )
    slat.name = `${name}-vent-${i}`
    slat.position.set(x - gap * 2.5 + i * gap, y, z + 0.002)
    group.add(slat)
  }
}

function addOvenRotaryDial(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  name: string,
) {
  const dial = stampSlot(
    new Mesh(new CylinderGeometry(radius, radius, 0.018, 36), ovenDialMaterial),
    'appliance',
  )
  dial.name = name
  dial.rotation.x = Math.PI / 2
  dial.position.set(x, y, z + 0.009)
  dial.castShadow = true
  group.add(dial)

  const face = stampSlot(
    new Mesh(
      roundedButtonGeometry(radius * 1.36, radius * 0.28, 0.002, radius * 0.08),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  face.name = `${name}-grip`
  face.position.set(x, y, z + 0.02)
  group.add(face)

  const indicator = stampSlot(
    new Mesh(new BoxGeometry(radius * 0.16, radius * 0.68, 0.0025), ovenIndicatorMaterial),
    'appliance',
  )
  indicator.name = `${name}-indicator`
  indicator.position.set(x, y + radius * 0.34, z + 0.022)
  group.add(indicator)

  const ring = stampSlot(
    new Mesh(new TorusGeometry(radius * 1.25, 0.002, 8, 36), microwaveScreenMaterial),
    'appliance',
  )
  ring.name = `${name}-ring`
  ring.position.set(x, y, z + 0.003)
  group.add(ring)
}

function addOvenStatusLights(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  gap: number,
  name: string,
) {
  const colors = ['#f97316', '#22c55e', '#38bdf8']
  colors.forEach((color, index) => {
    const material = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.42,
      roughness: 0.28,
    })
    const light = stampSlot(
      new Mesh(new CylinderGeometry(radius, radius, 0.003, 16), material),
      'appliance',
    )
    light.name = `${name}-status-light-${index}`
    light.rotation.x = Math.PI / 2
    light.position.set(x + index * gap, y, z + 0.004)
    group.add(light)
  })
}

function addOvenControls(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  name: string,
) {
  const panelWidth = width * 0.96
  const panelHeight = height * 0.88
  const panel = stampSlot(
    new Mesh(
      roundedButtonGeometry(panelWidth, panelHeight, 0.004, height * 0.14),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  panel.name = `${name}-control-panel`
  panel.position.set(x, y, z + 0.001)
  group.add(panel)

  const dialRadius = Math.min(0.021, height * 0.26, width * 0.04)
  addOvenRotaryDial(group, x - width * 0.36, y + height * 0.02, z, dialRadius, `${name}-knob-0`)
  addOvenRotaryDial(group, x + width * 0.36, y + height * 0.02, z, dialRadius, `${name}-knob-1`)

  const displayWidth = Math.min(0.14, width * 0.24)
  const displayHeight = Math.min(0.024, height * 0.28)
  const displayY = y + height * 0.12
  const display = stampSlot(
    new Mesh(
      roundedButtonGeometry(displayWidth, displayHeight, 0.004, displayHeight * 0.2),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  display.name = `${name}-display`
  display.position.set(x, displayY, z + 0.004)
  group.add(display)
  addMicrowaveDisplaySegments(group, x, displayY, z, displayWidth, name)

  const buttonWidth = Math.min(0.032, width * 0.055)
  const buttonHeight = Math.min(0.011, height * 0.14)
  const buttonY = y - height * 0.16
  for (let i = 0; i < 3; i += 1) {
    addMicrowaveButton(
      group,
      x - buttonWidth * 1.3 + i * buttonWidth * 1.3,
      buttonY,
      z,
      buttonWidth,
      buttonHeight,
      microwaveButtonMaterial,
      `${name}-mode-button-${i}`,
    )
  }

  const lightRadius = Math.min(0.0045, height * 0.055)
  const lightGap = lightRadius * 3.1
  addOvenStatusLights(
    group,
    x + displayWidth / 2 + lightGap * 0.9,
    displayY,
    z,
    lightRadius,
    lightGap,
    name,
  )
  addOvenVentSlots(group, x, y - height * 0.35, z, width * 0.82, name)
}

function addOvenDoorDetails(
  leaf: Object3D,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  glassWidth: number,
  glassHeight: number,
  frontThickness: number,
  name: string,
) {
  const gasketBar = Math.max(0.006, Math.min(0.011, Math.min(width, height) * 0.018))
  const gasketWidth = Math.max(0.01, glassWidth + gasketBar)
  const gasketHeight = Math.max(0.01, glassHeight + gasketBar)
  addBox(
    leaf as Group,
    [gasketWidth, gasketBar, frontThickness * 0.45],
    [0, gasketHeight / 2, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-top`,
    'appliance',
  )
  addBox(
    leaf as Group,
    [gasketWidth, gasketBar, frontThickness * 0.45],
    [0, -gasketHeight / 2, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-bottom`,
    'appliance',
  )
  addBox(
    leaf as Group,
    [gasketBar, gasketHeight, frontThickness * 0.45],
    [-gasketWidth / 2, 0, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-left`,
    'appliance',
  )
  addBox(
    leaf as Group,
    [gasketBar, gasketHeight, frontThickness * 0.45],
    [gasketWidth / 2, 0, frontThickness / 2 + 0.002],
    microwaveScreenMaterial,
    `${name}-window-gasket-right`,
    'appliance',
  )

  const lowerRail = stampSlot(
    new Mesh(
      roundedButtonGeometry(width * 0.72, Math.max(0.009, height * 0.026), 0.006, height * 0.01),
      materials.appliance,
    ),
    'appliance',
  )
  lowerRail.name = `${name}-door-lower-rail`
  lowerRail.position.set(0, -height * 0.43, frontThickness / 2 + 0.006)
  leaf.add(lowerRail)
}

function addOvenInteriorDetails(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  name: string,
) {
  const fanRadius = Math.min(width, height) * 0.18
  const fanRing = stampSlot(
    new Mesh(new TorusGeometry(fanRadius, 0.004, 8, 48), materials.applianceInterior),
    'applianceInterior',
  )
  fanRing.name = `${name}-convection-fan-ring`
  fanRing.position.set(x, y, z + 0.012)
  group.add(fanRing)

  const hub = stampSlot(
    new Mesh(
      new CylinderGeometry(fanRadius * 0.22, fanRadius * 0.22, 0.008, 24),
      materials.applianceInterior,
    ),
    'applianceInterior',
  )
  hub.name = `${name}-convection-fan-hub`
  hub.rotation.x = Math.PI / 2
  hub.position.set(x, y, z + 0.018)
  group.add(hub)

  for (let i = 0; i < 4; i += 1) {
    const blade = stampSlot(
      new Mesh(new BoxGeometry(fanRadius * 0.72, 0.006, 0.003), materials.applianceInterior),
      'applianceInterior',
    )
    blade.name = `${name}-convection-fan-blade-${i}`
    blade.rotation.z = (i * Math.PI) / 2
    blade.position.set(x, y, z + 0.02)
    group.add(blade)
  }

  const element = stampSlot(
    new Mesh(
      new TorusGeometry(Math.min(width, depth) * 0.32, 0.004, 8, 64),
      ovenHeatElementMaterial,
    ),
    'applianceInterior',
  )
  element.name = `${name}-top-heating-element`
  element.rotation.x = Math.PI / 2
  element.scale.y = 0.58
  element.position.set(x, y + height * 0.34, z + depth * 0.2)
  group.add(element)
}

function addMicrowaveDoorMesh(
  leaf: Object3D,
  width: number,
  height: number,
  z: number,
  name: string,
) {
  const columns = 7
  const rows = 5
  const dotSize = Math.max(0.0035, Math.min(width, height) * 0.018)
  const meshWidth = width * 0.7
  const meshHeight = height * 0.55
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const dot = stampSlot(
        new Mesh(new BoxGeometry(dotSize, dotSize, 0.002), microwaveScreenMaterial),
        'glass',
      )
      dot.name = `${name}-window-dot-${row}-${col}`
      dot.position.set(
        -meshWidth / 2 + (meshWidth * col) / (columns - 1),
        -meshHeight / 2 + (meshHeight * row) / (rows - 1),
        z + 0.003,
      )
      leaf.add(dot)
    }
  }
}

function addMicrowaveTurntable(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  z: number,
  radius: number,
  name: string,
) {
  const plate = stampSlot(
    new Mesh(new CylinderGeometry(radius, radius, 0.006, 48), materials.glass),
    'glass',
  )
  plate.name = `${name}-turntable`
  plate.position.set(x, y, z)
  plate.renderOrder = 2
  group.add(plate)

  const ring = stampSlot(
    new Mesh(new TorusGeometry(radius * 0.72, 0.004, 8, 48), materials.applianceInterior),
    'applianceInterior',
  )
  ring.name = `${name}-roller-ring`
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, y - 0.006, z)
  group.add(ring)
}

function addWireRack(
  group: Group,
  materials: CabinetSlotMaterials,
  width: number,
  depth: number,
  y: number,
  zCenter: number,
  name: string,
) {
  const bar = 0.006
  const frame: Array<{ size: [number, number, number]; position: [number, number, number] }> = [
    { size: [width, bar, bar], position: [0, y, zCenter + depth / 2 - bar / 2] },
    { size: [width, bar, bar], position: [0, y, zCenter - depth / 2 + bar / 2] },
    { size: [bar, bar, depth], position: [-width / 2 + bar / 2, y, zCenter] },
    { size: [bar, bar, depth], position: [width / 2 - bar / 2, y, zCenter] },
  ]
  frame.forEach((piece, i) => {
    addBox(
      group,
      piece.size,
      piece.position,
      materials.applianceInterior,
      `${name}-frame-${i}`,
      'applianceInterior',
    )
  })
  for (let i = 1; i <= 7; i++) {
    const x = -width / 2 + (width * i) / 8
    addBox(
      group,
      [0.004, 0.004, Math.max(0.01, depth - bar * 2)],
      [x, y, zCenter],
      materials.applianceInterior,
      `${name}-bar-${i}`,
      'applianceInterior',
    )
  }
}

function addFridgeWireBasket(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  width: number,
  depth: number,
  y: number,
  zCenter: number,
  name: string,
) {
  const bar = 0.006
  const railHeight = 0.07
  const frame: Array<{ size: [number, number, number]; position: [number, number, number] }> = [
    { size: [width, bar, bar], position: [x, y, zCenter + depth / 2 - bar / 2] },
    { size: [width, bar, bar], position: [x, y, zCenter - depth / 2 + bar / 2] },
    {
      size: [bar, railHeight, depth],
      position: [x - width / 2 + bar / 2, y - railHeight / 2, zCenter],
    },
    {
      size: [bar, railHeight, depth],
      position: [x + width / 2 - bar / 2, y - railHeight / 2, zCenter],
    },
  ]
  frame.forEach((piece, i) => {
    addBox(
      group,
      piece.size,
      piece.position,
      refrigeratorLinerAccentMaterial,
      `${name}-frame-${i}`,
      'applianceInterior',
    )
  })
  for (let i = 1; i <= 7; i += 1) {
    const barX = x - width / 2 + (width * i) / 8
    addBox(
      group,
      [0.004, railHeight * 0.82, Math.max(0.01, depth - bar * 2)],
      [barX, y - railHeight / 2, zCenter],
      refrigeratorLinerAccentMaterial,
      `${name}-bar-${i}`,
      'applianceInterior',
    )
  }
}

function addFridgeControlStrip(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const stripWidth = Math.min(0.32, width * 0.72)
  addBox(
    group,
    [stripWidth, 0.028, 0.012],
    [x, y, z],
    refrigeratorLinerAccentMaterial,
    `${name}-control-strip`,
    'applianceInterior',
  )
  const displayWidth = stripWidth * 0.2
  addBox(
    group,
    [displayWidth, 0.014, 0.006],
    [x - stripWidth * 0.26, y, z + 0.008],
    applianceDisplayMaterial,
    `${name}-control-display`,
    'appliance',
  )
  for (let i = 0; i < 5; i += 1) {
    addBox(
      group,
      [0.018, 0.012, 0.006],
      [x - stripWidth * 0.04 + i * 0.026, y, z + 0.008],
      materials.appliance,
      `${name}-control-button-${i}`,
      'appliance',
    )
  }
}

function addFridgeIceMaker(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  depth: number,
  name: string,
) {
  const boxWidth = Math.min(width * 0.72, 0.2)
  const boxHeight = 0.09
  const boxDepth = Math.min(depth * 0.42, 0.16)
  addBox(
    group,
    [boxWidth, boxHeight, boxDepth],
    [x, y, zCenter - depth * 0.22],
    refrigeratorDrawerMaterial,
    `${name}-ice-maker-box`,
    'applianceInterior',
  )
  addBox(
    group,
    [boxWidth * 0.74, 0.014, 0.012],
    [x, y - boxHeight * 0.18, zCenter - depth * 0.22 + boxDepth / 2 + 0.008],
    materials.appliance,
    `${name}-ice-maker-pull`,
    'appliance',
  )
}

function addFridgeVentSlats(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const slatWidth = Math.max(0.04, width * 0.12)
  const gap = slatWidth * 1.35
  for (let i = 0; i < 5; i += 1) {
    const slat = stampSlot(
      new Mesh(new BoxGeometry(slatWidth, 0.005, 0.005), refrigeratorDarkTrimMaterial),
      'appliance',
    )
    slat.name = `${name}-vent-${i}`
    slat.position.set(x - gap * 2 + i * gap, y, z + 0.004)
    group.add(slat)
  }
}

function addFridgeShelfAssembly(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  depth: number,
  name: string,
) {
  const shelfThickness = 0.008
  const rail = 0.008
  addBox(group, [width, shelfThickness, depth], [x, y, zCenter], materials.glass, name, 'glass')
  addBox(
    group,
    [width + rail, rail, rail],
    [x, y + shelfThickness / 2 + rail / 2, zCenter + depth / 2 - rail / 2],
    refrigeratorLinerAccentMaterial,
    `${name}-front-lip`,
    'applianceInterior',
  )
  addBox(
    group,
    [rail, rail, depth],
    [x - width / 2 + rail / 2, y + shelfThickness / 2 + rail / 2, zCenter],
    refrigeratorLinerAccentMaterial,
    `${name}-left-rim`,
    'applianceInterior',
  )
  addBox(
    group,
    [rail, rail, depth],
    [x + width / 2 - rail / 2, y + shelfThickness / 2 + rail / 2, zCenter],
    refrigeratorLinerAccentMaterial,
    `${name}-right-rim`,
    'applianceInterior',
  )
}

function addFridgeShelfRails(
  group: Group,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  depth: number,
  name: string,
) {
  const railWidth = 0.012
  const railHeight = 0.012
  for (const side of [-1, 1]) {
    addBox(
      group,
      [railWidth, railHeight, depth * 0.82],
      [x + side * (width / 2 - railWidth / 2), y - 0.006, zCenter - depth * 0.02],
      refrigeratorLinerAccentMaterial,
      `${name}-${side < 0 ? 'left' : 'right'}-support`,
      'applianceInterior',
    )
  }
}

function addFridgeLinerRibs(
  group: Group,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  height: number,
  depth: number,
  name: string,
) {
  const ribWidth = 0.007
  const ribHeight = Math.max(0.04, height * 0.74)
  const ribDepth = 0.01
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      addBox(
        group,
        [ribWidth, ribHeight, ribDepth],
        [
          x + side * (width / 2 - ribWidth / 2),
          y - height * 0.02,
          zCenter - depth * 0.27 + i * depth * 0.2,
        ],
        refrigeratorLinerAccentMaterial,
        `${name}-${side < 0 ? 'left' : 'right'}-liner-rib-${i}`,
        'applianceInterior',
      )
    }
  }
}

function addFridgeRearDiffuser(
  group: Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  name: string,
) {
  const diffuserWidth = Math.min(0.18, width * 0.42)
  const diffuserHeight = Math.min(0.52, height * 0.46)
  addBox(
    group,
    [diffuserWidth, diffuserHeight, 0.008],
    [x, y + height * 0.08, z],
    refrigeratorLinerAccentMaterial,
    `${name}-rear-diffuser-panel`,
    'applianceInterior',
  )

  const channelWidth = diffuserWidth * 0.72
  for (let i = 0; i < 4; i += 1) {
    addBox(
      group,
      [channelWidth, 0.006, 0.006],
      [x, y + height * 0.22 - i * diffuserHeight * 0.16, z + 0.006],
      refrigeratorLightMaterial,
      `${name}-rear-diffuser-channel-${i}`,
      'applianceInterior',
    )
  }

  addBox(
    group,
    [0.012, diffuserHeight * 0.88, 0.006],
    [x - diffuserWidth / 2 + 0.018, y + height * 0.08, z + 0.006],
    refrigeratorLinerAccentMaterial,
    `${name}-rear-diffuser-left-spine`,
    'applianceInterior',
  )
  addBox(
    group,
    [0.012, diffuserHeight * 0.88, 0.006],
    [x + diffuserWidth / 2 - 0.018, y + height * 0.08, z + 0.006],
    refrigeratorLinerAccentMaterial,
    `${name}-rear-diffuser-right-spine`,
    'applianceInterior',
  )
}

function addFridgeCrisperDrawer(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  height: number,
  depth: number,
  name: string,
) {
  const wall = 0.008
  addBox(
    group,
    [width, height, depth],
    [x, y, zCenter],
    refrigeratorDrawerMaterial,
    name,
    'applianceInterior',
  )
  addBox(
    group,
    [width + wall * 2, wall, depth + wall],
    [x, y + height / 2 + wall / 2, zCenter],
    refrigeratorLinerAccentMaterial,
    `${name}-top-rim`,
    'applianceInterior',
  )
  addBox(
    group,
    [width * 0.72, 0.012, 0.01],
    [x, y + height * 0.12, zCenter + depth / 2 + 0.009],
    materials.appliance,
    `${name}-handle`,
    'appliance',
  )
  addBox(
    group,
    [width * 0.32, 0.004, 0.004],
    [x, y - height * 0.08, zCenter + depth / 2 + 0.014],
    refrigeratorLinerAccentMaterial,
    `${name}-label-plate`,
    'applianceInterior',
  )
  addBox(
    group,
    [width * 0.38, 0.006, 0.005],
    [x, y + height * 0.36, zCenter + depth / 2 + 0.015],
    refrigeratorLinerAccentMaterial,
    `${name}-humidity-track`,
    'applianceInterior',
  )
  addBox(
    group,
    [width * 0.12, 0.012, 0.008],
    [x + width * 0.13, y + height * 0.36, zCenter + depth / 2 + 0.019],
    materials.appliance,
    `${name}-humidity-slider`,
    'appliance',
  )
}

function addFridgeDoorShelf(
  leaf: Group,
  width: number,
  height: number,
  y: number,
  z: number,
  name: string,
  scale = 1,
) {
  const binWidth = Math.max(0.04, width * 0.72 * scale)
  const binDepth = Math.max(0.026, width * 0.09 * scale)
  const lipHeight = Math.max(0.026, height * 0.035 * scale)
  addBox(
    leaf,
    [binWidth, 0.012, binDepth],
    [0, y - lipHeight / 2, z],
    refrigeratorBinMaterial,
    `${name}-base`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [binWidth, lipHeight, 0.012],
    [0, y, z - binDepth / 2],
    refrigeratorBinMaterial,
    name,
    'applianceInterior',
  )
  addBox(
    leaf,
    [0.012, lipHeight * 0.9, binDepth],
    [-binWidth / 2 + 0.006, y - lipHeight * 0.05, z],
    refrigeratorBinMaterial,
    `${name}-left-end`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [0.012, lipHeight * 0.9, binDepth],
    [binWidth / 2 - 0.006, y - lipHeight * 0.05, z],
    refrigeratorBinMaterial,
    `${name}-right-end`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [binWidth * 0.84, 0.008, 0.008],
    [0, y + lipHeight / 2 + 0.014, z - binDepth / 2 - 0.004],
    refrigeratorLinerAccentMaterial,
    `${name}-retainer`,
    'applianceInterior',
  )
}

function addFridgeDoorWireBasket(
  leaf: Group,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  y: number,
  z: number,
  name: string,
) {
  const basketWidth = Math.max(0.04, width * 0.66)
  const basketHeight = Math.max(0.045, height * 0.055)
  const basketDepth = Math.max(0.026, width * 0.08)
  addBox(
    leaf,
    [basketWidth, 0.006, basketDepth],
    [0, y - basketHeight / 2, z],
    refrigeratorLinerAccentMaterial,
    `${name}-base-rail`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [basketWidth, 0.006, 0.006],
    [0, y + basketHeight / 2, z - basketDepth / 2],
    refrigeratorLinerAccentMaterial,
    `${name}-top-rail`,
    'applianceInterior',
  )
  for (let i = 0; i < 6; i += 1) {
    addBox(
      leaf,
      [0.004, basketHeight, 0.004],
      [-basketWidth / 2 + (basketWidth * i) / 5, y, z - basketDepth / 2],
      refrigeratorLinerAccentMaterial,
      `${name}-wire-${i}`,
      'applianceInterior',
    )
  }
}

function addFridgeDoorStorage(
  leaf: Group,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  z: number,
  name: string,
  section: FridgeSection,
) {
  if (section === 'freezer') {
    addBox(
      leaf,
      [width * 0.56, height * 0.055, width * 0.08],
      [0, height * 0.34, z],
      refrigeratorDrawerMaterial,
      `${name}-door-ice-box`,
      'applianceInterior',
    )
    for (let i = 0; i < 4; i += 1) {
      addFridgeDoorWireBasket(
        leaf,
        materials,
        width,
        height,
        height * 0.18 - i * height * 0.18,
        z,
        `${name}-door-wire-bin-${i}`,
      )
    }
    return
  }

  addBox(
    leaf,
    [width * 0.64, height * 0.065, width * 0.09],
    [0, height * 0.32, z],
    refrigeratorDrawerMaterial,
    `${name}-door-dairy-box`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [width * 0.56, 0.01, 0.01],
    [0, height * 0.35, z - width * 0.045],
    refrigeratorLinerAccentMaterial,
    `${name}-door-dairy-cover`,
    'applianceInterior',
  )
  for (let i = 0; i < 3; i += 1) {
    addFridgeDoorShelf(
      leaf,
      width,
      height,
      height * 0.13 - i * height * 0.18,
      z,
      `${name}-door-bin-${i}`,
    )
  }
  addFridgeDoorShelf(leaf, width, height, -height * 0.41, z, `${name}-door-bottle-bin`, 1.12)
}

function addFridgeInterior(
  group: Group,
  materials: CabinetSlotMaterials,
  x: number,
  y: number,
  zCenter: number,
  width: number,
  height: number,
  depth: number,
  name: string,
  section: FridgeSection = 'fresh',
) {
  const shelfWidth = Math.max(0.04, width - 0.06)
  const shelfDepth = Math.max(0.04, depth - 0.08)
  addFridgeLinerRibs(group, x, y, zCenter, width, height, depth, name)
  addFridgeRearDiffuser(group, x, y, zCenter - depth / 2 + 0.018, width, height, name)

  if (section === 'fresh') {
    addFridgeControlStrip(
      group,
      materials,
      x,
      y + height / 2 - 0.055,
      zCenter - depth / 2 + 0.032,
      width,
      name,
    )
  }

  const shelfCount = section === 'freezer' ? 2 : 3
  for (let i = 1; i <= shelfCount; i += 1) {
    const shelfY = y - height / 2 + (height * i) / (shelfCount + 1.6)
    addFridgeShelfRails(group, x, shelfY, zCenter, width, depth, `${name}-${section}-rail-${i}`)
    addFridgeShelfAssembly(
      group,
      materials,
      x,
      shelfY,
      zCenter,
      shelfWidth,
      shelfDepth,
      `${name}-${section}-shelf-${i}`,
    )
  }

  if (section === 'freezer') {
    const basketHeight = Math.min(0.15, height * 0.22)
    addFridgeIceMaker(
      group,
      materials,
      x,
      y + height / 2 - Math.min(0.11, height * 0.16),
      zCenter,
      shelfWidth,
      shelfDepth,
      name,
    )
    addFridgeWireBasket(
      group,
      materials,
      x,
      shelfWidth * 0.86,
      shelfDepth * 0.82,
      y - height / 2 + basketHeight + 0.025,
      zCenter + shelfDepth * 0.05,
      `${name}-freezer-wire-basket`,
    )
    addBox(
      group,
      [shelfWidth * 0.86, basketHeight * 0.54, shelfDepth * 0.82],
      [x, y - height / 2 + basketHeight / 2 + 0.025, zCenter + shelfDepth * 0.05],
      refrigeratorDrawerMaterial,
      `${name}-freezer-basket`,
      'applianceInterior',
    )
    for (let i = 1; i <= 5; i += 1) {
      addBox(
        group,
        [0.004, basketHeight * 0.78, shelfDepth * 0.76],
        [
          x - shelfWidth * 0.34 + (shelfWidth * 0.68 * i) / 6,
          y - height / 2 + basketHeight / 2 + 0.025,
          zCenter + shelfDepth * 0.05,
        ],
        refrigeratorLinerAccentMaterial,
        `${name}-freezer-basket-divider-${i}`,
        'applianceInterior',
      )
    }
    return
  }

  const drawerHeight = Math.min(0.13, height * 0.12)
  const drawerWidth = Math.max(0.04, shelfWidth * 0.42)
  const drawerY = y - height / 2 + drawerHeight / 2 + 0.02
  for (let i = 0; i < 2; i += 1) {
    const drawerX = x + (i === 0 ? -1 : 1) * drawerWidth * 0.58
    addFridgeCrisperDrawer(
      group,
      materials,
      drawerX,
      drawerY,
      zCenter + shelfDepth * 0.08,
      drawerWidth,
      drawerHeight,
      shelfDepth * 0.72,
      `${name}-crisper-drawer-${i}`,
    )
  }

  const deliHeight = Math.min(0.08, height * 0.07)
  addBox(
    group,
    [shelfWidth * 0.86, deliHeight, shelfDepth * 0.66],
    [x, drawerY + drawerHeight / 2 + deliHeight / 2 + 0.025, zCenter + shelfDepth * 0.04],
    refrigeratorDrawerMaterial,
    `${name}-deli-drawer`,
    'applianceInterior',
  )
  addBox(
    group,
    [shelfWidth * 0.68, 0.01, 0.01],
    [x, drawerY + drawerHeight / 2 + deliHeight * 0.62 + 0.025, zCenter + shelfDepth * 0.38],
    materials.appliance,
    `${name}-deli-drawer-handle`,
    'appliance',
  )

  const lamp = stampSlot(
    new Mesh(
      roundedButtonGeometry(Math.min(0.12, width * 0.25), 0.02, 0.012, 0.006),
      refrigeratorLightMaterial,
    ),
    'applianceInterior',
  )
  lamp.name = `${name}-fresh-light`
  lamp.position.set(x, y + height / 2 - 0.04, zCenter - depth / 2 + 0.04)
  group.add(lamp)
}

function addFridgeDoorCues(leaf: Group, width: number, height: number, name: string) {
  const badge = stampSlot(
    new Mesh(
      roundedButtonGeometry(Math.min(0.09, width * 0.24), 0.018, 0.004, 0.004),
      refrigeratorBrassAccentMaterial,
    ),
    'appliance',
  )
  badge.name = `${name}-badge`
  badge.position.set(0, height / 2 - 0.09, 0.025)
  leaf.add(badge)

  if (width < 0.28 || height < 0.72) return

  const dispenserWidth = Math.min(0.16, width * 0.42)
  const dispenserHeight = Math.min(0.24, height * 0.16)
  const dispenser = stampSlot(
    new Mesh(
      roundedButtonGeometry(dispenserWidth, dispenserHeight, 0.01, dispenserWidth * 0.08),
      microwaveScreenMaterial,
    ),
    'appliance',
  )
  dispenser.name = `${name}-water-dispenser`
  dispenser.position.set(0, height * 0.12, 0.03)
  leaf.add(dispenser)

  const spout = stampSlot(
    new Mesh(new BoxGeometry(dispenserWidth * 0.34, 0.012, 0.01), refrigeratorDarkTrimMaterial),
    'appliance',
  )
  spout.name = `${name}-ice-spout`
  spout.position.set(0, height * 0.12 + dispenserHeight * 0.24, 0.039)
  leaf.add(spout)

  const dripTray = stampSlot(
    new Mesh(new BoxGeometry(dispenserWidth * 0.68, 0.012, 0.012), refrigeratorWaterMaterial),
    'appliance',
  )
  dripTray.name = `${name}-blue-drip-tray`
  dripTray.position.set(0, height * 0.12 - dispenserHeight * 0.32, 0.041)
  leaf.add(dripTray)
}

function addFridgeLeaf(
  group: Group,
  materials: CabinetSlotMaterials,
  width: number,
  height: number,
  hinge: 'left' | 'right',
  centerX: number,
  centerY: number,
  frontZ: number,
  name: string,
  section: FridgeSection,
  openScale: number,
) {
  const hingeGroup = new Group()
  hingeGroup.name = `${name}-hinge`
  hingeGroup.position.set(
    hinge === 'left' ? centerX - width / 2 : centerX + width / 2,
    centerY,
    frontZ,
  )
  hingeGroup.rotation.y = (hinge === 'left' ? -1 : 1) * (Math.PI * 0.62) * openScale
  hingeGroup.userData.cabinetPose = {
    type: 'rotate',
    axis: 'y',
    angle: (hinge === 'left' ? -1 : 1) * (Math.PI * 0.62),
  }
  group.add(hingeGroup)

  const leaf = new Group()
  leaf.name = name
  leaf.position.set(hinge === 'left' ? width / 2 : -width / 2, 0, 0)
  hingeGroup.add(leaf)

  const panel = stampSlot(
    new Mesh(
      roundedButtonGeometry(width, height, 0.026, Math.min(width, height) * 0.035),
      refrigeratorSilverMaterial,
    ),
    'appliance',
  )
  panel.name = `${name}-panel`
  panel.castShadow = true
  panel.receiveShadow = true
  leaf.add(panel)

  const inset = Math.max(0.012, Math.min(width, height) * 0.025)
  addBox(
    leaf,
    [width - inset * 2, Math.max(0.01, height - inset * 2), 0.006],
    [0, 0, 0.017],
    materials.appliance,
    `${name}-brushed-center`,
    'appliance',
  )
  addFridgeDoorCues(leaf, width, height, name)

  const gasketWidth = Math.max(0.008, Math.min(width, height) * 0.018)
  addBox(
    leaf,
    [width, gasketWidth, 0.011],
    [0, height / 2 - gasketWidth / 2, -0.017],
    refrigeratorSealMaterial,
    `${name}-gasket-top`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [width, gasketWidth, 0.011],
    [0, -height / 2 + gasketWidth / 2, -0.017],
    refrigeratorSealMaterial,
    `${name}-gasket-bottom`,
    'applianceInterior',
  )
  addBox(
    leaf,
    [gasketWidth, height, 0.011],
    [hinge === 'left' ? -width / 2 + gasketWidth / 2 : width / 2 - gasketWidth / 2, 0, -0.017],
    refrigeratorSealMaterial,
    `${name}-gasket-hinge`,
    'applianceInterior',
  )

  addApplianceHandle(
    leaf,
    refrigeratorBrassAccentMaterial,
    [(hinge === 'left' ? 1 : -1) * (width / 2 - 0.04), 0, 0.018],
    Math.min(0.72, height * 0.58),
    true,
    `${name}-handle`,
  )

  const hingeCapX = (hinge === 'left' ? -1 : 1) * (width / 2 - 0.03)
  for (const [capKey, capY] of [
    ['top', height / 2 - 0.012],
    ['bottom', -height / 2 + 0.012],
  ] as const) {
    addBox(
      leaf,
      [0.05, 0.018, 0.02],
      [hingeCapX, capY, 0.02],
      refrigeratorBrassAccentMaterial,
      `${name}-hinge-cap-${capKey}`,
      'appliance',
    )
  }
  addFridgeDoorStorage(leaf, materials, width, height, -0.035, name, section)
}

function fridgeDoorLayout(
  kind: CabinetFridgeCompartmentType,
  faceHeight: number,
): Array<{
  key: string
  y: number
  height: number
  widthFraction: number
  hinge: 'left' | 'right'
  xFraction: number
  section: FridgeSection
}> {
  if (kind === 'fridge-double') {
    return [
      {
        key: 'left',
        y: 0,
        height: faceHeight,
        widthFraction: 0.5,
        hinge: 'left',
        xFraction: -0.25,
        section: 'freezer',
      },
      {
        key: 'right',
        y: 0,
        height: faceHeight,
        widthFraction: 0.5,
        hinge: 'right',
        xFraction: 0.25,
        section: 'fresh',
      },
    ]
  }
  if (kind === 'fridge-top-freezer') {
    const freezerHeight = faceHeight * 0.34
    const fridgeHeight = faceHeight - freezerHeight
    return [
      {
        key: 'freezer',
        y: faceHeight / 2 - freezerHeight / 2,
        height: freezerHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'freezer',
      },
      {
        key: 'fresh',
        y: -faceHeight / 2 + fridgeHeight / 2,
        height: fridgeHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'fresh',
      },
    ]
  }
  if (kind === 'fridge-bottom-freezer') {
    const freezerHeight = faceHeight * 0.32
    const fridgeHeight = faceHeight - freezerHeight
    return [
      {
        key: 'fresh',
        y: faceHeight / 2 - fridgeHeight / 2,
        height: fridgeHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'fresh',
      },
      {
        key: 'freezer',
        y: -faceHeight / 2 + freezerHeight / 2,
        height: freezerHeight,
        widthFraction: 1,
        hinge: 'right',
        xFraction: 0,
        section: 'freezer',
      },
    ]
  }
  return [
    {
      key: 'single',
      y: 0,
      height: faceHeight,
      widthFraction: 1,
      hinge: 'right',
      xFraction: 0,
      section: 'fresh',
    },
  ]
}

function addFridgeCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  kind: CabinetFridgeCompartmentType,
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  index: number,
) {
  const name = `cabinet-${kind}-${index}`
  const wall = Math.max(0.018, node.boardThickness)
  const shellInsetX = Math.max(0.04, Math.min(0.06, faceWidth * 0.065))
  const shellWidth = Math.max(0.05, faceWidth - shellInsetX * 2)
  const topClearance = node.boardThickness + 0.055
  const bottomClearance = Math.max(0.026, node.boardThickness * 0.85)
  const shellFaceHeight = Math.max(0.05, faceHeight - topClearance - bottomClearance)
  const shellCenterY = faceCenterY + (bottomClearance - topClearance) / 2
  const applianceFrontInset = Math.max(0.036, node.frontThickness + 0.018)
  const shellFrontZ = frontZ - applianceFrontInset
  const interiorDepth = Math.max(0.08, Math.min(0.56, openingDepth - 0.11))
  const cavityFrontZ = shellFrontZ - 0.012
  const cavityBackZ = cavityFrontZ - interiorDepth
  const cavityCenterZ = cavityBackZ + interiorDepth / 2
  const shellDepth = Math.max(0.12, Math.min(node.depth * 0.78, openingDepth - 0.085))
  const shellCenterZ = shellFrontZ - shellDepth / 2
  const shellSide = Math.max(0.018, Math.min(0.032, shellWidth * 0.04))
  const capHeight = Math.max(0.018, Math.min(0.04, faceHeight * 0.025))
  const kickHeight = Math.max(0.045, Math.min(0.075, faceHeight * 0.045))
  const seamGap = Math.max(0.0025, node.frontGap)
  const shellTopY = shellCenterY + shellFaceHeight / 2
  const shellBottomY = shellCenterY - shellFaceHeight / 2
  const sideTopY = shellTopY - capHeight - seamGap
  const sideBottomY = shellBottomY + kickHeight + seamGap
  const shellSideHeight = Math.max(0.05, sideTopY - sideBottomY)
  const shellSideCenterY = (sideTopY + sideBottomY) / 2
  const cavityOuterTopY = sideTopY - seamGap
  const cavityOuterBottomY = sideBottomY + seamGap
  const cavityOuterHeight = Math.max(0.05, cavityOuterTopY - cavityOuterBottomY)
  const cavityShellCenterY = (cavityOuterTopY + cavityOuterBottomY) / 2
  const interiorWidth = Math.max(
    0.05,
    Math.min(openingWidth, shellWidth) - shellSide * 2 - wall * 2,
  )
  const interiorHeight = Math.max(0.05, cavityOuterHeight - wall * 2)

  addBox(
    group,
    [shellSide, shellSideHeight, shellDepth],
    [-shellWidth / 2 + shellSide / 2, shellSideCenterY, shellCenterZ],
    materials.appliance,
    `${name}-appliance-side-left`,
    'appliance',
  )
  addBox(
    group,
    [shellSide, shellSideHeight, shellDepth],
    [shellWidth / 2 - shellSide / 2, shellSideCenterY, shellCenterZ],
    materials.appliance,
    `${name}-appliance-side-right`,
    'appliance',
  )
  addBox(
    group,
    [shellWidth, capHeight, shellDepth],
    [0, shellCenterY + shellFaceHeight / 2 - capHeight / 2, shellCenterZ],
    materials.appliance,
    `${name}-appliance-top-cap`,
    'appliance',
  )
  addBox(
    group,
    [shellWidth, kickHeight, shellDepth],
    [0, shellCenterY - shellFaceHeight / 2 + kickHeight / 2, shellCenterZ],
    refrigeratorDarkTrimMaterial,
    `${name}-appliance-toe-grille`,
    'appliance',
  )

  addBox(
    group,
    [interiorWidth + wall * 2, interiorHeight + wall * 2, wall],
    [0, cavityShellCenterY, cavityBackZ + wall / 2],
    refrigeratorLinerMaterial,
    `${name}-cavity-back`,
    'applianceInterior',
  )
  addBox(
    group,
    [interiorWidth + wall * 2, wall, interiorDepth],
    [0, cavityShellCenterY + interiorHeight / 2 + wall / 2, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-top`,
    'applianceInterior',
  )
  addBox(
    group,
    [interiorWidth + wall * 2, wall, interiorDepth],
    [0, cavityShellCenterY - interiorHeight / 2 - wall / 2, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-bottom`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, interiorHeight, interiorDepth],
    [-interiorWidth / 2 - wall / 2, cavityShellCenterY, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-left`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, interiorHeight, interiorDepth],
    [interiorWidth / 2 + wall / 2, cavityShellCenterY, cavityCenterZ],
    refrigeratorLinerMaterial,
    `${name}-cavity-right`,
    'applianceInterior',
  )
  const interiorRows = fridgeDoorLayout(kind, cavityOuterHeight - node.frontGap * 2)
  const layoutRows = fridgeDoorLayout(kind, shellFaceHeight - node.frontGap * 2)
  if (kind === 'fridge-double') {
    addBox(
      group,
      [wall, interiorHeight, interiorDepth],
      [0, cavityShellCenterY, cavityCenterZ],
      refrigeratorLinerMaterial,
      `${name}-center-divider`,
      'applianceInterior',
    )
  } else if (kind === 'fridge-top-freezer' || kind === 'fridge-bottom-freezer') {
    const divider = interiorRows.find((row) => row.key === 'freezer')
    if (divider) {
      const dividerY =
        kind === 'fridge-top-freezer'
          ? cavityShellCenterY + cavityOuterHeight / 2 - divider.height - node.frontGap
          : cavityShellCenterY - cavityOuterHeight / 2 + divider.height + node.frontGap
      addBox(
        group,
        [interiorWidth, wall, interiorDepth],
        [0, dividerY, cavityCenterZ],
        refrigeratorLinerMaterial,
        `${name}-horizontal-divider`,
        'applianceInterior',
      )
    }
  }

  for (const layout of interiorRows) {
    const sectionWidth = Math.max(0.05, interiorWidth * layout.widthFraction - wall)
    const sectionHeight = Math.max(0.05, layout.height - wall * 1.4)
    const sectionX = interiorWidth * layout.xFraction
    const sectionY = cavityShellCenterY + layout.y
    addFridgeInterior(
      group,
      materials,
      sectionX,
      sectionY,
      cavityCenterZ,
      sectionWidth,
      sectionHeight,
      interiorDepth,
      `${name}-${layout.key}`,
      layout.section,
    )
  }
  addFridgeVentSlats(
    group,
    0,
    shellCenterY - shellFaceHeight / 2 + 0.04,
    shellFrontZ + 0.01,
    shellWidth,
    name,
  )

  const doorGap = node.frontGap
  for (const layout of layoutRows) {
    const doorWidth = Math.max(0.01, shellWidth * layout.widthFraction - doorGap * 2)
    const doorHeight = Math.max(0.01, layout.height - doorGap * 2)
    const doorCenterX = shellWidth * layout.xFraction
    const doorCenterY = shellCenterY + layout.y
    addFridgeLeaf(
      group,
      materials,
      doorWidth,
      doorHeight,
      layout.hinge,
      doorCenterX,
      doorCenterY,
      frontZ,
      `${name}-door-${layout.key}`,
      layout.section,
      node.operationState ?? 0,
    )
  }
}

function addApplianceCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  kind: 'oven' | 'microwave',
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  index: number,
) {
  const name = `cabinet-${kind}-${index}`
  const gap = node.frontGap
  const frontThickness = node.frontThickness
  const fasciaFrontZ = frontZ + frontThickness / 2

  let doorWidth: number
  let doorHeight: number
  let doorCenterX: number
  let doorCenterY: number

  if (kind === 'oven') {
    const fasciaHeight = Math.min(0.08, faceHeight * 0.18)
    const fasciaY = faceCenterY + faceHeight / 2 - fasciaHeight / 2
    addBox(
      group,
      [faceWidth, fasciaHeight, frontThickness],
      [0, fasciaY, frontZ],
      materials.appliance,
      `${name}-fascia`,
      'appliance',
    )
    addOvenControls(group, 0, fasciaY, fasciaFrontZ, faceWidth, fasciaHeight, name)

    doorWidth = faceWidth
    doorHeight = Math.max(0.01, faceHeight - fasciaHeight - gap)
    doorCenterX = 0
    doorCenterY = faceCenterY - faceHeight / 2 + doorHeight / 2
  } else {
    const fasciaWidth = Math.min(0.15, faceWidth * 0.28)
    const fasciaCenterX = faceWidth / 2 - fasciaWidth / 2
    addBox(
      group,
      [fasciaWidth, faceHeight, frontThickness],
      [fasciaCenterX, faceCenterY, frontZ],
      materials.appliance,
      `${name}-fascia`,
      'appliance',
    )
    addMicrowaveVentSlats(
      group,
      fasciaCenterX,
      faceCenterY + faceHeight / 2 - 0.017,
      fasciaFrontZ,
      fasciaWidth,
      `${name}-top`,
    )
    addMicrowaveControls(
      group,
      fasciaCenterX,
      faceCenterY,
      fasciaFrontZ,
      fasciaWidth,
      faceHeight,
      name,
    )
    addMicrowaveVentSlats(
      group,
      fasciaCenterX,
      faceCenterY - faceHeight / 2 + 0.046,
      fasciaFrontZ,
      fasciaWidth,
      `${name}-bottom`,
    )

    doorWidth = Math.max(0.01, faceWidth - fasciaWidth - gap)
    doorHeight = faceHeight
    doorCenterX = -faceWidth / 2 + doorWidth / 2
    doorCenterY = faceCenterY
  }

  const wall = APPLIANCE_CAVITY_WALL
  const cavityWidth = Math.max(0.05, Math.min(doorWidth, openingWidth) - wall * 2)
  const cavityHeight = Math.max(0.05, doorHeight - wall * 2)
  const cavityFrontZ = frontZ - frontThickness / 2 - 0.001
  const cavityDepth = Math.max(0.05, Math.min(0.55, openingDepth - 0.04))
  const cavityBackZ = cavityFrontZ - cavityDepth
  const cavityCenterZ = cavityBackZ + cavityDepth / 2

  addBox(
    group,
    [cavityWidth + wall * 2, cavityHeight + wall * 2, wall],
    [doorCenterX, doorCenterY, cavityBackZ + wall / 2],
    materials.applianceInterior,
    `${name}-cavity-back`,
    'applianceInterior',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, cavityDepth],
    [doorCenterX, doorCenterY + cavityHeight / 2 + wall / 2, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-top`,
    'applianceInterior',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, cavityDepth],
    [doorCenterX, doorCenterY - cavityHeight / 2 - wall / 2, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-bottom`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, cavityHeight, cavityDepth],
    [doorCenterX - cavityWidth / 2 - wall / 2, doorCenterY, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-left`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, cavityHeight, cavityDepth],
    [doorCenterX + cavityWidth / 2 + wall / 2, doorCenterY, cavityCenterZ],
    materials.applianceInterior,
    `${name}-cavity-right`,
    'applianceInterior',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, frontThickness],
    [doorCenterX, doorCenterY + cavityHeight / 2 + wall / 2, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-top`,
    'appliance',
  )
  addBox(
    group,
    [cavityWidth + wall * 2, wall, frontThickness],
    [doorCenterX, doorCenterY - cavityHeight / 2 - wall / 2, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-bottom`,
    'appliance',
  )
  addBox(
    group,
    [wall, cavityHeight, frontThickness],
    [doorCenterX - cavityWidth / 2 - wall / 2, doorCenterY, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-left`,
    'appliance',
  )
  addBox(
    group,
    [wall, cavityHeight, frontThickness],
    [doorCenterX + cavityWidth / 2 + wall / 2, doorCenterY, cavityFrontZ],
    materials.appliance,
    `${name}-cavity-lip-right`,
    'appliance',
  )

  const lamp = stampSlot(
    new Mesh(new BoxGeometry(0.05, 0.008, 0.02), applianceLampMaterial),
    'applianceInterior',
  )
  lamp.name = `${name}-lamp`
  lamp.position.set(doorCenterX, doorCenterY + cavityHeight / 2 - 0.012, cavityBackZ + 0.06)
  group.add(lamp)

  const rackWidth = Math.max(0.02, cavityWidth - 0.01)
  const rackDepth = Math.max(0.02, cavityDepth - 0.04)
  if (kind === 'oven') {
    for (const fraction of [1 / 3, 2 / 3]) {
      addWireRack(
        group,
        materials,
        rackWidth,
        rackDepth,
        doorCenterY - cavityHeight / 2 + cavityHeight * fraction,
        cavityCenterZ,
        `${name}-rack-${fraction < 0.5 ? 0 : 1}`,
      )
    }
    addOvenInteriorDetails(
      group,
      materials,
      doorCenterX,
      doorCenterY,
      cavityBackZ,
      cavityWidth,
      cavityHeight,
      cavityDepth,
      name,
    )
  } else {
    addMicrowaveTurntable(
      group,
      materials,
      doorCenterX,
      doorCenterY - cavityHeight / 2 + 0.028,
      cavityCenterZ,
      Math.min(rackWidth, rackDepth) * 0.28,
      name,
    )
  }

  const hingeGroup = new Group()
  hingeGroup.name = `${name}-door-hinge`
  if (kind === 'oven') {
    hingeGroup.position.set(doorCenterX, doorCenterY - doorHeight / 2, frontZ)
    hingeGroup.rotation.x = OVEN_OPEN_ANGLE * (node.operationState ?? 0)
    hingeGroup.userData.cabinetPose = { type: 'rotate', axis: 'x', angle: OVEN_OPEN_ANGLE }
  } else {
    hingeGroup.position.set(doorCenterX - doorWidth / 2, doorCenterY, frontZ)
    hingeGroup.rotation.y = -(Math.PI / 2) * (node.operationState ?? 0)
    hingeGroup.userData.cabinetPose = { type: 'rotate', axis: 'y', angle: -(Math.PI / 2) }
  }
  group.add(hingeGroup)

  const leaf = new Group()
  leaf.name = `${name}-door`
  leaf.position.set(kind === 'oven' ? 0 : doorWidth / 2, kind === 'oven' ? doorHeight / 2 : 0, 0)
  hingeGroup.add(leaf)

  const frame =
    kind === 'oven'
      ? Math.max(0.022, Math.min(0.042, Math.min(doorWidth, doorHeight) * 0.075))
      : Math.max(0.03, Math.min(doorWidth, doorHeight) * 0.14)
  const glassWidth = Math.max(0.01, doorWidth - frame * 2)
  const glassHeight = Math.max(0.01, doorHeight - frame * 2)
  addBox(
    leaf,
    [doorWidth, frame, frontThickness],
    [0, doorHeight / 2 - frame / 2, 0],
    materials.appliance,
    `${name}-door-frame-top`,
    'appliance',
  )
  addBox(
    leaf,
    [doorWidth, frame, frontThickness],
    [0, -doorHeight / 2 + frame / 2, 0],
    materials.appliance,
    `${name}-door-frame-bottom`,
    'appliance',
  )
  addBox(
    leaf,
    [frame, glassHeight, frontThickness],
    [-doorWidth / 2 + frame / 2, 0, 0],
    materials.appliance,
    `${name}-door-frame-left`,
    'appliance',
  )
  addBox(
    leaf,
    [frame, glassHeight, frontThickness],
    [doorWidth / 2 - frame / 2, 0, 0],
    materials.appliance,
    `${name}-door-frame-right`,
    'appliance',
  )
  const glassMesh = stampSlot(
    new Mesh(
      new BoxGeometry(glassWidth, glassHeight, Math.max(0.003, frontThickness * 0.5)),
      materials.glass,
    ),
    'glass',
  )
  glassMesh.name = `${name}-door-glass`
  glassMesh.position.set(0, 0, 0)
  glassMesh.renderOrder = 2
  leaf.add(glassMesh)
  if (kind === 'microwave') {
    addMicrowaveDoorMesh(leaf, glassWidth, glassHeight, frontThickness / 2, name)
  } else {
    addOvenDoorDetails(
      leaf,
      materials,
      doorWidth,
      doorHeight,
      glassWidth,
      glassHeight,
      frontThickness,
      name,
    )
  }

  if (kind === 'oven') {
    addApplianceHandle(
      leaf,
      materials.appliance,
      [0, doorHeight / 2 - 0.035, frontThickness / 2],
      doorWidth * 0.85,
      false,
      `${name}-handle`,
    )
  } else {
    addApplianceHandle(
      leaf,
      materials.appliance,
      [doorWidth / 2 - 0.035, 0, frontThickness / 2],
      Math.min(0.35, doorHeight * 0.55),
      true,
      `${name}-handle`,
    )
  }
}

const GAS_HOB_BURNER_RADIUS = 0.052
type CooktopBurnerSpec = { x: number; z: number; size: number }
const GAS_HOB_BURNER_LAYOUTS: Record<
  Extract<CooktopLayout, 'gas-2burner' | 'gas-4burner' | 'gas-5burner-wok' | 'gas-6burner'>,
  CooktopBurnerSpec[]
> = {
  'gas-2burner': [
    { x: -0.11, z: 0, size: 1 },
    { x: 0.11, z: 0, size: 1 },
  ],
  'gas-4burner': [
    { x: -0.144, z: -0.096, size: 1 },
    { x: -0.144, z: 0.096, size: 0.85 },
    { x: 0.144, z: -0.096, size: 0.85 },
    { x: 0.144, z: 0.096, size: 1 },
  ],
  'gas-5burner-wok': [
    { x: -0.24, z: -0.11, size: 0.85 },
    { x: 0.24, z: -0.11, size: 1 },
    { x: -0.24, z: 0.11, size: 1 },
    { x: 0.24, z: 0.11, size: 0.85 },
    { x: 0, z: 0, size: 1.5 },
  ],
  'gas-6burner': [
    { x: -0.3, z: -0.11, size: 1 },
    { x: 0, z: -0.11, size: 0.85 },
    { x: 0.3, z: -0.11, size: 1 },
    { x: -0.3, z: 0.11, size: 0.85 },
    { x: 0, z: 0.11, size: 1 },
    { x: 0.3, z: 0.11, size: 0.85 },
  ],
}
type InductionZoneSpec = { x: number; z: number; radius: number; w?: number; d?: number }
const INDUCTION_ZONE_LAYOUTS: Record<
  Extract<CooktopLayout, 'induction-2zone' | 'induction-4zone'>,
  InductionZoneSpec[]
> = {
  'induction-2zone': [
    { x: -0.13, z: 0, radius: 0.072 },
    { x: 0.13, z: 0, radius: 0.072 },
  ],
  'induction-4zone': [
    { x: -0.18, z: 0.108, radius: 0.066 },
    { x: 0.18, z: 0.108, radius: 0.054 },
    { x: -0.18, z: -0.108, radius: 0.054 },
    { x: 0.18, z: -0.108, radius: 0.066 },
  ],
}
function gasHobBurners(layout: CooktopLayout): CooktopBurnerSpec[] {
  return layout in GAS_HOB_BURNER_LAYOUTS
    ? GAS_HOB_BURNER_LAYOUTS[
        layout as Extract<
          CooktopLayout,
          'gas-2burner' | 'gas-4burner' | 'gas-5burner-wok' | 'gas-6burner'
        >
      ]
    : GAS_HOB_BURNER_LAYOUTS['gas-5burner-wok']
}

function inductionZones(layout: CooktopLayout): InductionZoneSpec[] {
  return layout in INDUCTION_ZONE_LAYOUTS
    ? INDUCTION_ZONE_LAYOUTS[
        layout as Extract<CooktopLayout, 'induction-2zone' | 'induction-4zone'>
      ]
    : INDUCTION_ZONE_LAYOUTS['induction-4zone']
}

function addCooktopFrameBorder(
  group: Group,
  name: string,
  width: number,
  depth: number,
  y: number,
) {
  const t = 0.014
  const h = 0.012
  addBox(
    group,
    [width, h, t],
    [0, y, -depth / 2 + t / 2],
    cooktopTrimMaterial,
    `${name}-frame-back`,
    'appliance',
  )
  addBox(
    group,
    [width, h, t],
    [0, y, depth / 2 - t / 2],
    cooktopTrimMaterial,
    `${name}-frame-front`,
    'appliance',
  )
  addBox(
    group,
    [t, h, depth - 2 * t],
    [-width / 2 + t / 2, y, 0],
    cooktopTrimMaterial,
    `${name}-frame-left`,
    'appliance',
  )
  addBox(
    group,
    [t, h, depth - 2 * t],
    [width / 2 - t / 2, y, 0],
    cooktopTrimMaterial,
    `${name}-frame-right`,
    'appliance',
  )
}

function addGasHobBurner(
  group: Group,
  name: string,
  center: [number, number, number],
  size: number,
  burnerIndex: number,
  active: boolean,
  progress: number,
) {
  const r = GAS_HOB_BURNER_RADIUS * size
  const [x, y, z] = center
  const base = stampSlot(
    new Mesh(new CylinderGeometry(r, r * 1.1, 0.012, 28), cooktopBurnerMaterial),
    'appliance',
  )
  base.name = `${name}-burner-${burnerIndex}-base`
  base.position.set(x, y, z)
  base.castShadow = true
  base.receiveShadow = true
  group.add(base)

  const ring = stampSlot(
    new Mesh(new TorusGeometry(r * 0.72, 0.011, 10, 30), cooktopGrateMaterial),
    'appliance',
  )
  ring.name = `${name}-burner-${burnerIndex}-ring`
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, y + 0.012, z)
  ring.castShadow = true
  group.add(ring)

  const cap = stampSlot(
    new Mesh(new CylinderGeometry(r * 0.48, r * 0.6, 0.012, 24), cooktopGrateMaterial),
    'hardware',
  )
  cap.name = `${name}-burner-${burnerIndex}-cap`
  cap.position.set(x, y + 0.017, z)
  cap.castShadow = true
  group.add(cap)

  if (active || progress > 0.04) {
    addCooktopCurvedFlames(group, name, x, y, z, r, burnerIndex, progress)
  }
}

function addContinuousCooktopGrate(
  group: Group,
  name: string,
  width: number,
  depth: number,
  y: number,
  burners: CooktopBurnerSpec[],
) {
  const t = 0.011
  const bar = 0.008
  addBox(
    group,
    [width, bar, t],
    [0, y, -depth / 2 + t / 2],
    cooktopGrateMaterial,
    `${name}-continuous-grate-back`,
    'appliance',
  )
  addBox(
    group,
    [width, bar, t],
    [0, y, depth / 2 - t / 2],
    cooktopGrateMaterial,
    `${name}-continuous-grate-front`,
    'appliance',
  )
  addBox(
    group,
    [t, bar, depth],
    [-width / 2 + t / 2, y, 0],
    cooktopGrateMaterial,
    `${name}-continuous-grate-left`,
    'appliance',
  )
  addBox(
    group,
    [t, bar, depth],
    [width / 2 - t / 2, y, 0],
    cooktopGrateMaterial,
    `${name}-continuous-grate-right`,
    'appliance',
  )

  const rowZs = [...new Set(burners.map((burner) => Number(burner.z.toFixed(3))))].sort(
    (a, b) => a - b,
  )
  const colXs = [...new Set(burners.map((burner) => Number(burner.x.toFixed(3))))].sort(
    (a, b) => a - b,
  )
  for (let i = 0; i < rowZs.length - 1; i += 1) {
    addBox(
      group,
      [width, bar, t],
      [0, y, (rowZs[i]! + rowZs[i + 1]!) / 2],
      cooktopGrateMaterial,
      `${name}-continuous-grate-row-${i}`,
      'appliance',
    )
  }
  for (let i = 0; i < colXs.length - 1; i += 1) {
    addBox(
      group,
      [t, bar, depth],
      [(colXs[i]! + colXs[i + 1]!) / 2, y, 0],
      cooktopGrateMaterial,
      `${name}-continuous-grate-column-${i}`,
      'appliance',
    )
  }
}

function createCooktopFlameMaterial(color: string, opacity: number) {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
}

function createCooktopFlameBodyMaterial() {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
}

function addCooktopCurvedFlames(
  group: Group,
  name: string,
  x: number,
  y: number,
  z: number,
  radius: number,
  burnerIndex: number,
  progress: number,
) {
  const flameRoot = new Group()
  flameRoot.name = `${name}-burner-${burnerIndex}-flames`
  flameRoot.position.set(x, y + 0.028, z)
  flameRoot.userData.cabinetFlameRoot = { progress }
  flameRoot.scale.setScalar(Math.max(0.18, progress))
  group.add(flameRoot)

  // Faint heat shimmer only — anything stronger reads as a solid dome that
  // hides the flames inside it.
  const halo = stampSlot(
    new Mesh(
      new SphereGeometry(radius * 1.08, 14, 10),
      createCooktopFlameMaterial('#ff7a3a', 0.05),
    ),
    'appliance',
  )
  halo.name = `${name}-burner-${burnerIndex}-flame-halo`
  halo.userData.cabinetFlamePulse = { phase: 0.2, amplitude: 0.05, base: 1 }
  halo.userData.cabinetFlameMaterialPulse = { phase: 1.1, base: 0.05, amplitude: 0.015 }
  flameRoot.add(halo)

  // Flat ignition glow lapping the burner crown (not a torus — reads as the
  // hot ring at the base of the flames in reference photos).
  const ring = stampSlot(
    new Mesh(
      new RingGeometry(radius * 0.25, radius * 0.95, 32),
      createCooktopFlameMaterial('#ff8838', 0.6),
    ),
    'appliance',
  )
  ring.name = `${name}-burner-${burnerIndex}-flame-ring`
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.001
  ring.userData.cabinetFlameMaterialPulse = { phase: 1.7, base: 0.55, amplitude: 0.1 }
  flameRoot.add(ring)

  const core = stampSlot(
    new Mesh(new SphereGeometry(radius * 0.34, 14, 10), createCooktopFlameMaterial('#7eb8ff', 0.6)),
    'appliance',
  )
  core.name = `${name}-burner-${burnerIndex}-flame-core`
  core.position.y = 0.022
  core.userData.cabinetFlamePulse = { phase: 0.8, amplitude: 0.08, base: 0.95 }
  core.userData.cabinetFlameMaterialPulse = { phase: 0.8, base: 0.55, amplitude: 0.08 }
  flameRoot.add(core)

  for (let flameIndex = 0; flameIndex < COOKTOP_FLAME_COUNT; flameIndex += 1) {
    const angle = (Math.PI * 2 * flameIndex) / COOKTOP_FLAME_COUNT
    const seed = cooktopFlameSeed(flameIndex)
    const flameGroup = new Group()
    flameGroup.name = `${name}-burner-${burnerIndex}-flame-${flameIndex}`
    flameGroup.position.set(Math.cos(angle) * radius * 0.55, 0, Math.sin(angle) * radius * 0.55)
    flameGroup.rotation.y = -angle

    const geometry = createCooktopFlameGeometry()
    const positions = geometry.getAttribute('position') as Float32BufferAttribute
    // Bake a resting pose so static builds (tests, screenshots) show flames
    // even before the animation system's first tick.
    updateCooktopFlameTube(positions.array as Float32Array, 0, seed, radius)
    const body = stampSlot(new Mesh(geometry, createCooktopFlameBodyMaterial()), 'appliance')
    body.name = `${name}-burner-${burnerIndex}-flame-${flameIndex}-body`
    body.userData.cabinetFlameJet = { seed, burnerR: radius }
    flameGroup.add(body)

    flameRoot.add(flameGroup)
  }
}

function addInductionZone(
  group: Group,
  name: string,
  zone: InductionZoneSpec,
  y: number,
  zoneIndex: number,
  active: boolean,
) {
  const material = active ? cooktopInductionActiveZoneMaterial : cooktopInductionZoneMaterial
  if (zone.w && zone.d) {
    addBox(
      group,
      [zone.w, 0.002, zone.d],
      [zone.x, y, zone.z],
      material,
      `${name}-zone-${zoneIndex}-flex-pad`,
      'appliance',
    )
  }

  const fill = stampSlot(
    new Mesh(new CylinderGeometry(zone.radius * 0.92, zone.radius * 0.92, 0.002, 64), material),
    'appliance',
  )
  fill.name = `${name}-zone-${zoneIndex}-fill`
  fill.position.set(zone.x, y + 0.001, zone.z)
  group.add(fill)

  for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
    const ring = stampSlot(
      new Mesh(new TorusGeometry(zone.radius * (1 - ringIndex * 0.24), 0.0022, 8, 72), material),
      'appliance',
    )
    ring.name = `${name}-zone-${zoneIndex}-ring-${ringIndex}`
    ring.rotation.x = Math.PI / 2
    ring.position.set(zone.x, y + 0.003 + ringIndex * 0.0006, zone.z)
    group.add(ring)
  }
}

function addCooktopCompartment(
  group: Group,
  node: CabinetGeometryNode,
  compartment: CabinetCompartment,
  type: CabinetCooktopCompartmentType,
  topY: number,
  index: number,
) {
  const layout = compartmentCooktopLayout(compartment, type)
  const activeBurners = new Set(compartmentCooktopActiveBurners(compartment, type))
  const knobProgress = compartmentCooktopKnobProgress(compartment, type)
  const burnersOn = activeBurners.size > 0 || compartmentCooktopBurnersOn(compartment)
  const name =
    type === 'cooktop-gas' ? `cabinet-cooktop-gas-${index}` : `cabinet-cooktop-induction-${index}`
  const frameWidth = Math.max(0.32, Math.min(node.width - 0.01, 0.76))
  const frameDepth = Math.max(0.28, Math.min(node.depth - 0.04, 0.53))
  const surfaceWidth = Math.max(0.28, frameWidth - 0.026)
  const surfaceDepth = Math.max(0.24, frameDepth - 0.026)
  const surfaceThickness = 0.012
  const surfaceY = topY + surfaceThickness / 2 - 0.002
  addCooktopFrameBorder(group, name, frameWidth, frameDepth, topY + 0.006)
  const surface = stampSlot(
    new Mesh(new BoxGeometry(surfaceWidth, surfaceThickness, surfaceDepth), cooktopGlassMaterial),
    'appliance',
  )
  surface.name = `${name}-surface`
  surface.position.set(0, surfaceY, 0)
  surface.castShadow = true
  surface.receiveShadow = true
  group.add(surface)

  if (type === 'cooktop-gas') {
    const burners = gasHobBurners(layout)
    burners.forEach((burner, burnerIndex) => {
      const progress = knobProgress[burnerIndex] ?? (activeBurners.has(burnerIndex) ? 1 : 0)
      addGasHobBurner(
        group,
        name,
        [burner.x, topY + surfaceThickness + 0.004, burner.z],
        burner.size,
        burnerIndex,
        activeBurners.has(burnerIndex),
        progress,
      )
    })
    if (compartmentCooktopShowGrate(compartment)) {
      addContinuousCooktopGrate(
        group,
        name,
        surfaceWidth + 0.02,
        surfaceDepth + 0.02,
        topY + surfaceThickness + 0.036,
        burners,
      )
    }

    const knobMargin = 0.06
    const knobSpan = surfaceWidth - knobMargin * 2
    const knobStep = knobSpan / Math.max(1, burners.length - 1)
    const knobZ = surfaceDepth * 0.42
    for (let knobIndex = 0; knobIndex < burners.length; knobIndex += 1) {
      const knobX = -knobSpan / 2 + knobIndex * knobStep
      const progress = knobProgress[knobIndex] ?? (activeBurners.has(knobIndex) ? 1 : 0)
      const knobAngle = -2.3 * progress
      const knobUserData = {
        type: 'gas',
        compartmentIndex: index,
        burnerIndex: knobIndex,
      }
      const hit = stampSlot(
        new Mesh(new CylinderGeometry(0.03, 0.03, 0.06, 12), cooktopKnobHitMaterial),
        'hardware',
      )
      hit.name = `${name}-knob-${knobIndex}-hit`
      hit.position.set(knobX, topY + surfaceThickness + 0.019, knobZ)
      hit.userData.cabinetCooktopKnob = knobUserData
      group.add(hit)

      const collar = stampSlot(
        new Mesh(new CylinderGeometry(0.016, 0.018, 0.006, 20), cooktopTrimMaterial),
        'hardware',
      )
      collar.name = `${name}-knob-${knobIndex}-collar`
      collar.position.set(knobX, topY + surfaceThickness + 0.006, knobZ)
      collar.userData.cabinetCooktopKnob = knobUserData
      group.add(collar)

      const knob = stampSlot(
        new Mesh(new CylinderGeometry(0.012, 0.015, 0.02, 20), cooktopGrateMaterial),
        'hardware',
      )
      knob.name = `${name}-knob-${knobIndex}`
      knob.position.set(knobX, topY + surfaceThickness + 0.019, knobZ)
      knob.rotation.y = knobAngle
      knob.userData.cabinetCooktopKnob = knobUserData
      knob.castShadow = true
      group.add(knob)

      // Child of the knob so it turns with it and keeps pointing radially.
      const notch = stampSlot(
        new Mesh(
          new BoxGeometry(0.003, 0.004, 0.011),
          progress > 0.5 ? cooktopKnobOnMaterial : cooktopTrimMaterial,
        ),
        'hardware',
      )
      notch.name = `${name}-knob-${knobIndex}-notch`
      notch.position.set(0, 0.012, 0.011)
      knob.add(notch)
    }
    return
  }

  const zones = inductionZones(layout)
  zones.forEach((zone, zoneIndex) => {
    addInductionZone(
      group,
      name,
      zone,
      topY + surfaceThickness + 0.002,
      zoneIndex,
      activeBurners.has(zoneIndex),
    )
  })

  const controlBar = stampSlot(
    new Mesh(
      new BoxGeometry(Math.min(0.24, surfaceWidth * 0.38), 0.003, 0.012),
      applianceDisplayMaterial,
    ),
    'appliance',
  )
  controlBar.name = `${name}-touch-control-bar`
  controlBar.position.set(0, topY + surfaceThickness + 0.003, surfaceDepth / 2 - 0.045)
  group.add(controlBar)
  for (let dotIndex = 0; dotIndex < zones.length + 2; dotIndex += 1) {
    const dot = stampSlot(
      new Mesh(
        new CylinderGeometry(0.005, 0.005, 0.002, 14),
        burnersOn ? cooktopInductionActiveZoneMaterial : cooktopInductionZoneMaterial,
      ),
      'appliance',
    )
    dot.name = `${name}-touch-dot-${dotIndex}`
    dot.position.set(
      -0.015 * (zones.length + 1) + dotIndex * 0.03,
      topY + surfaceThickness + 0.005,
      surfaceDepth / 2 - 0.066,
    )
    group.add(dot)
  }
}

function addDishwasherCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  index: number,
) {
  const name = `cabinet-dishwasher-${index}`
  const gap = node.frontGap
  const frontThickness = node.frontThickness
  const doorWidth = Math.max(0.01, faceWidth - gap * 2)
  const doorHeight = Math.max(0.01, faceHeight - gap * 2)
  const doorCenterY = faceCenterY
  const wall = APPLIANCE_CAVITY_WALL
  const tubWidth = Math.max(0.05, Math.min(openingWidth, doorWidth) - wall * 2)
  const tubHeight = Math.max(0.05, doorHeight - wall * 2)
  const tubDepth = Math.max(0.08, Math.min(0.5, openingDepth - 0.04))
  const tubFrontZ = frontZ - frontThickness / 2 - 0.006
  const tubBackZ = tubFrontZ - tubDepth
  const tubCenterZ = tubBackZ + tubDepth / 2
  const topBandHeight = Math.min(0.07, doorHeight * 0.1)
  const faceZ = frontThickness / 2

  addBox(
    group,
    [tubWidth + wall * 2, tubHeight + wall * 2, wall],
    [0, doorCenterY, tubBackZ + wall / 2],
    refrigeratorLinerMaterial,
    `${name}-tub-back`,
    'applianceInterior',
  )
  addBox(
    group,
    [tubWidth + wall * 2, wall, tubDepth],
    [0, doorCenterY + tubHeight / 2 + wall / 2, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-top`,
    'applianceInterior',
  )
  addBox(
    group,
    [tubWidth + wall * 2, wall, tubDepth],
    [0, doorCenterY - tubHeight / 2 - wall / 2, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-bottom`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, tubHeight, tubDepth],
    [-tubWidth / 2 - wall / 2, doorCenterY, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-left`,
    'applianceInterior',
  )
  addBox(
    group,
    [wall, tubHeight, tubDepth],
    [tubWidth / 2 + wall / 2, doorCenterY, tubCenterZ],
    refrigeratorLinerMaterial,
    `${name}-tub-right`,
    'applianceInterior',
  )

  addWireRack(
    group,
    materials,
    Math.max(0.02, tubWidth - 0.04),
    Math.max(0.02, tubDepth - 0.08),
    doorCenterY + tubHeight * 0.18,
    tubCenterZ,
    `${name}-upper-rack`,
  )
  addWireRack(
    group,
    materials,
    Math.max(0.02, tubWidth - 0.04),
    Math.max(0.02, tubDepth - 0.08),
    doorCenterY - tubHeight * 0.18,
    tubCenterZ,
    `${name}-lower-rack`,
  )

  const sprayArmY = doorCenterY - tubHeight * 0.36
  const sprayArm = stampSlot(
    new Mesh(new BoxGeometry(tubWidth * 0.64, 0.008, 0.012), refrigeratorLinerAccentMaterial),
    'applianceInterior',
  )
  sprayArm.name = `${name}-spray-arm`
  sprayArm.position.set(0, sprayArmY, tubFrontZ - tubDepth * 0.2)
  group.add(sprayArm)
  const sprayHub = stampSlot(
    new Mesh(new CylinderGeometry(0.018, 0.018, 0.012, 24), refrigeratorLinerAccentMaterial),
    'applianceInterior',
  )
  sprayHub.name = `${name}-spray-hub`
  sprayHub.rotation.x = Math.PI / 2
  sprayHub.position.set(0, sprayArmY, tubFrontZ - tubDepth * 0.2)
  group.add(sprayHub)

  const hingeGroup = new Group()
  hingeGroup.name = `${name}-door-hinge`
  hingeGroup.position.set(0, doorCenterY - doorHeight / 2, frontZ)
  hingeGroup.rotation.x = OVEN_OPEN_ANGLE * (node.operationState ?? 0)
  hingeGroup.userData.cabinetPose = { type: 'rotate', axis: 'x', angle: OVEN_OPEN_ANGLE }
  group.add(hingeGroup)

  const leaf = new Group()
  leaf.name = `${name}-door`
  leaf.position.set(0, doorHeight / 2, 0)
  hingeGroup.add(leaf)

  const panel = stampSlot(
    new Mesh(
      roundedButtonGeometry(
        doorWidth,
        doorHeight,
        frontThickness,
        Math.min(doorWidth, doorHeight) * 0.035,
      ),
      materials.appliance,
    ),
    'appliance',
  )
  panel.name = `${name}-door-panel`
  panel.castShadow = true
  panel.receiveShadow = true
  leaf.add(panel)

  const trimThickness = Math.max(0.006, Math.min(0.01, Math.min(doorWidth, doorHeight) * 0.018))
  const trimZ = faceZ + 0.004
  addBox(
    leaf,
    [doorWidth - trimThickness * 2.4, trimThickness, frontThickness * 0.18],
    [0, doorHeight / 2 - trimThickness * 1.2, trimZ],
    refrigeratorDarkTrimMaterial,
    `${name}-outer-trim-top`,
    'appliance',
  )
  addBox(
    leaf,
    [doorWidth - trimThickness * 2.4, trimThickness, frontThickness * 0.16],
    [0, -doorHeight / 2 + trimThickness * 1.2, trimZ],
    refrigeratorDarkTrimMaterial,
    `${name}-outer-trim-bottom`,
    'appliance',
  )
  for (const side of [-1, 1]) {
    addBox(
      leaf,
      [trimThickness, doorHeight - trimThickness * 2.4, frontThickness * 0.14],
      [side * (doorWidth / 2 - trimThickness * 1.2), 0, trimZ],
      refrigeratorDarkTrimMaterial,
      `${name}-outer-trim-${side < 0 ? 'left' : 'right'}`,
      'appliance',
    )
  }

  const bandWidth = doorWidth - trimThickness * 5
  const bandHeight = Math.max(0.045, topBandHeight * 0.82)
  const bandY = doorHeight / 2 - trimThickness * 3.3 - bandHeight / 2
  const controlPanel = stampSlot(
    new Mesh(
      roundedButtonGeometry(bandWidth, bandHeight, frontThickness * 0.18, bandHeight * 0.18),
      microwavePanelMaterial,
    ),
    'appliance',
  )
  controlPanel.name = `${name}-control-panel`
  controlPanel.position.set(0, bandY, faceZ + 0.006)
  controlPanel.castShadow = true
  leaf.add(controlPanel)

  const displayWidth = Math.min(0.105, doorWidth * 0.2)
  const display = stampSlot(
    new Mesh(roundedButtonGeometry(displayWidth, 0.018, 0.004, 0.003), microwaveScreenMaterial),
    'appliance',
  )
  display.name = `${name}-display`
  display.position.set(-bandWidth * 0.28, bandY, faceZ + 0.018)
  leaf.add(display)
  addMicrowaveDisplaySegments(leaf, -bandWidth * 0.28, bandY, faceZ + 0.014, displayWidth, name)
  for (let i = 0; i < 4; i += 1)
    addBox(
      leaf,
      [0.018, 0.006, 0.003],
      [bandWidth * 0.03 + i * 0.034, bandY, faceZ + 0.019],
      microwaveButtonMaterial,
      `${name}-cycle-button-${i}`,
      'appliance',
    )

  const handleY = bandY - bandHeight / 2 - 0.018
  addBox(
    leaf,
    [doorWidth * 0.66, 0.018, 0.008],
    [0, handleY, faceZ + 0.008],
    microwavePanelMaterial,
    `${name}-pocket-handle-shadow`,
    'appliance',
  )
  addBox(
    leaf,
    [doorWidth * 0.58, 0.007, 0.006],
    [0, handleY + 0.005, faceZ + 0.017],
    refrigeratorSilverMaterial,
    `${name}-pocket-handle-lip`,
    'appliance',
  )

  const lowerVisualTop = handleY - 0.025
  const toeVentY = -doorHeight / 2 + 0.042
  const centerPanelHeight = Math.max(0.08, lowerVisualTop - toeVentY - 0.052)
  const centerPanelY = toeVentY + 0.042 + centerPanelHeight / 2
  const centerPanel = stampSlot(
    new Mesh(
      roundedButtonGeometry(
        doorWidth - trimThickness * 7,
        centerPanelHeight,
        frontThickness * 0.1,
        Math.min(0.012, centerPanelHeight * 0.05),
      ),
      refrigeratorSilverMaterial,
    ),
    'appliance',
  )
  centerPanel.name = `${name}-brushed-front-panel`
  centerPanel.position.set(0, centerPanelY, faceZ + 0.009)
  centerPanel.castShadow = true
  centerPanel.receiveShadow = true
  leaf.add(centerPanel)
  addBox(
    leaf,
    [doorWidth - trimThickness * 10, 0.01, 0.002],
    [0, centerPanelY + centerPanelHeight * 0.42, faceZ + 0.016],
    refrigeratorSealMaterial,
    `${name}-front-highlight`,
    'appliance',
  )
  for (const offsetX of [-0.5, 0.5]) {
    addBox(
      leaf,
      [0.004, centerPanelHeight * 0.86, 0.002],
      [offsetX * (doorWidth - trimThickness * 8), centerPanelY, faceZ + 0.015],
      refrigeratorSealMaterial,
      `${name}-front-groove-${offsetX < 0 ? 'left' : 'right'}`,
      'appliance',
    )
  }
  for (let i = 0; i < 3; i += 1) {
    addBox(
      leaf,
      [0.003, centerPanelHeight * 0.82, 0.002],
      [(-0.12 + i * 0.12) * doorWidth, centerPanelY, faceZ + 0.014],
      refrigeratorSealMaterial,
      `${name}-brushed-line-${i}`,
      'appliance',
    )
  }
  addBox(
    leaf,
    [Math.min(0.052, doorWidth * 0.1), 0.012, 0.004],
    [doorWidth * 0.31, centerPanelY + centerPanelHeight * 0.34, faceZ + 0.019],
    refrigeratorBrassAccentMaterial,
    `${name}-badge`,
    'appliance',
  )
  addBox(
    leaf,
    [Math.min(0.18, doorWidth * 0.34), 0.046, 0.012],
    [doorWidth * 0.22, -doorHeight * 0.1, -frontThickness / 2 - 0.018],
    microwaveScreenMaterial,
    `${name}-detergent-cup`,
    'applianceInterior',
  )

  addBox(
    leaf,
    [doorWidth * 0.54, 0.024, frontThickness * 0.2],
    [0, toeVentY, faceZ + 0.008],
    refrigeratorDarkTrimMaterial,
    `${name}-toe-vent`,
    'appliance',
  )
  for (let i = 0; i < 5; i += 1) {
    addBox(
      leaf,
      [0.03, 0.0035, 0.004],
      [-doorWidth * 0.16 + i * doorWidth * 0.08, toeVentY, faceZ + 0.015],
      microwaveScreenMaterial,
      `${name}-toe-vent-slat-${i}`,
      'appliance',
    )
  }
}

function addPullOutPantryBasket(
  group: Group,
  materials: CabinetSlotMaterials,
  width: number,
  depth: number,
  y: number,
  zCenter: number,
  name: string,
  rackStyle: PullOutPantryRackStyle,
  toLocal: (position: [number, number, number]) => [number, number, number],
) {
  const rail = 0.008
  const basketHeight = 0.045
  const panelHeight = 0.07
  if (rackStyle !== 'wire') {
    const material = rackStyle === 'glass' ? materials.glass : materials.carcass
    const panelThickness = rackStyle === 'glass' ? 0.006 : 0.012
    addBox(
      group,
      [width, panelThickness, depth],
      toLocal([0, y, zCenter]),
      material,
      `${name}-${rackStyle}-tray-floor`,
      rackStyle === 'glass' ? 'glass' : 'carcass',
    )
    addBox(
      group,
      [width, panelHeight, panelThickness],
      toLocal([0, y + panelHeight / 2, zCenter + depth / 2 - panelThickness / 2]),
      material,
      `${name}-${rackStyle}-front-panel`,
      rackStyle === 'glass' ? 'glass' : 'carcass',
    )
    addBox(
      group,
      [width, panelHeight, panelThickness],
      toLocal([0, y + panelHeight / 2, zCenter - depth / 2 + panelThickness / 2]),
      material,
      `${name}-${rackStyle}-back-panel`,
      rackStyle === 'glass' ? 'glass' : 'carcass',
    )
    for (const side of [-1, 1]) {
      addBox(
        group,
        [panelThickness, panelHeight, depth],
        toLocal([side * (width / 2 - panelThickness / 2), y + panelHeight / 2, zCenter]),
        material,
        `${name}-${rackStyle}-${side < 0 ? 'left' : 'right'}-panel`,
        rackStyle === 'glass' ? 'glass' : 'carcass',
      )
    }
    return
  }

  addBox(
    group,
    [width, rail, depth],
    toLocal([0, y, zCenter]),
    materials.hardware,
    `${name}-floor`,
    'hardware',
  )
  addBox(
    group,
    [width, rail, rail],
    toLocal([0, y + basketHeight, zCenter + depth / 2 - rail / 2]),
    materials.hardware,
    `${name}-front-rail`,
    'hardware',
  )
  addBox(
    group,
    [width, rail, rail],
    toLocal([0, y + basketHeight, zCenter - depth / 2 + rail / 2]),
    materials.hardware,
    `${name}-back-rail`,
    'hardware',
  )
  for (const side of [-1, 1]) {
    addBox(
      group,
      [rail, basketHeight, depth],
      toLocal([side * (width / 2 - rail / 2), y + basketHeight / 2, zCenter]),
      materials.hardware,
      `${name}-${side < 0 ? 'left' : 'right'}-side-rail`,
      'hardware',
    )
  }
  for (let i = 1; i <= 3; i += 1) {
    addBox(
      group,
      [rail, basketHeight * 0.72, depth * 0.84],
      toLocal([-width / 2 + (width * i) / 4, y + basketHeight * 0.48, zCenter]),
      materials.hardware,
      `${name}-divider-${i}`,
      'hardware',
    )
  }
}

function addPullOutPantryCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  compartment: CabinetCompartment,
  index: number,
) {
  const name = `cabinet-pull-out-pantry-${index}`
  const rackStyle = compartmentPullOutPantryRackStyle(compartment)
  const frontWidth = Math.max(0.01, faceWidth - node.frontGap * 2)
  const frontHeight = Math.max(0.01, faceHeight - node.frontGap * 2)
  const rackWidth = Math.max(0.04, Math.min(openingWidth - 0.05, frontWidth - 0.04))
  const rackDepth = Math.max(0.08, openingDepth - 0.08)
  const rackHeight = Math.max(0.12, frontHeight - 0.14)
  const rackCenterY = faceCenterY
  const rackCenterZ = frontZ - node.frontThickness / 2 - rackDepth / 2 - 0.025
  const openDistance = Math.min(rackDepth * 0.82, 0.48)
  const openScale = node.operationState ?? 0
  const motion = new Group()
  motion.name = `${name}-slide`
  motion.position.set(0, 0, openDistance * openScale)
  motion.userData.cabinetPose = { type: 'translate', axis: 'z', distance: openDistance }
  group.add(motion)
  const toLocal = (position: [number, number, number]): [number, number, number] => position

  const front = stampSlot(
    new Mesh(buildFrontGeometry(node, frontWidth, frontHeight, false, null), materials.front),
    'front',
  )
  front.name = `${name}-front`
  front.position.set(...toLocal([0, faceCenterY, frontZ]))
  front.castShadow = true
  front.receiveShadow = true
  motion.add(front)

  if (node.handleStyle !== 'cutout' && node.handleStyle !== 'hole') {
    const handleLength = Math.max(0.18, Math.min(frontHeight * 0.52, 0.72))
    addBarHandle(
      motion,
      toLocal([0, faceCenterY, frontZ + node.frontThickness / 2]),
      handleLength,
      true,
      `${name}-handle`,
      materials.hardware,
    )
  }

  const rail = 0.01
  for (const side of [-1, 1]) {
    addBox(
      motion,
      [rail, rackHeight, rail],
      toLocal([
        side * (rackWidth / 2 - rail / 2),
        rackCenterY,
        rackCenterZ - rackDepth / 2 + rail / 2,
      ]),
      materials.hardware,
      `${name}-${side < 0 ? 'left' : 'right'}-rear-upright`,
      'hardware',
    )
    addBox(
      motion,
      [rail, rackHeight, rail],
      toLocal([
        side * (rackWidth / 2 - rail / 2),
        rackCenterY,
        rackCenterZ + rackDepth / 2 - rail / 2,
      ]),
      materials.hardware,
      `${name}-${side < 0 ? 'left' : 'right'}-front-upright`,
      'hardware',
    )
  }

  const basketCount = Math.max(2, Math.min(8, Math.floor(compartmentShelfCount(compartment))))
  const bottomY = rackCenterY - rackHeight / 2 + 0.08
  const usableHeight = Math.max(0.1, rackHeight - 0.16)
  for (let i = 0; i < basketCount; i += 1) {
    const y = bottomY + (usableHeight * i) / Math.max(1, basketCount - 1)
    addPullOutPantryBasket(
      motion,
      materials,
      rackWidth,
      rackDepth,
      y,
      rackCenterZ,
      `${name}-basket-${i}`,
      rackStyle,
      toLocal,
    )
  }

  addBox(
    motion,
    [rackWidth * 0.72, 0.012, rackDepth],
    toLocal([0, rackCenterY + rackHeight / 2 - 0.018, rackCenterZ]),
    materials.hardware,
    `${name}-top-tie`,
    'hardware',
  )
  addBox(
    motion,
    [rackWidth * 0.72, 0.012, rackDepth],
    toLocal([0, rackCenterY - rackHeight / 2 + 0.018, rackCenterZ]),
    materials.hardware,
    `${name}-bottom-tie`,
    'hardware',
  )
}

export function buildCabinetGeometry(
  node: CabinetGeometryNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  if (node.type === 'cabinet') {
    const run = buildCabinetRunGeometry(node, ctx, shading, textures, colorPreset, sceneTheme)
    if (run) return run
    return new Group()
  }

  const group = new Group()
  const materials = getCabinetSlotMaterials(node, ctx, shading, textures, colorPreset, sceneTheme)

  const hoodRows = normalizeCabinetStack(node)
  if (hoodRows.length > 0 && hoodRows.every((row) => isHoodCompartmentType(row.compartment.type))) {
    const hoodPlinth = node.showPlinth ? node.plinthHeight : 0
    hoodRows.forEach((row) => {
      addRangeHoodCompartment(
        group,
        node,
        materials,
        row.compartment.type as CabinetHoodCompartmentType,
        hoodPlinth + row.y0,
        row.height,
        ctx,
        row.index,
      )
    })
    return group
  }

  const width = node.width
  const depth = node.depth
  const board = node.boardThickness
  const plinth = node.showPlinth ? node.plinthHeight : 0
  const toeKickDepth = node.showPlinth ? Math.min(node.toeKickDepth, depth - board * 2) : 0
  const carcassHeight = node.carcassHeight
  const frontThickness = node.frontThickness
  const frontGap = node.frontGap
  const countertopThickness = node.withCountertop ? node.countertopThickness : 0
  const countertopOverhang = node.withCountertop ? node.countertopOverhang : 0
  const bodyCenterY = plinth + carcassHeight / 2
  const topY = plinth + carcassHeight
  const innerWidth = Math.max(0.01, width - 2 * board)
  const bottomLift = node.withBottomPanel ? board : 0
  const backThickness = Math.min(0.006, board / 2)
  const backInset = Math.min(0.012, depth * 0.08)
  const frontRecess = 0.0015
  const inset = node.frontOverlay === 'inset'
  // Overlay fronts sit proud on the carcass face; inset fronts sit flush within the opening.
  const frontZ = inset
    ? depth / 2 - frontThickness / 2 - frontRecess
    : depth / 2 + frontThickness / 2 - frontRecess
  const openingWidth = Math.max(0.01, width - 2 * board)
  const openingDepth = Math.max(0.01, depth - backInset - 0.02)
  const drawerBoxBackZ = -depth / 2 + backInset + 0.02
  const drawerBoxFrontZ = frontZ - frontThickness / 2 - 0.001
  const drawerBoxDepth = Math.max(0.05, drawerBoxFrontZ - drawerBoxBackZ)

  addBox(
    group,
    [board, carcassHeight, depth],
    [-width / 2 + board / 2, bodyCenterY, 0],
    materials.carcass,
    'cabinet-side-left',
    'carcass',
  )
  addBox(
    group,
    [board, carcassHeight, depth],
    [width / 2 - board / 2, bodyCenterY, 0],
    materials.carcass,
    'cabinet-side-right',
    'carcass',
  )
  if (node.withBottomPanel) {
    addBox(
      group,
      [innerWidth, board, depth - backInset],
      [0, plinth + board / 2, backInset / 2],
      materials.carcass,
      'cabinet-bottom',
      'carcass',
    )
  }
  addBox(
    group,
    [innerWidth, board, depth],
    [0, topY - board / 2, 0],
    materials.carcass,
    'cabinet-top',
    'carcass',
  )
  if (node.showPlinth && plinth > 0) {
    addBox(
      group,
      [width - board * 2, plinth, Math.max(board, depth - toeKickDepth)],
      [0, plinth / 2, -(toeKickDepth / 2)],
      materials.plinth,
      'cabinet-plinth',
      'plinth',
    )
  }

  if (node.withCountertop && countertopThickness > 0) {
    addBox(
      group,
      [width + countertopOverhang * 2, countertopThickness, depth + countertopOverhang],
      [0, topY + countertopThickness / 2, 0.01],
      materials.countertop,
      'cabinet-countertop',
      'countertop',
    )
  }
  const rows = normalizeCabinetStack(node)
  rows.forEach((row, index) => {
    if (row.compartment.type === 'cooktop-gas' || row.compartment.type === 'cooktop-induction') {
      const countertopClearance = 0.001
      const effectiveCountertopThickness = Math.max(countertopThickness, 0.02)
      addCooktopCompartment(
        group,
        node,
        row.compartment,
        row.compartment.type,
        topY + effectiveCountertopThickness + countertopClearance,
        index,
      )
      return
    }

    const isFirst = index === 0
    const isLast = index === rows.length - 1
    const bottomOccupancy = isFirst ? bottomLift : board / 2
    const topOccupancy = isLast ? board : board / 2
    const subCellBottomY = plinth + row.y0
    const openingBottomY = subCellBottomY + bottomOccupancy
    const openingHeight = Math.max(0.01, row.height - bottomOccupancy - topOccupancy)
    const openingCenterY = openingBottomY + openingHeight / 2

    addBox(
      group,
      [openingWidth, Math.max(0.001, row.height - board), backThickness],
      [0, subCellBottomY + row.height / 2, -depth / 2 + backInset + backThickness / 2],
      materials.carcass,
      `cabinet-back-${index}`,
      'carcass',
    )

    if (index < rows.length - 1) {
      const deckY = plinth + row.y1
      addBox(
        group,
        [openingWidth, board, openingDepth],
        [0, deckY, board / 2],
        materials.carcass,
        `cabinet-deck-${index}`,
        'carcass',
      )
    }

    const faceWidth = inset ? openingWidth : Math.max(0.01, width - frontGap)
    const faceHeight = inset ? openingHeight : Math.max(0.01, row.height)
    const faceCenterY = inset ? openingCenterY : subCellBottomY + row.height / 2

    if (row.compartment.type === 'door') {
      addDoorFronts(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        0,
        faceCenterY,
        frontZ,
        compartmentDoorType(row.compartment, node.width),
      )
      if ((row.compartment.shelfCount ?? 0) > 0) {
        addShelfBoards(
          group,
          materials,
          openingWidth,
          openingDepth,
          board,
          openingBottomY,
          openingHeight,
          row.compartment.shelfCount ?? 0,
        )
      }
      return
    }

    if (row.compartment.type === 'shelf') {
      addShelfBoards(
        group,
        materials,
        openingWidth,
        openingDepth,
        board,
        openingBottomY,
        openingHeight,
        compartmentShelfCount(row.compartment),
      )
      return
    }

    if (row.compartment.type === 'drawer') {
      addDrawerFronts(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        faceCenterY,
        inset ? openingBottomY : subCellBottomY,
        openingWidth,
        frontZ,
        compartmentDrawerCount(row.compartment),
        drawerBoxBackZ,
        drawerBoxDepth,
      )
      return
    }

    if (row.compartment.type === 'dishwasher') {
      addDishwasherCompartment(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        index,
      )
      return
    }

    if (row.compartment.type === 'pull-out-pantry') {
      addPullOutPantryCompartment(
        group,
        node,
        materials,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        row.compartment,
        index,
      )
      return
    }

    if (row.compartment.type === 'oven' || row.compartment.type === 'microwave') {
      addApplianceCompartment(
        group,
        node,
        materials,
        row.compartment.type,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        index,
      )
      return
    }

    if (
      row.compartment.type === 'fridge-single' ||
      row.compartment.type === 'fridge-double' ||
      row.compartment.type === 'fridge-top-freezer' ||
      row.compartment.type === 'fridge-bottom-freezer'
    ) {
      addFridgeCompartment(
        group,
        node,
        materials,
        row.compartment.type,
        faceWidth,
        faceHeight,
        faceCenterY,
        openingWidth,
        openingDepth,
        frontZ,
        index,
      )
      return
    }

    if (isHoodCompartmentType(row.compartment.type)) {
      addRangeHoodCompartment(
        group,
        node,
        materials,
        row.compartment.type,
        plinth + row.y0,
        row.height,
        ctx,
        index,
      )
    }
  })

  return group
}
