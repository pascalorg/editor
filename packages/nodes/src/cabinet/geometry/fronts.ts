import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  Shape,
  SphereGeometry,
} from 'three'
import {
  addBox,
  type CabinetGeometryNode,
  type CabinetSlotMaterials,
  createWorldScaleBoxGeometry,
  stampSlot,
} from './shared'

const DRAWER_MIN_OPEN = 0.32
const HANDLE_EDGE_INSET = 0.045
const HANDLE_TOP_INSET = 0.05
const HANDLE_SLOT_LONG = 0.09
const HANDLE_SLOT_SHORT = 0.016
const HANDLE_CUTOUT_WIDTH = 0.13
const HANDLE_CUTOUT_DIP = 0.014
const SHAKER_FRAME_MIN = 0.045
const SHAKER_FRAME_MAX = 0.085
const SHAKER_RECESS_MIN = 0.004
const RAISED_ARCH_FRAME_MIN = 0.048
const RAISED_ARCH_FRAME_MAX = 0.09
const RAISED_ARCH_RECESS_MIN = 0.004
const holeDummyMaterial = new MeshBasicMaterial()

function resolveShakerFrameSize(width: number, height: number): number {
  return Math.min(
    SHAKER_FRAME_MAX,
    Math.max(SHAKER_FRAME_MIN, Math.min(width, height) * (height >= 0.22 ? 0.16 : 0.2)),
  )
}

function resolveRaisedArchFrameSize(width: number, height: number): number {
  return Math.min(
    RAISED_ARCH_FRAME_MAX,
    Math.max(
      RAISED_ARCH_FRAME_MIN,
      Math.min(width, height) * (height >= 0.22 ? 0.17 : 0.21),
    ),
  )
}

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

function buildBaseFrontGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null,
): BufferGeometry {
  if (node.handleStyle === 'cutout')
    return buildCutoutFrontGeometry(node, width, height, drawer, hinge)
  if (node.handleStyle === 'hole') return buildHoleFrontGeometry(node, width, height, drawer, hinge)
  return createWorldScaleBoxGeometry(width, height, node.frontThickness)
}

function applyShakerFrontProfile(
  node: CabinetGeometryNode,
  base: BufferGeometry,
  width: number,
  height: number,
): BufferGeometry {
  const frame = resolveShakerFrameSize(width, height)
  const panelWidth = width - frame * 2
  const panelHeight = height - frame * 2
  if (panelWidth <= 0.01 || panelHeight <= 0.01) return base

  const recessDepth = Math.min(
    Math.max(SHAKER_RECESS_MIN, node.frontThickness * 0.4),
    Math.max(SHAKER_RECESS_MIN, node.frontThickness - 0.004),
  )
  const cutter = new BoxGeometry(panelWidth, panelHeight, recessDepth + 0.012)
  cutter.translate(0, 0, node.frontThickness / 2 - recessDepth / 2 + 0.006)
  return subtractFrontCutters(base, [cutter], 'shaker panel recess')
}

function buildRaisedArchPanelShape(panelWidth: number, panelHeight: number): Shape {
  const halfWidth = panelWidth / 2
  const halfHeight = panelHeight / 2
  const targetArchRise = Math.min(0.07, Math.max(0.03, panelWidth * 0.22))
  const archRise = Math.min(targetArchRise, Math.max(0.02, panelHeight * 0.26))
  const springY = halfHeight - archRise
  const archShoulderControlY = springY + archRise * 0.72
  const archCenterControlX = halfWidth * 0.56

  const shape = new Shape()
  shape.moveTo(-halfWidth, -halfHeight)
  shape.lineTo(halfWidth, -halfHeight)
  shape.lineTo(halfWidth, springY)
  shape.bezierCurveTo(
    halfWidth,
    archShoulderControlY,
    archCenterControlX,
    halfHeight,
    0,
    halfHeight,
  )
  shape.bezierCurveTo(
    -archCenterControlX,
    halfHeight,
    -halfWidth,
    archShoulderControlY,
    -halfWidth,
    springY,
  )
  shape.lineTo(-halfWidth, -halfHeight)
  return shape
}

function buildRectangleShape(width: number, height: number): Shape {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const shape = new Shape()
  shape.moveTo(-halfWidth, -halfHeight)
  shape.lineTo(halfWidth, -halfHeight)
  shape.lineTo(halfWidth, halfHeight)
  shape.lineTo(-halfWidth, halfHeight)
  shape.lineTo(-halfWidth, -halfHeight)
  return shape
}

function buildRaisedArchGlassDoorGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
): { frame: BufferGeometry; glass: BufferGeometry; frameWidth: number; glassDepth: number } {
  const frameWidth = resolveRaisedArchFrameSize(width, height)
  const glassWidth = Math.max(0.01, width - frameWidth * 2)
  const glassHeight = Math.max(0.01, height - frameWidth * 2)
  const glassDepth = Math.max(0.003, node.frontThickness * 0.25)

  const frameShape = buildRectangleShape(width, height)
  frameShape.holes.push(buildRaisedArchPanelShape(glassWidth, glassHeight))

  const frame = new ExtrudeGeometry(frameShape, {
    depth: node.frontThickness,
    bevelEnabled: false,
    curveSegments: 32,
    steps: 1,
  })
  frame.translate(0, 0, -node.frontThickness / 2)
  frame.computeVertexNormals()

  const glass = new ExtrudeGeometry(buildRaisedArchPanelShape(glassWidth, glassHeight), {
    depth: glassDepth,
    bevelEnabled: false,
    curveSegments: 32,
    steps: 1,
  })
  glass.translate(0, 0, -glassDepth / 2)
  glass.computeVertexNormals()

  return { frame, glass, frameWidth, glassDepth }
}

