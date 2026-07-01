import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
} from 'three'
import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import type { CabinetModuleNode, CabinetNode, GeometryContext } from '@pascal-app/core'
import {
  compartmentDoorType,
  compartmentDrawerCount,
  compartmentShelfCount,
  normalizeCabinetStack,
} from './stack'

const CARCASS_COLOR = '#f0ede6'
const FRONT_COLOR = '#e4ded2'
const PLINTH_COLOR = '#a8a29a'
const COUNTERTOP_COLOR = '#d6d0c4'
const HANDLE_COLOR = '#7d7d7d'
const BACK_COLOR = '#ebe5d8'
const DRAWER_BOX_COLOR = '#ddd6c8'
const DRAWER_MIN_OPEN = 0.32
const GLASS_COLOR = '#b9d7e8'
const HANDLE_RECESS_COLOR = '#5f5f5f'
const HANDLE_EDGE_INSET = 0.045
const HANDLE_TOP_INSET = 0.05
const HANDLE_SLOT_LONG = 0.09
const HANDLE_SLOT_SHORT = 0.016
const HANDLE_CUTOUT_WIDTH = 0.13
const HANDLE_CUTOUT_DIP = 0.014
const holeDummyMaterial = new MeshBasicMaterial()

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
  if (node.handleStyle === 'cutout') return buildCutoutFrontGeometry(node, width, height, drawer)
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

