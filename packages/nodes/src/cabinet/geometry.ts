import {
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
    slotId === 'hardware' ? 0.45 : 0.8,
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

  for (const span of spans) {
    const spanIndex = spans.indexOf(span)
    const previousSpan = spans[spanIndex - 1]
    const nextSpan = spans[spanIndex + 1]
    const leftOverhang =
      previousSpan && !previousSpan.hasCountertop && span.minX - previousSpan.maxX <= 1e-4
        ? 0
        : node.countertopOverhang
    const rightOverhang =
      nextSpan && !nextSpan.hasCountertop && nextSpan.minX - span.maxX <= 1e-4
        ? 0
        : node.countertopOverhang
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
    }
  })

  return group
}