function applyRaisedArchFrontProfile(
  node: CabinetGeometryNode,
  base: BufferGeometry,
  width: number,
  height: number,
): BufferGeometry {
  const frame = resolveRaisedArchFrameSize(width, height)
  const panelWidth = width - frame * 2
  const panelHeight = height - frame * 2
  if (panelWidth <= 0.01 || panelHeight <= 0.01) return base

  const recessDepth = Math.min(
    Math.max(RAISED_ARCH_RECESS_MIN, node.frontThickness * 0.42),
    Math.max(RAISED_ARCH_RECESS_MIN, node.frontThickness - 0.004),
  )
  const cutter = new ExtrudeGeometry(buildRaisedArchPanelShape(panelWidth, panelHeight), {
    depth: recessDepth + 0.012,
    bevelEnabled: false,
    curveSegments: 32,
    steps: 1,
  })
  const cutterCenterZ = node.frontThickness / 2 - recessDepth / 2 + 0.006
  cutter.translate(0, 0, cutterCenterZ - (recessDepth + 0.012) / 2)
  cutter.computeVertexNormals()
  return subtractFrontCutters(base, [cutter], 'raised arch panel recess')
}

export function buildFrontGeometry(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null = null,
): BufferGeometry {
  const base = buildBaseFrontGeometry(node, width, height, drawer, hinge)
  switch (node.frontStyle ?? 'slab') {
    case 'shaker':
      return applyShakerFrontProfile(node, base, width, height)
    case 'raised-arch':
      return applyRaisedArchFrontProfile(node, base, width, height)
    default:
      return base
  }
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
  const { x, y } = resolveHandlePlacement(node, width, height, drawer, hinge)
  const holeOffsets = drawer ? [-0.022, 0.022] : [0]
  const cutters = holeOffsets.map((offset) => {
    const cutter = new CylinderGeometry(radius, radius, node.frontThickness + 0.012, 24)
    cutter.rotateX(Math.PI / 2)
    cutter.translate(x + offset, y, 0)
    return cutter
  })
  return subtractFrontCutters(base, cutters, 'hole handle')
}

export function addBarHandle(
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
  // 'auto': drawers pull from the top, doors from mid-height.
  return drawer ? topY : 0
}

function resolveHandlePlacement(
  node: CabinetGeometryNode,
  width: number,
  height: number,
  drawer: boolean,
  hinge: 'left' | 'right' | null,
): { x: number; y: number } {
  const defaultX =
    hinge == null
      ? 0
      : (hinge === 'right' ? -1 : 1) * (width / 2 - HANDLE_EDGE_INSET - HANDLE_SLOT_SHORT / 2)
  const defaultY = resolveHandleY(node, height, drawer)
  const frontStyle = node.frontStyle ?? 'slab'
  const frame =
    frontStyle === 'shaker'
      ? resolveShakerFrameSize(width, height)
      : frontStyle === 'raised-arch'
        ? resolveRaisedArchFrameSize(width, height)
        : 0
  if (frame <= 0) return { x: defaultX, y: defaultY }

  if (hinge != null) {
    return {
      x: (hinge === 'right' ? -1 : 1) * (width / 2 - frame / 2),
      y: defaultY,
    }
  }

  const position = node.handlePosition ?? 'auto'
  const frameY = height / 2 - frame / 2
  return {
    x: defaultX,
    y: drawer ? (position === 'center' ? 0 : frameY) : position === 'center' ? 0 : defaultY,
  }
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
  const resolvedPlacement = resolveHandlePlacement(node, width, height, drawer, hinge)

  if (style === 'bar') {
    const x = placement?.x ?? resolvedPlacement.x
    const y = placement?.y ?? resolvedPlacement.y
    const z = node.frontThickness / 2
    addBarHandle(group, [x, y, z], drawer ? 0.12 : 0.18, vertical, name, materials.hardware)
    return
  }

  if (style === 'knob') {
    const x = placement?.x ?? resolvedPlacement.x
    const y = placement?.y ?? resolvedPlacement.y
    const z = node.frontThickness / 2
    addKnobHandle(group, [x, y, z], name, materials.hardware)
    return
  }

  // 'hole' and 'cutout' are carved by the CSG pass on the front panel itself
  // (see stampSlot callers) — no separate handle mesh.
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

    if ((node.frontStyle ?? 'slab') === 'raised-arch') {
      const { frame, glass, frameWidth, glassDepth } = buildRaisedArchGlassDoorGeometry(
        node,
        width,
        height,
      )
      const frameMesh = stampSlot(new Mesh(frame, materials.front), 'front')
      frameMesh.name = `${name}-frame`
      frameMesh.castShadow = true
      frameMesh.receiveShadow = true
      leafGroup.add(frameMesh)

      const glassMesh = stampSlot(new Mesh(glass, materials.glass), 'glass')
      glassMesh.name = `${name}-glass`
      glassMesh.position.set(0, 0, node.frontThickness / 2 - glassDepth / 2 - 0.001)
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
          x: (hinge === 'right' ? -1 : 1) * (width / 2 - frameWidth / 2),
          y: 0,
        },
      )
      return
    }

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
      new Mesh(createWorldScaleBoxGeometry(glassWidth, glassHeight, glassDepth), materials.glass),
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

export function addDoorFronts(
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

export function addShelfBoards(
  group: Group,
  materials: CabinetSlotMaterials,
  openingWidth: number,
  openingDepth: number,
  board: number,
  y0: number,
  height: number,
  count: number,
  centerX = 0,
) {
  if (count <= 0) return
  for (let i = 0; i < count; i++) {
    const y = y0 + (height * (i + 1)) / (count + 1)
    addBox(
      group,
      [openingWidth, board, openingDepth],
      [centerX, y, board / 2],
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

export function addDrawerFronts(
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
