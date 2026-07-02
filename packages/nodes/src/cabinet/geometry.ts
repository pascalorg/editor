import {
  type AnyNode,
  type CabinetModuleNode,
  type CabinetNode,
  type GeometryContext,
  getMaterialPresetByRef,
  type MaterialSchema,
} from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
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
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  FrontSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { type CabinetSlotId, cabinetSlots } from './slots'
import {
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentShelfCount,
  normalizeCabinetStack,
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
  return new BoxGeometry(width, height, node.frontThickness)
}

function buildHoleFrontGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null,
): BufferGeometry {
  const base = new BoxGeometry(width, height, node.frontThickness)
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
    width: number
    depth: number
    topY: number
    hasCountertop: boolean
  }> = []

  for (const module of sorted) {
    const minX = module.position[0] - module.width / 2
    const maxX = module.position[0] + module.width / 2
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
        width: module.width,
        depth: module.depth,
        topY,
        hasCountertop,
      })
      continue
    }

    current.maxX = Math.max(current.maxX, maxX)
    current.width = Math.max(0.01, current.maxX - current.minX)
    current.centerX = (current.minX + current.maxX) / 2
    current.depth = Math.max(current.depth, module.depth)
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
              width: sibling.width,
              depth: sibling.depth,
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
        z: originZ,
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
    if (node.showPlinth && plinth > 0) {
      addBox(
        group,
        [span.width, plinth, Math.max(node.boardThickness, span.depth - toeKickDepth)],
        [span.centerX, plinth / 2, -(toeKickDepth / 2)],
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
          0.01,
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
  const mesh = stampSlot(new Mesh(new BoxGeometry(size[0], size[1], size[2]), material), slotId)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
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
    const openOffset =
      (node.operationState ?? 0) * Math.min(boxDepth * 0.9, 0.35) * drawerOpenScale(i, count)
    const y = y0 + node.frontGap + drawerHeight / 2 + i * (drawerHeight + node.frontGap)
    const frontWidth = faceWidth - 2 * node.frontGap
    const frontMesh = stampSlot(
      new Mesh(buildFrontGeometry(node, frontWidth, drawerHeight, true), materials.front),
      'front',
    )
    frontMesh.name = `cabinet-drawer-front-${centerY.toFixed(3)}-${i}`
    frontMesh.position.set(0, y, frontZ + openOffset)
    frontMesh.castShadow = true
    frontMesh.receiveShadow = true
    group.add(frontMesh)

    if (node.handleStyle !== 'cutout' && node.handleStyle !== 'hole') {
      const handleGroup = new Group()
      handleGroup.position.set(0, y, frontZ + openOffset)
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
      group.add(handleGroup)
    }

    addBox(
      group,
      [drawerSideThickness, boxHeight, boxDepth],
      [-(boxWidth / 2) + drawerSideThickness / 2, y, boxCenterZ + openOffset],
      materials.carcass,
      `cabinet-drawer-side-left-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
    addBox(
      group,
      [drawerSideThickness, boxHeight, boxDepth],
      [boxWidth / 2 - drawerSideThickness / 2, y, boxCenterZ + openOffset],
      materials.carcass,
      `cabinet-drawer-side-right-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
    addBox(
      group,
      [boxWidth - 2 * drawerSideThickness, boxHeight, drawerSideThickness],
      [0, y, boxBackZ + drawerSideThickness / 2 + openOffset],
      materials.carcass,
      `cabinet-drawer-back-${centerY.toFixed(3)}-${i}`,
      'carcass',
    )
    addBox(
      group,
      [boxWidth - 2 * drawerSideThickness, drawerSideThickness, boxDepth - drawerSideThickness],
      [0, y - boxHeight / 2 + drawerSideThickness / 2, boxCenterZ + openOffset],
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
    new Mesh(
      roundedButtonGeometry(width, height, 0.007, Math.min(width, height) * 0.28),
      material,
    ),
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
    new Mesh(new CylinderGeometry(fanRadius * 0.22, fanRadius * 0.22, 0.008, 24), materials.applianceInterior),
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
    new Mesh(new TorusGeometry(Math.min(width, depth) * 0.32, 0.004, 8, 64), ovenHeatElementMaterial),
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
  } else {
    hingeGroup.position.set(doorCenterX - doorWidth / 2, doorCenterY, frontZ)
    hingeGroup.rotation.y = -(Math.PI / 2) * (node.operationState ?? 0)
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
  }

  const group = new Group()
  const materials = getCabinetSlotMaterials(node, ctx, shading, textures, colorPreset, sceneTheme)
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
    }
  })

  return group
}