function cabinetTotalHeight(node: Pick<CabinetGeometryNode, 'carcassHeight' | 'countertopThickness' | 'plinthHeight' | 'showPlinth' | 'withCountertop'>) {
  return (
    (node.showPlinth ? node.plinthHeight : 0) +
    node.carcassHeight +
    (node.withCountertop ? node.countertopThickness : 0)
  )
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

function buildCabinetRunGeometry(node: CabinetNode, ctx?: GeometryContext): Group | null {
  const modules = getRunModules(ctx)
  if (modules.length === 0) return null

  const group = new Group()
  const plinth = node.showPlinth ? node.plinthHeight : 0
  const spans = getRunSpans(modules)

  for (const span of spans) {
    const toeKickDepth = node.showPlinth
      ? Math.min(node.toeKickDepth, span.depth - node.boardThickness * 2)
      : 0
    if (node.showPlinth && plinth > 0) {
      addBox(
        group,
        [span.width, plinth, Math.max(node.boardThickness, span.depth - toeKickDepth)],
        [span.centerX, plinth / 2, -(toeKickDepth / 2)],
        PLINTH_COLOR,
        'cabinet-run-plinth',
      )
    }

    if (node.withCountertop && span.hasCountertop && node.countertopThickness > 0) {
      addBox(
        group,
        [
          span.width + node.countertopOverhang * 2,
          node.countertopThickness,
          span.depth + node.countertopOverhang,
        ],
        [span.centerX, span.topY + node.countertopThickness / 2, 0.01],
        COUNTERTOP_COLOR,
        'cabinet-run-countertop',
      )
    }
  }

  return group
}

function addBox(
  group: Group,
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  name: string,
) {
  const mesh = new Mesh(
    new BoxGeometry(size[0], size[1], size[2]),
    new MeshStandardMaterial({ color, metalness: 0.08, roughness: 0.72 }),
  )
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
) {
  const handleMaterial = new MeshStandardMaterial({
    color: HANDLE_COLOR,
    metalness: 0.55,
    roughness: 0.3,
  })
  const mesh = new Mesh(
    new CylinderGeometry(0.006, 0.006, length, 16),
    handleMaterial,
  )
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2] + 0.028)
  if (!vertical) mesh.rotation.z = Math.PI / 2
  mesh.castShadow = true
  group.add(mesh)

  const standOffDistance = length * 0.38
  for (const offset of [-standOffDistance, standOffDistance]) {
    const standoff = new Mesh(new CylinderGeometry(0.004, 0.004, 0.026, 10), handleMaterial)
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

function addHandleFeature(
  group: Object3D,
  node: CabinetGeometryNode,
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

  if (style === 'bar') {
    const x =
      placement?.x ??
      (hinge == null
        ? 0
        : (hinge === 'right' ? -1 : 1) * (width / 2 - HANDLE_EDGE_INSET - HANDLE_SLOT_SHORT / 2))
    const y = placement?.y ?? (drawer ? height / 2 - HANDLE_TOP_INSET : 0)
    const z = node.frontThickness / 2
    addBarHandle(group, [x, y, z], drawer ? 0.12 : 0.18, vertical, name)
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
    (drawer
      ? height / 2 - HANDLE_TOP_INSET
      : height / 2 - HANDLE_TOP_INSET - HANDLE_SLOT_LONG / 2)
  const z = node.frontThickness / 2
  const slotLength = drawer ? HANDLE_SLOT_LONG : 0.1
  const slotThickness = HANDLE_SLOT_SHORT
  const size: [number, number, number] = vertical
    ? [slotThickness, slotLength, Math.max(0.004, node.frontThickness * 0.4)]
    : [slotLength, slotThickness, Math.max(0.004, node.frontThickness * 0.4)]
  const mesh = new Mesh(
    new BoxGeometry(size[0], size[1], size[2]),
    new MeshStandardMaterial({ color: HANDLE_RECESS_COLOR, metalness: 0.2, roughness: 0.65 }),
  )
  mesh.name = name
  mesh.position.set(x, y, z - node.frontThickness * 0.18)
  group.add(mesh)
}

function addDoorLeaf(
  group: Group,
  node: CabinetGeometryNode,
  width: number,
  height: number,
  hinge: 'left' | 'right',
  centerX: number,
  centerY: number,
  frontZ: number,
  name: string,
  glass = false,
) {
  const material = new MeshStandardMaterial({ color: FRONT_COLOR, metalness: 0.08, roughness: 0.72 })
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
    addBox(leafGroup, [width, frame, node.frontThickness], [0, height / 2 - frame / 2, 0], FRONT_COLOR, `${name}-frame-top`)
    addBox(leafGroup, [width, frame, node.frontThickness], [0, -height / 2 + frame / 2, 0], FRONT_COLOR, `${name}-frame-bottom`)
    addBox(leafGroup, [frame, glassHeight, node.frontThickness], [-width / 2 + frame / 2, 0, 0], FRONT_COLOR, `${name}-frame-left`)
    addBox(leafGroup, [frame, glassHeight, node.frontThickness], [width / 2 - frame / 2, 0, 0], FRONT_COLOR, `${name}-frame-right`)
    const glassMesh = new Mesh(
      new BoxGeometry(glassWidth, glassHeight, glassDepth),
      new MeshBasicMaterial({
        color: GLASS_COLOR,
        transparent: true,
        opacity: 0.32,
        side: DoubleSide,
        depthWrite: false,
      }),
    )
    glassMesh.name = `${name}-glass`
    glassMesh.position.set(0, 0, node.frontThickness / 2 + glassDepth / 2 + 0.001)
    glassMesh.renderOrder = 2
    leafGroup.add(glassMesh)
    addHandleFeature(
      leafGroup,
      { ...node, handleStyle: 'bar' },
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

  const mesh = new Mesh(buildFrontGeometry(node, width, height, false, hinge), material)
  mesh.name = name
  mesh.position.set(hinge === 'left' ? width / 2 : -width / 2, 0, 0)
  mesh.castShadow = true
  mesh.receiveShadow = true
  hingeGroup.add(mesh)

  addHandleFeature(mesh, node, width, height, hinge, true, false, `${name}-handle`)
}

function addDoorFronts(
  group: Group,
  node: CabinetGeometryNode,
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
      CARCASS_COLOR,
      `cabinet-shelf-${y.toFixed(3)}-${i}`,
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
  openingWidth: number,
  openingHeight: number,
  centerY: number,
  y0: number,
  frontZ: number,
  count: number,
  boxBackZ: number,
  boxDepth: number,
) {
  const usableHeight = Math.max(0.01, openingHeight - 2 * node.frontGap)
  const drawerHeight = Math.max(0.01, (usableHeight - (count - 1) * node.frontGap) / count)
  const drawerSideThickness = Math.min(0.012, node.boardThickness * 0.7)
  const boxWidth = Math.max(0.01, openingWidth - 0.026)
  const boxHeight = Math.max(0.02, drawerHeight - 0.012)
  const boxCenterZ = boxBackZ + boxDepth / 2
  for (let i = 0; i < count; i++) {
    const openOffset =
      (node.operationState ?? 0) * Math.min(boxDepth * 0.9, 0.35) * drawerOpenScale(i, count)
    const y =
      y0 +
      node.frontGap +
      drawerHeight / 2 +
      i * (drawerHeight + node.frontGap)
    const frontWidth = openingWidth - 2 * node.frontGap
    const frontMesh = new Mesh(
      buildFrontGeometry(node, frontWidth, drawerHeight, true),
      new MeshStandardMaterial({ color: FRONT_COLOR, metalness: 0.08, roughness: 0.72 }),
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
      DRAWER_BOX_COLOR,
      `cabinet-drawer-side-left-${centerY.toFixed(3)}-${i}`,
    )
    addBox(
      group,
      [drawerSideThickness, boxHeight, boxDepth],
      [(boxWidth / 2) - drawerSideThickness / 2, y, boxCenterZ + openOffset],
      DRAWER_BOX_COLOR,
      `cabinet-drawer-side-right-${centerY.toFixed(3)}-${i}`,
    )
    addBox(
      group,
      [boxWidth - 2 * drawerSideThickness, boxHeight, drawerSideThickness],
      [0, y, boxBackZ + drawerSideThickness / 2 + openOffset],
      DRAWER_BOX_COLOR,
      `cabinet-drawer-back-${centerY.toFixed(3)}-${i}`,
    )
    addBox(
      group,
      [boxWidth - 2 * drawerSideThickness, drawerSideThickness, boxDepth - drawerSideThickness],
      [0, y - boxHeight / 2 + drawerSideThickness / 2, boxCenterZ + openOffset],
      DRAWER_BOX_COLOR,
      `cabinet-drawer-bottom-${centerY.toFixed(3)}-${i}`,
    )
  }
}

export function buildCabinetGeometry(node: CabinetGeometryNode, ctx?: GeometryContext): Group {
  if (node.type === 'cabinet') {
    const run = buildCabinetRunGeometry(node, ctx)
    if (run) return run
  }

  const group = new Group()
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
  const frontZ = depth / 2 - frontThickness / 2 - frontRecess
  const openingWidth = Math.max(0.01, width - 2 * board)
  const openingDepth = Math.max(0.01, depth - backInset - 0.02)
  const drawerBoxBackZ = -depth / 2 + backInset + 0.02
  const drawerBoxFrontZ = frontZ - frontThickness / 2 - 0.001
  const drawerBoxDepth = Math.max(0.05, drawerBoxFrontZ - drawerBoxBackZ)

  addBox(
    group,
    [board, carcassHeight, depth],
    [-width / 2 + board / 2, bodyCenterY, 0],
    CARCASS_COLOR,
    'cabinet-side-left',
  )
  addBox(
    group,
    [board, carcassHeight, depth],
    [width / 2 - board / 2, bodyCenterY, 0],
    CARCASS_COLOR,
    'cabinet-side-right',
  )
  if (node.withBottomPanel) {
    addBox(
      group,
      [innerWidth, board, depth - backInset],
      [0, plinth + board / 2, backInset / 2],
      CARCASS_COLOR,
      'cabinet-bottom',
    )
  }
  addBox(group, [innerWidth, board, depth], [0, topY - board / 2, 0], CARCASS_COLOR, 'cabinet-top')
  if (node.showPlinth && plinth > 0) {
    addBox(
      group,
      [width - board * 2, plinth, Math.max(board, depth - toeKickDepth)],
      [0, plinth / 2, -(toeKickDepth / 2)],
      PLINTH_COLOR,
      'cabinet-plinth',
    )
  }

  if (node.withCountertop && countertopThickness > 0) {
    addBox(
      group,
      [width + countertopOverhang * 2, countertopThickness, depth + countertopOverhang],
      [0, topY + countertopThickness / 2, 0.01],
      COUNTERTOP_COLOR,
      'cabinet-countertop',
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
      BACK_COLOR,
      `cabinet-back-${index}`,
    )

    if (index < rows.length - 1) {
      const deckY = plinth + row.y1
      addBox(
        group,
        [openingWidth, board, openingDepth],
        [0, deckY, board / 2],
        CARCASS_COLOR,
        `cabinet-deck-${index}`,
      )
    }

    if (row.compartment.type === 'door') {
      addDoorFronts(
        group,
        node,
        openingWidth,
        openingHeight,
        0,
        openingCenterY,
        frontZ,
        compartmentDoorType(row.compartment, node.width),
      )
      if ((row.compartment.shelfCount ?? 0) > 0) {
        addShelfBoards(
          group,
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
        openingWidth,
        openingHeight,
        openingCenterY,
        openingBottomY,
        frontZ,
        compartmentDrawerCount(row.compartment),
        drawerBoxBackZ,
        drawerBoxDepth,
      )
    }
  })

  return group
}
