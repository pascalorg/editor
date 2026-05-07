import {
  type AnyNodeId,
  sceneRegistry,
  useInteractive,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { baseMaterial, glassMaterial } from '../../lib/materials'

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })
export const CASEMENT_WINDOW_SASH_NAME = 'casement-window-sash'
export const FRENCH_CASEMENT_LEFT_SASH_NAME = 'french-casement-left-sash'
export const FRENCH_CASEMENT_RIGHT_SASH_NAME = 'french-casement-right-sash'
export const SLIDING_WINDOW_ACTIVE_PANEL_NAME = 'sliding-window-active-panel'
export const SINGLE_HUNG_ACTIVE_SASH_NAME = 'single-hung-active-sash'
export const DOUBLE_HUNG_TOP_SASH_NAME = 'double-hung-top-sash'
export const DOUBLE_HUNG_BOTTOM_SASH_NAME = 'double-hung-bottom-sash'
export const LOUVERED_WINDOW_SLATS_NAME = 'louvered-window-slats'
export const AWNING_WINDOW_SASH_NAME = 'awning-window-sash'
export const HOPPER_WINDOW_SASH_NAME = 'hopper-window-sash'

export const WindowSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'window') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) return // Keep dirty until mesh mounts

      updateWindowMesh(node as WindowNode, mesh)
      clearDirty(id as AnyNodeId)

      // Rebuild the parent wall so its cutout reflects the updated window geometry
      if ((node as WindowNode).parentId) {
        useScene.getState().dirtyNodes.add((node as WindowNode).parentId as AnyNodeId)
      }
    })
  }, 3)

  return null
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  parent.add(m)
}

function addShape(
  parent: THREE.Object3D,
  material: THREE.Material,
  shape: THREE.Shape,
  depth: number,
  z = 0,
) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geometry.translate(0, 0, -depth / 2 + z)
  const mesh = new THREE.Mesh(geometry, material)
  parent.add(mesh)
}

function disposeObjectGeometry(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
}

function createRectShape(left: number, right: number, bottom: number, top: number) {
  const shape = new THREE.Shape()
  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, top)
  shape.lineTo(left, top)
  shape.closePath()
  return shape
}

type CornerRadii = {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

function normalizeCornerRadii(radii: CornerRadii, width: number, height: number): CornerRadii {
  const next = { ...radii }
  const scale = Math.min(
    1,
    width / Math.max(next.topLeft + next.topRight, 1e-6),
    width / Math.max(next.bottomLeft + next.bottomRight, 1e-6),
    height / Math.max(next.topLeft + next.bottomLeft, 1e-6),
    height / Math.max(next.topRight + next.bottomRight, 1e-6),
  )

  if (scale < 1) {
    next.topLeft *= scale
    next.topRight *= scale
    next.bottomRight *= scale
    next.bottomLeft *= scale
  }

  return next
}

function getWindowRoundedRadii(node: WindowNode, width: number, height: number): CornerRadii {
  if (node.openingRadiusMode === 'individual') {
    const [topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0] =
      node.openingCornerRadii ?? [0.15, 0.15, 0.15, 0.15]
    return normalizeCornerRadii(
      {
        topLeft: Math.max(topLeft, 0),
        topRight: Math.max(topRight, 0),
        bottomRight: Math.max(bottomRight, 0),
        bottomLeft: Math.max(bottomLeft, 0),
      },
      width,
      height,
    )
  }

  const maxRadius = Math.min(width / 2, height / 2)
  const radius = Math.min(Math.max(node.cornerRadius ?? 0.15, 0), maxRadius)
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
}

function insetCornerRadii(radii: CornerRadii, inset: number, width: number, height: number) {
  return normalizeCornerRadii(
    {
      topLeft: Math.max(radii.topLeft - inset, 0),
      topRight: Math.max(radii.topRight - inset, 0),
      bottomRight: Math.max(radii.bottomRight - inset, 0),
      bottomLeft: Math.max(radii.bottomLeft - inset, 0),
    },
    width,
    height,
  )
}

function createRoundedShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  radii: CornerRadii,
) {
  const shape = new THREE.Shape()
  const { topLeft, topRight, bottomRight, bottomLeft } = radii

  shape.moveTo(left + bottomLeft, bottom)
  shape.lineTo(right - bottomRight, bottom)
  if (bottomRight > 1e-6) {
    shape.absarc(right - bottomRight, bottom + bottomRight, bottomRight, -Math.PI / 2, 0, false)
  } else {
    shape.lineTo(right, bottom)
  }

  shape.lineTo(right, top - topRight)
  if (topRight > 1e-6) {
    shape.absarc(right - topRight, top - topRight, topRight, 0, Math.PI / 2, false)
  } else {
    shape.lineTo(right, top)
  }

  shape.lineTo(left + topLeft, top)
  if (topLeft > 1e-6) {
    shape.absarc(left + topLeft, top - topLeft, topLeft, Math.PI / 2, Math.PI, false)
  } else {
    shape.lineTo(left, top)
  }

  shape.lineTo(left, bottom + bottomLeft)
  if (bottomLeft > 1e-6) {
    shape.absarc(left + bottomLeft, bottom + bottomLeft, bottomLeft, Math.PI, Math.PI * 1.5, false)
  } else {
    shape.lineTo(left, bottom)
  }

  shape.closePath()
  return shape
}

function createRoundedFrameShape(
  width: number,
  height: number,
  frameThickness: number,
  outerRadii: CornerRadii,
) {
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const outer = createRoundedShape(-halfWidth, halfWidth, bottom, top, outerRadii)
  const inset = Math.min(frameThickness, width / 2 - 0.005, height / 2 - 0.005)

  if (inset <= 0.001) return outer

  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerBottom = bottom + inset
  const innerTop = top - inset
  const innerRadii = insetCornerRadii(
    outerRadii,
    inset,
    innerRight - innerLeft,
    innerTop - innerBottom,
  )
  const holeShape = createRoundedShape(innerLeft, innerRight, innerBottom, innerTop, innerRadii)
  const hole = new THREE.Path(holeShape.getPoints(32).reverse())
  outer.holes.push(hole)

  return outer
}

function getClampedArchHeight(width: number, height: number, archHeight: number | undefined) {
  return Math.min(Math.max(archHeight ?? width / 2, 0.01), Math.max(height, 0.01))
}

function createArchShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  archHeight: number,
) {
  const centerX = (left + right) / 2
  const halfWidth = (right - left) / 2
  const clampedArchHeight = getClampedArchHeight(right - left, top - bottom, archHeight)
  const springY = top - clampedArchHeight
  const shape = new THREE.Shape()
  const segments = 32

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, springY)
  for (let index = 1; index <= segments; index += 1) {
    const x = right + (left - right) * (index / segments)
    shape.lineTo(x, getArchBoundaryY(x - centerX, halfWidth, springY, clampedArchHeight))
  }
  shape.lineTo(left, bottom)
  shape.closePath()
  return shape
}

function createArchedFrameShape(
  width: number,
  height: number,
  archHeight: number,
  frameThickness: number,
) {
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const outer = createArchShape(-halfWidth, halfWidth, bottom, top, archHeight)
  const inset = Math.min(frameThickness, width / 2 - 0.005, height / 2 - 0.005)

  if (inset <= 0.001) return outer

  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerBottom = bottom + inset
  const innerTop = top - inset
  const innerArchHeight = getClampedArchHeight(
    innerRight - innerLeft,
    innerTop - innerBottom,
    archHeight - inset,
  )
  const hole = new THREE.Path(
    createArchShape(innerLeft, innerRight, innerBottom, innerTop, innerArchHeight)
      .getPoints(32)
      .reverse(),
  )
  outer.holes.push(hole)

  return outer
}

function getArchBoundaryY(x: number, halfWidth: number, springY: number, archHeight: number) {
  if (halfWidth <= 1e-6) return springY
  const t = Math.min(Math.abs(x) / halfWidth, 1)
  return springY + archHeight * Math.sqrt(Math.max(1 - t * t, 0))
}

function getArchedOpeningHalfWidthAtY(
  y: number,
  halfWidth: number,
  springY: number,
  archHeight: number,
) {
  if (y <= springY || archHeight <= 1e-6) return halfWidth
  const normalizedY = Math.min(Math.max((y - springY) / archHeight, 0), 1)
  return halfWidth * Math.sqrt(Math.max(1 - normalizedY * normalizedY, 0))
}

function getRoundedBoundaryYAtX(
  x: number,
  left: number,
  right: number,
  top: number,
  radii: CornerRadii,
) {
  if (radii.topLeft > 1e-6 && x < left + radii.topLeft) {
    const centerX = left + radii.topLeft
    const centerY = top - radii.topLeft
    const dx = x - centerX
    return centerY + Math.sqrt(Math.max(radii.topLeft * radii.topLeft - dx * dx, 0))
  }

  if (radii.topRight > 1e-6 && x > right - radii.topRight) {
    const centerX = right - radii.topRight
    const centerY = top - radii.topRight
    const dx = x - centerX
    return centerY + Math.sqrt(Math.max(radii.topRight * radii.topRight - dx * dx, 0))
  }

  return top
}

function getRoundedBottomBoundaryYAtX(
  x: number,
  left: number,
  right: number,
  bottom: number,
  radii: CornerRadii,
) {
  if (radii.bottomLeft > 1e-6 && x < left + radii.bottomLeft) {
    const centerX = left + radii.bottomLeft
    const centerY = bottom + radii.bottomLeft
    const dx = x - centerX
    return centerY - Math.sqrt(Math.max(radii.bottomLeft * radii.bottomLeft - dx * dx, 0))
  }

  if (radii.bottomRight > 1e-6 && x > right - radii.bottomRight) {
    const centerX = right - radii.bottomRight
    const centerY = bottom + radii.bottomRight
    const dx = x - centerX
    return centerY - Math.sqrt(Math.max(radii.bottomRight * radii.bottomRight - dx * dx, 0))
  }

  return bottom
}

function getRoundedHorizontalBoundsAtY(
  y: number,
  left: number,
  right: number,
  top: number,
  radii: CornerRadii,
) {
  let minX = left
  let maxX = right

  if (radii.topLeft > 1e-6 && y > top - radii.topLeft) {
    const centerX = left + radii.topLeft
    const centerY = top - radii.topLeft
    const dy = y - centerY
    minX = centerX - Math.sqrt(Math.max(radii.topLeft * radii.topLeft - dy * dy, 0))
  }

  if (radii.topRight > 1e-6 && y > top - radii.topRight) {
    const centerX = right - radii.topRight
    const centerY = top - radii.topRight
    const dy = y - centerY
    maxX = centerX + Math.sqrt(Math.max(radii.topRight * radii.topRight - dy * dy, 0))
  }

  return { minX, maxX }
}

function addRoundedWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const {
    width,
    height,
    frameDepth,
    frameThickness,
    columnRatios,
    rowRatios,
    columnDividerThickness,
    rowDividerThickness,
    sill,
    sillDepth,
    sillThickness,
  } = node
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const outerRadii = getWindowRoundedRadii(node, width, height)
  const inset = Math.max(0, Math.min(frameThickness, width / 2 - 0.005, height / 2 - 0.005))
  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerBottom = bottom + inset
  const innerTop = top - inset
  const innerW = innerRight - innerLeft
  const innerH = innerTop - innerBottom
  const innerRadii = insetCornerRadii(outerRadii, inset, innerW, innerH)

  addShape(
    mesh,
    baseMaterial,
    createRoundedFrameShape(width, height, inset, outerRadii),
    frameDepth,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    addShape(
      mesh,
      glassMaterial,
      createRoundedShape(innerLeft, innerRight, innerBottom, innerTop, innerRadii),
      glassDepth,
    )

    const numCols = columnRatios.length
    const numRows = rowRatios.length
    const usableW = innerW - (numCols - 1) * columnDividerThickness
    const usableH = innerH - (numRows - 1) * rowDividerThickness
    const colSum = columnRatios.reduce((a, b) => a + b, 0)
    const rowSum = rowRatios.reduce((a, b) => a + b, 0)
    const colWidths = columnRatios.map((r) => (r / colSum) * usableW)
    const rowHeights = rowRatios.map((r) => (r / rowSum) * usableH)

    let x = innerLeft
    for (let c = 0; c < numCols - 1; c++) {
      x += colWidths[c]!
      const x1 = x
      const x2 = x + columnDividerThickness
      const dividerTop = Math.min(
        getRoundedBoundaryYAtX(x1, innerLeft, innerRight, innerTop, innerRadii),
        getRoundedBoundaryYAtX(x2, innerLeft, innerRight, innerTop, innerRadii),
      )
      if (dividerTop > innerBottom + 0.01) {
        addShape(
          mesh,
          baseMaterial,
          createRectShape(x1, x2, innerBottom, dividerTop),
          frameDepth + 0.001,
        )
      }
      x += columnDividerThickness
    }

    let y = innerTop
    for (let r = 0; r < numRows - 1; r++) {
      y -= rowHeights[r]!
      const yTop = y
      const yBottom = y - rowDividerThickness
      const { minX, maxX } = getRoundedHorizontalBoundsAtY(
        yTop,
        innerLeft,
        innerRight,
        innerTop,
        innerRadii,
      )
      if (maxX - minX > 0.01 && yTop > innerBottom) {
        addShape(
          mesh,
          baseMaterial,
          createRectShape(minX, maxX, Math.max(yBottom, innerBottom), yTop),
          frameDepth + 0.001,
        )
      }
      y -= rowDividerThickness
    }
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addArchedWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const {
    width,
    height,
    frameDepth,
    frameThickness,
    columnRatios,
    rowRatios,
    columnDividerThickness,
    rowDividerThickness,
    sill,
    sillDepth,
    sillThickness,
  } = node
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const archHeight = getClampedArchHeight(width, height, node.archHeight)
  const inset = Math.max(0, Math.min(frameThickness, width / 2 - 0.005, height / 2 - 0.005))
  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerBottom = bottom + inset
  const innerTop = top - inset
  const innerW = innerRight - innerLeft
  const innerH = innerTop - innerBottom
  const innerArchHeight = getClampedArchHeight(innerW, innerH, archHeight - inset)
  const innerSpringY = innerTop - innerArchHeight

  addShape(mesh, baseMaterial, createArchedFrameShape(width, height, archHeight, inset), frameDepth)

  if (innerW > 0.01 && innerH > 0.01) {
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    addShape(
      mesh,
      glassMaterial,
      createArchShape(innerLeft, innerRight, innerBottom, innerTop, innerArchHeight),
      glassDepth,
    )

    const numCols = columnRatios.length
    const numRows = rowRatios.length
    const usableW = innerW - (numCols - 1) * columnDividerThickness
    const usableH = innerH - (numRows - 1) * rowDividerThickness
    const colSum = columnRatios.reduce((a, b) => a + b, 0)
    const rowSum = rowRatios.reduce((a, b) => a + b, 0)
    const colWidths = columnRatios.map((r) => (r / colSum) * usableW)
    const rowHeights = rowRatios.map((r) => (r / rowSum) * usableH)
    const innerHalfWidth = innerW / 2

    let x = innerLeft
    for (let c = 0; c < numCols - 1; c++) {
      x += colWidths[c]!
      const x1 = x
      const x2 = x + columnDividerThickness
      const dividerTop = Math.min(
        getArchBoundaryY(x1, innerHalfWidth, innerSpringY, innerArchHeight),
        getArchBoundaryY(x2, innerHalfWidth, innerSpringY, innerArchHeight),
      )
      if (dividerTop > innerBottom + 0.01) {
        addShape(
          mesh,
          baseMaterial,
          createRectShape(x1, x2, innerBottom, dividerTop),
          frameDepth + 0.001,
        )
      }
      x += columnDividerThickness
    }

    let y = innerTop
    for (let r = 0; r < numRows - 1; r++) {
      y -= rowHeights[r]!
      const yTop = y
      const yBottom = y - rowDividerThickness
      const halfAtTop = getArchedOpeningHalfWidthAtY(
        yTop,
        innerHalfWidth,
        innerSpringY,
        innerArchHeight,
      )
      const x1 = -halfAtTop
      const x2 = halfAtTop
      if (x2 - x1 > 0.01 && yTop > innerBottom) {
        addShape(
          mesh,
          baseMaterial,
          createRectShape(x1, x2, Math.max(yBottom, innerBottom), yTop),
          frameDepth + 0.001,
        )
      }
      y -= rowDividerThickness
    }
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function getWindowRenderOpenAmount(node: WindowNode) {
  const runtimeValue = useInteractive.getState().windows[node.id]?.operationState
  return Math.min(Math.max(runtimeValue ?? node.operationState ?? 0, 0), 1)
}

function getAwningDirection(node: WindowNode) {
  return node.windowType === 'hopper' ? 'down' : (node.awningDirection ?? 'up')
}

function isRectangleOnlyWindowType(node: WindowNode) {
  return (
    node.windowType === 'sliding' ||
    node.windowType === 'single-hung' ||
    node.windowType === 'double-hung' ||
    node.windowType === 'bay' ||
    node.windowType === 'bow'
  )
}

function addSlidingWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const railThickness = Math.max(frameThickness * 0.55, 0.025)
    const trackThickness = Math.max(frameThickness * 0.35, 0.018)
    const panelOverlap = Math.min(Math.max(frameThickness * 0.9, 0.04), innerW * 0.12)
    const openAmount = getWindowRenderOpenAmount(node)
    const travel = Math.max(innerW / 2 - panelOverlap, 0) * openAmount
    const panelWidth = (innerW + panelOverlap) / 2
    const leftPanelBaseX = -innerW / 4 - panelOverlap / 4
    const leftPanelX = leftPanelBaseX + travel
    const rightPanelX = innerW / 4 + panelOverlap / 4
    const leftZ = frameDepth * 0.16
    const rightZ = -frameDepth * 0.12
    const panelH = Math.max(innerH - trackThickness * 2, 0.01)
    const activePanel = new THREE.Group()

    activePanel.name = SLIDING_WINDOW_ACTIVE_PANEL_NAME
    activePanel.position.set(leftPanelX, 0, leftZ)
    mesh.add(activePanel)

    // Twin tracks signal the sliding operation without adding editor-only state.
    addBox(
      mesh,
      baseMaterial,
      innerW,
      trackThickness,
      frameDepth,
      0,
      innerH / 2 - trackThickness / 2,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      innerW,
      trackThickness,
      frameDepth,
      0,
      -innerH / 2 + trackThickness / 2,
      0,
    )

    addBox(activePanel, glassMaterial, panelWidth, panelH, glassDepth, 0, 0, 0)
    addBox(mesh, glassMaterial, panelWidth, panelH, glassDepth, rightPanelX, 0, rightZ)

    // The right sash stays fixed. The left sash is the active panel that slides across it.
    addBox(
      activePanel,
      baseMaterial,
      railThickness,
      panelH,
      frameDepth * 0.72,
      -panelWidth / 2 + railThickness / 2,
      0,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      railThickness,
      panelH,
      frameDepth * 0.72,
      rightPanelX + panelWidth / 2 - railThickness / 2,
      0,
      rightZ,
    )
    addBox(
      activePanel,
      baseMaterial,
      railThickness,
      panelH,
      frameDepth * 0.78,
      panelWidth / 2 - railThickness / 2,
      0,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      railThickness,
      panelH,
      frameDepth * 0.78,
      rightPanelX - panelWidth / 2 + railThickness / 2,
      0,
      rightZ,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addRectCasementSash(
  parent: THREE.Object3D,
  name: string,
  panelW: number,
  panelH: number,
  frameThickness: number,
  frameDepth: number,
  pivotX: number,
  sashCenterX: number,
  rotationY: number,
) {
  const sash = new THREE.Group()
  const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
  const sashDepth = frameDepth * 0.72
  const glassDepth = Math.max(0.004, frameDepth * 0.08)
  const glassW = Math.max(panelW - 2 * sashFrameThickness, 0.01)
  const glassH = Math.max(panelH - 2 * sashFrameThickness, 0.01)

  sash.name = name
  sash.position.set(pivotX, 0, frameDepth * 0.06)
  sash.rotation.y = rotationY
  parent.add(sash)

  addBox(
    sash,
    baseMaterial,
    panelW,
    sashFrameThickness,
    sashDepth,
    sashCenterX,
    panelH / 2 - sashFrameThickness / 2,
    0,
  )
  addBox(
    sash,
    baseMaterial,
    panelW,
    sashFrameThickness,
    sashDepth,
    sashCenterX,
    -panelH / 2 + sashFrameThickness / 2,
    0,
  )
  addBox(
    sash,
    baseMaterial,
    sashFrameThickness,
    panelH,
    sashDepth,
    sashCenterX - panelW / 2 + sashFrameThickness / 2,
    0,
    0,
  )
  addBox(
    sash,
    baseMaterial,
    sashFrameThickness,
    panelH,
    sashDepth,
    sashCenterX + panelW / 2 - sashFrameThickness / 2,
    0,
    0,
  )
  addBox(sash, glassMaterial, glassW, glassH, glassDepth, sashCenterX, 0, sashDepth * 0.08)
}

function addFrenchCasementHingeMarkers(
  mesh: THREE.Mesh,
  innerW: number,
  innerH: number,
  frameThickness: number,
  frameDepth: number,
) {
  const markerW = Math.max(frameThickness * 0.38, 0.018)
  const markerH = innerH * 0.24
  for (const pivotX of [-innerW / 2, innerW / 2]) {
    addBox(
      mesh,
      baseMaterial,
      markerW,
      markerH,
      frameDepth * 1.1,
      pivotX,
      innerH * 0.25,
      frameDepth * 0.08,
    )
    addBox(
      mesh,
      baseMaterial,
      markerW,
      markerH,
      frameDepth * 1.1,
      pivotX,
      -innerH * 0.25,
      frameDepth * 0.08,
    )
  }
}

function createFrenchArchLeafShape(
  leafW: number,
  leafH: number,
  fullW: number,
  springY: number,
  archHeight: number,
  side: 'left' | 'right',
  inset = 0,
) {
  const left = -leafW / 2 + inset
  const right = leafW / 2 - inset
  const bottom = -leafH / 2 + inset
  const halfFullW = fullW / 2
  const xOffset = side === 'left' ? -leafW / 2 : leafW / 2
  const shape = new THREE.Shape()
  const segments = 32

  const topAt = (localX: number) =>
    Math.max(
      bottom + 0.01,
      getArchBoundaryY(localX + xOffset, halfFullW, springY, archHeight) - inset,
    )

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, topAt(right))
  for (let index = 1; index <= segments; index += 1) {
    const x = right + (left - right) * (index / segments)
    shape.lineTo(x, topAt(x))
  }
  shape.lineTo(left, bottom)
  shape.closePath()
  return shape
}

function createFrenchArchLeafFrameShape(
  leafW: number,
  leafH: number,
  fullW: number,
  springY: number,
  archHeight: number,
  frameThickness: number,
  side: 'left' | 'right',
) {
  const outer = createFrenchArchLeafShape(leafW, leafH, fullW, springY, archHeight, side)
  const inset = Math.min(frameThickness, leafW / 2 - 0.005, leafH / 2 - 0.005)

  if (inset <= 0.001) return outer

  const hole = new THREE.Path(
    createFrenchArchLeafShape(leafW, leafH, fullW, springY, archHeight, side, inset)
      .getPoints(32)
      .reverse(),
  )
  outer.holes.push(hole)
  return outer
}

function createFrenchRoundedLeafShape(
  leafW: number,
  leafH: number,
  fullW: number,
  fullRadii: CornerRadii,
  side: 'left' | 'right',
  inset = 0,
) {
  const left = -leafW / 2 + inset
  const right = leafW / 2 - inset
  const bottom = -leafH / 2 + inset
  const top = leafH / 2 - inset
  const fullLeft = -fullW / 2 + inset
  const fullRight = fullW / 2 - inset
  const globalOffset = side === 'left' ? -leafW / 2 : leafW / 2
  const radii =
    inset > 0 ? insetCornerRadii(fullRadii, inset, fullRight - fullLeft, top - bottom) : fullRadii
  const shape = new THREE.Shape()
  const segments = 32
  const topAt = (localX: number) =>
    getRoundedBoundaryYAtX(localX + globalOffset, fullLeft, fullRight, top, radii)
  const bottomAt = (localX: number) =>
    getRoundedBottomBoundaryYAtX(localX + globalOffset, fullLeft, fullRight, bottom, radii)

  shape.moveTo(right, bottomAt(right))
  shape.lineTo(right, topAt(right))

  for (let index = 1; index <= segments; index += 1) {
    const x = right + (left - right) * (index / segments)
    shape.lineTo(x, topAt(x))
  }

  shape.lineTo(left, bottomAt(left))

  for (let index = 1; index <= segments; index += 1) {
    const x = left + (right - left) * (index / segments)
    shape.lineTo(x, bottomAt(x))
  }

  shape.closePath()
  return shape
}

function createFrenchRoundedLeafFrameShape(
  leafW: number,
  leafH: number,
  fullW: number,
  fullRadii: CornerRadii,
  frameThickness: number,
  side: 'left' | 'right',
) {
  const outer = createFrenchRoundedLeafShape(leafW, leafH, fullW, fullRadii, side)
  const inset = Math.min(frameThickness, leafW / 2 - 0.005, leafH / 2 - 0.005)

  if (inset <= 0.001) return outer

  const hole = new THREE.Path(
    createFrenchRoundedLeafShape(leafW, leafH, fullW, fullRadii, side, inset)
      .getPoints(32)
      .reverse(),
  )
  outer.holes.push(hole)
  return outer
}

function addShapedFrenchCasementSash(
  parent: THREE.Object3D,
  node: WindowNode,
  name: string,
  side: 'left' | 'right',
  fullW: number,
  leafW: number,
  leafH: number,
  frameThickness: number,
  frameDepth: number,
  pivotX: number,
  sashCenterX: number,
  rotationY: number,
) {
  const sash = new THREE.Group()
  const sashVisual = new THREE.Group()
  const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
  const sashDepth = frameDepth * 0.72
  const glassDepth = Math.max(0.004, frameDepth * 0.08)

  sash.name = name
  sash.position.set(pivotX, 0, frameDepth * 0.06)
  sash.rotation.y = rotationY
  sashVisual.position.x = sashCenterX
  sash.add(sashVisual)
  parent.add(sash)

  if (node.openingShape === 'arch') {
    const outerArchHeight = getClampedArchHeight(node.width, node.height, node.archHeight)
    const sashArchHeight = getClampedArchHeight(fullW, leafH, outerArchHeight - frameThickness)
    const sashSpringY = node.height / 2 - outerArchHeight
    addShape(
      sashVisual,
      baseMaterial,
      createFrenchArchLeafFrameShape(
        leafW,
        leafH,
        fullW,
        sashSpringY,
        sashArchHeight,
        sashFrameThickness,
        side,
      ),
      sashDepth,
    )
    const glassInset = Math.min(sashFrameThickness, leafW / 2 - 0.005, leafH / 2 - 0.005)
    if (glassInset > 0.001) {
      addShape(
        sashVisual,
        glassMaterial,
        createFrenchArchLeafShape(
          leafW,
          leafH,
          fullW,
          sashSpringY,
          sashArchHeight,
          side,
          glassInset,
        ),
        glassDepth,
        sashDepth * 0.08,
      )
    }
    return
  }

  const frameRadii = insetCornerRadii(
    getWindowRoundedRadii(node, node.width, node.height),
    frameThickness,
    fullW,
    leafH,
  )
  addShape(
    sashVisual,
    baseMaterial,
    createFrenchRoundedLeafFrameShape(leafW, leafH, fullW, frameRadii, sashFrameThickness, side),
    sashDepth,
  )
  const glassInset = Math.min(sashFrameThickness, leafW / 2 - 0.005, leafH / 2 - 0.005)
  if (glassInset > 0.001) {
    addShape(
      sashVisual,
      glassMaterial,
      createFrenchRoundedLeafShape(leafW, leafH, fullW, frameRadii, side, glassInset),
      glassDepth,
      sashDepth * 0.08,
    )
  }
}

function addFrenchCasementWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Fixed outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const openAngle = getWindowRenderOpenAmount(node) * (Math.PI / 2)
    const leafW = innerW / 2
    addRectCasementSash(
      mesh,
      FRENCH_CASEMENT_LEFT_SASH_NAME,
      leafW,
      innerH,
      frameThickness,
      frameDepth,
      -innerW / 2,
      leafW / 2,
      -openAngle,
    )
    addRectCasementSash(
      mesh,
      FRENCH_CASEMENT_RIGHT_SASH_NAME,
      leafW,
      innerH,
      frameThickness,
      frameDepth,
      innerW / 2,
      -leafW / 2,
      openAngle,
    )
    addFrenchCasementHingeMarkers(mesh, innerW, innerH, frameThickness, frameDepth)
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addShapedCasementWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  if (node.openingShape === 'arch') {
    addShape(
      mesh,
      baseMaterial,
      createArchedFrameShape(
        width,
        height,
        getClampedArchHeight(width, height, node.archHeight),
        frameThickness,
      ),
      frameDepth,
    )
  } else {
    addShape(
      mesh,
      baseMaterial,
      createRoundedFrameShape(
        width,
        height,
        frameThickness,
        getWindowRoundedRadii(node, width, height),
      ),
      frameDepth,
    )
  }

  if ((node.casementStyle ?? 'single') === 'french') {
    if (innerW > 0.01 && innerH > 0.01) {
      const openAngle = getWindowRenderOpenAmount(node) * (Math.PI / 2)
      const leafW = innerW / 2
      addShapedFrenchCasementSash(
        mesh,
        node,
        FRENCH_CASEMENT_LEFT_SASH_NAME,
        'left',
        innerW,
        leafW,
        innerH,
        frameThickness,
        frameDepth,
        -innerW / 2,
        leafW / 2,
        -openAngle,
      )
      addShapedFrenchCasementSash(
        mesh,
        node,
        FRENCH_CASEMENT_RIGHT_SASH_NAME,
        'right',
        innerW,
        leafW,
        innerH,
        frameThickness,
        frameDepth,
        innerW / 2,
        -leafW / 2,
        openAngle,
      )
      addFrenchCasementHingeMarkers(mesh, innerW, innerH, frameThickness, frameDepth)
    }

    if (sill) {
      const sillW = width + sillDepth * 0.4
      const sillZ = frameDepth / 2 + sillDepth / 2
      addBox(
        mesh,
        baseMaterial,
        sillW,
        sillThickness,
        sillDepth,
        0,
        -height / 2 - sillThickness / 2,
        sillZ,
      )
    }
    return
  }

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const openAngle = openAmount * (Math.PI / 2)
    const hingeSide = node.hingesSide ?? 'left'
    const hingeSign = hingeSide === 'left' ? -1 : 1
    const pivotX = hingeSide === 'left' ? -innerW / 2 : innerW / 2
    const sashCenterX = hingeSide === 'left' ? innerW / 2 : -innerW / 2
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const sashDepth = frameDepth * 0.72
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const sash = new THREE.Group()
    const sashVisual = new THREE.Group()

    sash.name = CASEMENT_WINDOW_SASH_NAME
    sash.position.set(pivotX, 0, frameDepth * 0.06)
    sash.rotation.y = hingeSign * openAngle
    sashVisual.position.x = sashCenterX
    sash.add(sashVisual)
    mesh.add(sash)

    if (node.openingShape === 'arch') {
      const sashArchHeight = getClampedArchHeight(
        innerW,
        innerH,
        (node.archHeight ?? innerW / 2) - frameThickness,
      )
      addShape(
        sashVisual,
        baseMaterial,
        createArchedFrameShape(innerW, innerH, sashArchHeight, sashFrameThickness),
        sashDepth,
      )
      const glassInset = Math.min(sashFrameThickness, innerW / 2 - 0.005, innerH / 2 - 0.005)
      if (glassInset > 0.001) {
        const glassW = innerW - 2 * glassInset
        const glassH = innerH - 2 * glassInset
        addShape(
          sashVisual,
          glassMaterial,
          createArchShape(
            -glassW / 2,
            glassW / 2,
            -glassH / 2,
            glassH / 2,
            getClampedArchHeight(glassW, glassH, sashArchHeight - glassInset),
          ),
          glassDepth,
          sashDepth * 0.08,
        )
      }
    } else {
      const outerRadii = getWindowRoundedRadii(node, innerW, innerH)
      addShape(
        sashVisual,
        baseMaterial,
        createRoundedFrameShape(innerW, innerH, sashFrameThickness, outerRadii),
        sashDepth,
      )
      const glassInset = Math.min(sashFrameThickness, innerW / 2 - 0.005, innerH / 2 - 0.005)
      if (glassInset > 0.001) {
        const glassW = innerW - 2 * glassInset
        const glassH = innerH - 2 * glassInset
        addShape(
          sashVisual,
          glassMaterial,
          createRoundedShape(
            -glassW / 2,
            glassW / 2,
            -glassH / 2,
            glassH / 2,
            insetCornerRadii(outerRadii, glassInset, glassW, glassH),
          ),
          glassDepth,
          sashDepth * 0.08,
        )
      }
    }

    addBox(
      mesh,
      baseMaterial,
      Math.max(frameThickness * 0.38, 0.018),
      innerH * 0.28,
      frameDepth * 1.1,
      pivotX,
      innerH * 0.24,
      frameDepth * 0.08,
    )
    addBox(
      mesh,
      baseMaterial,
      Math.max(frameThickness * 0.38, 0.018),
      innerH * 0.28,
      frameDepth * 1.1,
      pivotX,
      -innerH * 0.24,
      frameDepth * 0.08,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addCasementWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  if (node.openingShape === 'rounded' || node.openingShape === 'arch') {
    addShapedCasementWindowVisuals(node, mesh)
    return
  }

  if ((node.casementStyle ?? 'single') === 'french') {
    addFrenchCasementWindowVisuals(node, mesh)
    return
  }

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Fixed outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const openAngle = openAmount * (Math.PI / 2)
    const hingeSide = node.hingesSide ?? 'left'
    const hingeSign = hingeSide === 'left' ? -1 : 1
    const sash = new THREE.Group()
    const pivotX = hingeSide === 'left' ? -innerW / 2 : innerW / 2
    const sashCenterX = hingeSide === 'left' ? innerW / 2 : -innerW / 2
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const sashDepth = frameDepth * 0.72
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const glassW = Math.max(innerW - 2 * sashFrameThickness, 0.01)
    const glassH = Math.max(innerH - 2 * sashFrameThickness, 0.01)

    sash.name = CASEMENT_WINDOW_SASH_NAME
    sash.position.set(pivotX, 0, frameDepth * 0.06)
    sash.rotation.y = hingeSign * openAngle
    mesh.add(sash)

    addBox(
      sash,
      baseMaterial,
      innerW,
      sashFrameThickness,
      sashDepth,
      sashCenterX,
      innerH / 2 - sashFrameThickness / 2,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      innerW,
      sashFrameThickness,
      sashDepth,
      sashCenterX,
      -innerH / 2 + sashFrameThickness / 2,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      sashFrameThickness,
      innerH,
      sashDepth,
      sashCenterX - innerW / 2 + sashFrameThickness / 2,
      0,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      sashFrameThickness,
      innerH,
      sashDepth,
      sashCenterX + innerW / 2 - sashFrameThickness / 2,
      0,
      0,
    )
    addBox(sash, glassMaterial, glassW, glassH, glassDepth, sashCenterX, 0, sashDepth * 0.08)

    // Small hinge markers make the pivot side legible when the sash is closed.
    addBox(
      mesh,
      baseMaterial,
      Math.max(frameThickness * 0.38, 0.018),
      innerH * 0.28,
      frameDepth * 1.1,
      pivotX,
      innerH * 0.24,
      frameDepth * 0.08,
    )
    addBox(
      mesh,
      baseMaterial,
      Math.max(frameThickness * 0.38, 0.018),
      innerH * 0.28,
      frameDepth * 1.1,
      pivotX,
      -innerH * 0.24,
      frameDepth * 0.08,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addAwningWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  if (node.openingShape === 'rounded' || node.openingShape === 'arch') {
    addShapedAwningWindowVisuals(node, mesh)
    return
  }

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Fixed outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const openAngle = openAmount * (Math.PI / 3)
    const isDownward = getAwningDirection(node) === 'down'
    const sash = new THREE.Group()
    const pivotY = isDownward ? -innerH / 2 : innerH / 2
    const sashCenterY = isDownward ? innerH / 2 : -innerH / 2
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const sashDepth = frameDepth * 0.72
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const glassW = Math.max(innerW - 2 * sashFrameThickness, 0.01)
    const glassH = Math.max(innerH - 2 * sashFrameThickness, 0.01)

    sash.name = AWNING_WINDOW_SASH_NAME
    sash.position.set(0, pivotY, frameDepth * 0.06)
    sash.rotation.x = -openAngle
    mesh.add(sash)

    addBox(
      sash,
      baseMaterial,
      innerW,
      sashFrameThickness,
      sashDepth,
      0,
      sashCenterY + innerH / 2 - sashFrameThickness / 2,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      innerW,
      sashFrameThickness,
      sashDepth,
      0,
      sashCenterY - innerH / 2 + sashFrameThickness / 2,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      sashFrameThickness,
      innerH,
      sashDepth,
      -innerW / 2 + sashFrameThickness / 2,
      sashCenterY,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      sashFrameThickness,
      innerH,
      sashDepth,
      innerW / 2 - sashFrameThickness / 2,
      sashCenterY,
      0,
    )
    addBox(sash, glassMaterial, glassW, glassH, glassDepth, 0, sashCenterY, sashDepth * 0.08)

    // Compact hinge rail, visible even when the sash is closed.
    addBox(
      mesh,
      baseMaterial,
      innerW * 0.42,
      Math.max(frameThickness * 0.38, 0.018),
      frameDepth * 1.1,
      0,
      pivotY,
      frameDepth * 0.08,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addShapedAwningWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  if (node.openingShape === 'arch') {
    addShape(
      mesh,
      baseMaterial,
      createArchedFrameShape(
        width,
        height,
        getClampedArchHeight(width, height, node.archHeight),
        frameThickness,
      ),
      frameDepth,
    )
  } else {
    addShape(
      mesh,
      baseMaterial,
      createRoundedFrameShape(
        width,
        height,
        frameThickness,
        getWindowRoundedRadii(node, width, height),
      ),
      frameDepth,
    )
  }

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const openAngle = openAmount * (Math.PI / 3)
    const isDownward = getAwningDirection(node) === 'down'
    const pivotY = isDownward ? -innerH / 2 : innerH / 2
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const sashDepth = frameDepth * 0.72
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const sash = new THREE.Group()
    const sashVisual = new THREE.Group()

    sash.name = AWNING_WINDOW_SASH_NAME
    sash.position.set(0, pivotY, frameDepth * 0.06)
    sash.rotation.x = -openAngle
    sashVisual.position.y = isDownward ? innerH / 2 : -innerH / 2
    sash.add(sashVisual)
    mesh.add(sash)

    if (node.openingShape === 'arch') {
      const sashArchHeight = getClampedArchHeight(
        innerW,
        innerH,
        (node.archHeight ?? innerW / 2) - frameThickness,
      )
      addShape(
        sashVisual,
        baseMaterial,
        createArchedFrameShape(innerW, innerH, sashArchHeight, sashFrameThickness),
        sashDepth,
      )
      const glassInset = Math.min(sashFrameThickness, innerW / 2 - 0.005, innerH / 2 - 0.005)
      if (glassInset > 0.001) {
        const glassW = innerW - 2 * glassInset
        const glassH = innerH - 2 * glassInset
        addShape(
          sashVisual,
          glassMaterial,
          createArchShape(
            -glassW / 2,
            glassW / 2,
            -glassH / 2,
            glassH / 2,
            getClampedArchHeight(glassW, glassH, sashArchHeight - glassInset),
          ),
          glassDepth,
          sashDepth * 0.08,
        )
      }
    } else {
      const outerRadii = getWindowRoundedRadii(node, innerW, innerH)
      addShape(
        sashVisual,
        baseMaterial,
        createRoundedFrameShape(innerW, innerH, sashFrameThickness, outerRadii),
        sashDepth,
      )
      const glassInset = Math.min(sashFrameThickness, innerW / 2 - 0.005, innerH / 2 - 0.005)
      if (glassInset > 0.001) {
        const glassW = innerW - 2 * glassInset
        const glassH = innerH - 2 * glassInset
        addShape(
          sashVisual,
          glassMaterial,
          createRoundedShape(
            -glassW / 2,
            glassW / 2,
            -glassH / 2,
            glassH / 2,
            insetCornerRadii(outerRadii, glassInset, glassW, glassH),
          ),
          glassDepth,
          sashDepth * 0.08,
        )
      }
    }

    addBox(
      mesh,
      baseMaterial,
      innerW * 0.42,
      Math.max(frameThickness * 0.38, 0.018),
      frameDepth * 1.1,
      0,
      pivotY,
      frameDepth * 0.08,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addHopperWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  if (node.openingShape === 'rounded' || node.openingShape === 'arch') {
    addShapedHopperWindowVisuals(node, mesh)
    return
  }

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Fixed outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const openAngle = openAmount * (Math.PI / 3)
    const sash = new THREE.Group()
    const pivotY = -innerH / 2
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const sashDepth = frameDepth * 0.72
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const glassW = Math.max(innerW - 2 * sashFrameThickness, 0.01)
    const glassH = Math.max(innerH - 2 * sashFrameThickness, 0.01)

    sash.name = HOPPER_WINDOW_SASH_NAME
    sash.position.set(0, pivotY, frameDepth * 0.06)
    sash.rotation.x = -openAngle
    mesh.add(sash)

    addBox(
      sash,
      baseMaterial,
      innerW,
      sashFrameThickness,
      sashDepth,
      0,
      innerH - sashFrameThickness / 2,
      0,
    )
    addBox(sash, baseMaterial, innerW, sashFrameThickness, sashDepth, 0, sashFrameThickness / 2, 0)
    addBox(
      sash,
      baseMaterial,
      sashFrameThickness,
      innerH,
      sashDepth,
      -innerW / 2 + sashFrameThickness / 2,
      innerH / 2,
      0,
    )
    addBox(
      sash,
      baseMaterial,
      sashFrameThickness,
      innerH,
      sashDepth,
      innerW / 2 - sashFrameThickness / 2,
      innerH / 2,
      0,
    )
    addBox(sash, glassMaterial, glassW, glassH, glassDepth, 0, innerH / 2, sashDepth * 0.08)

    // Compact bottom hinge rail, visible even when the sash is closed.
    addBox(
      mesh,
      baseMaterial,
      innerW * 0.42,
      Math.max(frameThickness * 0.38, 0.018),
      frameDepth * 1.1,
      0,
      pivotY,
      frameDepth * 0.08,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addShapedHopperWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  if (node.openingShape === 'arch') {
    addShape(
      mesh,
      baseMaterial,
      createArchedFrameShape(
        width,
        height,
        getClampedArchHeight(width, height, node.archHeight),
        frameThickness,
      ),
      frameDepth,
    )
  } else {
    addShape(
      mesh,
      baseMaterial,
      createRoundedFrameShape(
        width,
        height,
        frameThickness,
        getWindowRoundedRadii(node, width, height),
      ),
      frameDepth,
    )
  }

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const openAngle = openAmount * (Math.PI / 3)
    const pivotY = -innerH / 2
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const sashDepth = frameDepth * 0.72
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const sash = new THREE.Group()
    const sashVisual = new THREE.Group()

    sash.name = HOPPER_WINDOW_SASH_NAME
    sash.position.set(0, pivotY, frameDepth * 0.06)
    sash.rotation.x = -openAngle
    sashVisual.position.y = innerH / 2
    sash.add(sashVisual)
    mesh.add(sash)

    if (node.openingShape === 'arch') {
      const sashArchHeight = getClampedArchHeight(
        innerW,
        innerH,
        (node.archHeight ?? innerW / 2) - frameThickness,
      )
      addShape(
        sashVisual,
        baseMaterial,
        createArchedFrameShape(innerW, innerH, sashArchHeight, sashFrameThickness),
        sashDepth,
      )
      const glassInset = Math.min(sashFrameThickness, innerW / 2 - 0.005, innerH / 2 - 0.005)
      if (glassInset > 0.001) {
        const glassW = innerW - 2 * glassInset
        const glassH = innerH - 2 * glassInset
        addShape(
          sashVisual,
          glassMaterial,
          createArchShape(
            -glassW / 2,
            glassW / 2,
            -glassH / 2,
            glassH / 2,
            getClampedArchHeight(glassW, glassH, sashArchHeight - glassInset),
          ),
          glassDepth,
          sashDepth * 0.08,
        )
      }
    } else {
      const outerRadii = getWindowRoundedRadii(node, innerW, innerH)
      addShape(
        sashVisual,
        baseMaterial,
        createRoundedFrameShape(innerW, innerH, sashFrameThickness, outerRadii),
        sashDepth,
      )
      const glassInset = Math.min(sashFrameThickness, innerW / 2 - 0.005, innerH / 2 - 0.005)
      if (glassInset > 0.001) {
        const glassW = innerW - 2 * glassInset
        const glassH = innerH - 2 * glassInset
        addShape(
          sashVisual,
          glassMaterial,
          createRoundedShape(
            -glassW / 2,
            glassW / 2,
            -glassH / 2,
            glassH / 2,
            insetCornerRadii(outerRadii, glassInset, glassW, glassH),
          ),
          glassDepth,
          sashDepth * 0.08,
        )
      }
    }

    addBox(
      mesh,
      baseMaterial,
      innerW * 0.42,
      Math.max(frameThickness * 0.38, 0.018),
      frameDepth * 1.1,
      0,
      pivotY,
      frameDepth * 0.08,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addHungSash(
  parent: THREE.Object3D,
  panelW: number,
  panelHeight: number,
  sashFrameThickness: number,
  frameDepth: number,
  glassDepth: number,
  glassW: number,
  glassH: number,
) {
  addBox(
    parent,
    baseMaterial,
    panelW,
    sashFrameThickness,
    frameDepth * 0.72,
    0,
    panelHeight / 2 - sashFrameThickness / 2,
    0,
  )
  addBox(
    parent,
    baseMaterial,
    panelW,
    sashFrameThickness,
    frameDepth * 0.72,
    0,
    -panelHeight / 2 + sashFrameThickness / 2,
    0,
  )
  addBox(
    parent,
    baseMaterial,
    sashFrameThickness,
    panelHeight,
    frameDepth * 0.72,
    -panelW / 2 + sashFrameThickness / 2,
    0,
    0,
  )
  addBox(
    parent,
    baseMaterial,
    sashFrameThickness,
    panelHeight,
    frameDepth * 0.72,
    panelW / 2 - sashFrameThickness / 2,
    0,
    0,
  )
  addBox(parent, glassMaterial, glassW, glassH, glassDepth, 0, 0, 0)
}

function addSingleHungWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Fixed outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const railThickness = Math.max(frameThickness * 0.55, 0.025)
    const trackThickness = Math.max(frameThickness * 0.35, 0.018)
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const panelOverlap = Math.min(Math.max(frameThickness * 0.9, 0.04), innerH * 0.12)
    const openAmount = getWindowRenderOpenAmount(node)
    const travel = Math.max(innerH / 2 - panelOverlap, 0) * openAmount
    const panelHeight = (innerH + panelOverlap) / 2
    const topPanelY = innerH / 4 + panelOverlap / 4
    const bottomPanelY = -innerH / 4 - panelOverlap / 4 + travel
    const topZ = -frameDepth * 0.12
    const bottomZ = frameDepth * 0.16
    const panelW = Math.max(innerW - trackThickness * 2, 0.01)
    const glassW = Math.max(panelW - 2 * sashFrameThickness, 0.01)
    const glassH = Math.max(panelHeight - 2 * sashFrameThickness, 0.01)
    const activeSash = new THREE.Group()

    activeSash.name = SINGLE_HUNG_ACTIVE_SASH_NAME
    activeSash.position.set(0, bottomPanelY, bottomZ)
    mesh.add(activeSash)

    // Side tracks show the lower sash is the moving element.
    addBox(
      mesh,
      baseMaterial,
      trackThickness,
      innerH,
      frameDepth,
      -innerW / 2 + trackThickness / 2,
      0,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      trackThickness,
      innerH,
      frameDepth,
      innerW / 2 - trackThickness / 2,
      0,
      0,
    )

    const topSash = new THREE.Group()
    topSash.position.set(0, topPanelY, topZ)
    mesh.add(topSash)
    addHungSash(
      topSash,
      panelW,
      panelHeight,
      sashFrameThickness,
      frameDepth,
      glassDepth,
      glassW,
      glassH,
    )
    addHungSash(
      activeSash,
      panelW,
      panelHeight,
      sashFrameThickness,
      frameDepth,
      glassDepth,
      glassW,
      glassH,
    )

    // Meeting rails: top sash fixed, bottom sash moves upward over it.
    addBox(
      mesh,
      baseMaterial,
      panelW,
      railThickness,
      frameDepth * 0.78,
      0,
      topPanelY - panelHeight / 2 + railThickness / 2,
      topZ,
    )
    addBox(
      activeSash,
      baseMaterial,
      panelW,
      railThickness,
      frameDepth * 0.78,
      0,
      panelHeight / 2 - railThickness / 2,
      0,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addDoubleHungWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // Fixed outer frame.
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const railThickness = Math.max(frameThickness * 0.55, 0.025)
    const trackThickness = Math.max(frameThickness * 0.35, 0.018)
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const panelOverlap = Math.min(Math.max(frameThickness * 0.9, 0.04), innerH * 0.12)
    const openAmount = getWindowRenderOpenAmount(node)
    const travel = Math.max(innerH / 2 - panelOverlap, 0) * openAmount
    const panelHeight = (innerH + panelOverlap) / 2
    const topPanelY = innerH / 4 + panelOverlap / 4 - travel
    const bottomPanelY = -innerH / 4 - panelOverlap / 4 + travel
    const topZ = -frameDepth * 0.12
    const bottomZ = frameDepth * 0.16
    const panelW = Math.max(innerW - trackThickness * 2, 0.01)
    const glassW = Math.max(panelW - 2 * sashFrameThickness, 0.01)
    const glassH = Math.max(panelHeight - 2 * sashFrameThickness, 0.01)
    const topSash = new THREE.Group()
    const bottomSash = new THREE.Group()

    topSash.name = DOUBLE_HUNG_TOP_SASH_NAME
    topSash.position.set(0, topPanelY, topZ)
    mesh.add(topSash)
    bottomSash.name = DOUBLE_HUNG_BOTTOM_SASH_NAME
    bottomSash.position.set(0, bottomPanelY, bottomZ)
    mesh.add(bottomSash)

    // Side tracks show both sashes move vertically.
    addBox(
      mesh,
      baseMaterial,
      trackThickness,
      innerH,
      frameDepth,
      -innerW / 2 + trackThickness / 2,
      0,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      trackThickness,
      innerH,
      frameDepth,
      innerW / 2 - trackThickness / 2,
      0,
      0,
    )

    addHungSash(
      topSash,
      panelW,
      panelHeight,
      sashFrameThickness,
      frameDepth,
      glassDepth,
      glassW,
      glassH,
    )
    addHungSash(
      bottomSash,
      panelW,
      panelHeight,
      sashFrameThickness,
      frameDepth,
      glassDepth,
      glassW,
      glassH,
    )

    // Opposing meeting rails: top sash descends while bottom sash rises.
    addBox(
      topSash,
      baseMaterial,
      panelW,
      railThickness,
      frameDepth * 0.78,
      0,
      -panelHeight / 2 + railThickness / 2,
      0,
    )
    addBox(
      bottomSash,
      baseMaterial,
      panelW,
      railThickness,
      frameDepth * 0.78,
      0,
      panelHeight / 2 - railThickness / 2,
      0,
    )
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addBayWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const projectionDepth = Math.max(width * 0.22, 0.28)
    const centerW = innerW * 0.48
    const sideRun = Math.max((innerW - centerW) / 2, 0.01)
    const sideW = Math.hypot(sideRun, projectionDepth)
    const sideAngle = Math.atan2(projectionDepth, sideRun)
    const panelDepth = Math.max(frameDepth * 0.72, 0.04)
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const glassDepth = Math.max(0.004, frameDepth * 0.08)
    const bayFootprint: Array<[number, number]> = [
      [-innerW / 2, 0],
      [-centerW / 2, projectionDepth],
      [centerW / 2, projectionDepth],
      [innerW / 2, 0],
    ]

    const addBayPanel = (parent: THREE.Object3D, panelW: number) => {
      const glassW = Math.max(panelW - 2 * sashFrameThickness, 0.01)
      const glassH = Math.max(innerH - 2 * sashFrameThickness, 0.01)
      addBox(
        parent,
        baseMaterial,
        panelW,
        sashFrameThickness,
        panelDepth,
        0,
        innerH / 2 - sashFrameThickness / 2,
        0,
      )
      addBox(
        parent,
        baseMaterial,
        panelW,
        sashFrameThickness,
        panelDepth,
        0,
        -innerH / 2 + sashFrameThickness / 2,
        0,
      )
      addBox(
        parent,
        baseMaterial,
        sashFrameThickness,
        innerH,
        panelDepth,
        -panelW / 2 + sashFrameThickness / 2,
        0,
        0,
      )
      addBox(
        parent,
        baseMaterial,
        sashFrameThickness,
        innerH,
        panelDepth,
        panelW / 2 - sashFrameThickness / 2,
        0,
        0,
      )
      addBox(parent, glassMaterial, glassW, glassH, glassDepth, 0, 0, panelDepth * 0.08)
    }

    const addBayCap = (centerY: number) => {
      const halfThickness = frameThickness / 2
      const vertices: number[] = []
      const indices: number[] = []

      for (const [x, z] of bayFootprint) {
        vertices.push(x, centerY - halfThickness, z)
      }
      for (const [x, z] of bayFootprint) {
        vertices.push(x, centerY + halfThickness, z)
      }

      indices.push(
        0,
        1,
        2,
        0,
        2,
        3,
        4,
        6,
        5,
        4,
        7,
        6,
        0,
        4,
        5,
        0,
        5,
        1,
        1,
        5,
        6,
        1,
        6,
        2,
        2,
        6,
        7,
        2,
        7,
        3,
        3,
        7,
        4,
        3,
        4,
        0,
      )

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      mesh.add(new THREE.Mesh(geometry, baseMaterial))
    }

    const center = new THREE.Group()
    center.position.set(0, 0, projectionDepth)
    mesh.add(center)
    addBayPanel(center, centerW)

    const left = new THREE.Group()
    left.position.set((-innerW / 2 - centerW / 2) / 2, 0, projectionDepth / 2)
    left.rotation.y = -sideAngle
    mesh.add(left)
    addBayPanel(left, sideW)

    const right = new THREE.Group()
    right.position.set((innerW / 2 + centerW / 2) / 2, 0, projectionDepth / 2)
    right.rotation.y = sideAngle
    mesh.add(right)
    addBayPanel(right, sideW)

    addBayCap(innerH / 2)
    addBayCap(-innerH / 2)
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addBowWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const mullionCount = 5
    const curveSegments = 28
    const projectionDepth = Math.max(width * 0.18, 0.22)
    const sashFrameThickness = Math.max(frameThickness * 0.72, 0.032)
    const halfSpan = innerW / 2
    const arcZAt = (x: number) => projectionDepth * (1 - (x / halfSpan) ** 2)
    const slabYTop = innerH / 2
    const slabYBottom = -innerH / 2
    const glassTop = innerH / 2 - sashFrameThickness
    const glassBottom = -innerH / 2 + sashFrameThickness

    const createCurvedVerticalBand = (yBottom: number, yTop: number, zOffset = 0) => {
      const positions: number[] = []
      const indices: number[] = []

      for (let index = 0; index <= curveSegments; index += 1) {
        const x = -halfSpan + (innerW * index) / curveSegments
        const z = arcZAt(x) + zOffset
        positions.push(x, yBottom, z, x, yTop, z)
      }

      for (let index = 0; index < curveSegments; index += 1) {
        const a = index * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      return geometry
    }

    const createCurvedCap = (centerY: number, thickness: number) => {
      const positions: number[] = []
      const indices: number[] = []
      const yBottom = centerY - thickness / 2
      const yTop = centerY + thickness / 2

      for (let index = 0; index <= curveSegments; index += 1) {
        const x = -halfSpan + (innerW * index) / curveSegments
        const z = arcZAt(x)
        positions.push(x, yBottom, 0, x, yBottom, z, x, yTop, 0, x, yTop, z)
      }

      for (let index = 0; index < curveSegments; index += 1) {
        const a = index * 4
        const b = a + 4
        indices.push(
          a,
          b,
          a + 2,
          b,
          b + 2,
          a + 2,
          a + 1,
          a + 3,
          b + 1,
          b + 1,
          a + 3,
          b + 3,
          a + 2,
          b + 2,
          a + 3,
          b + 2,
          b + 3,
          a + 3,
          a,
          a + 1,
          b,
          b,
          a + 1,
          b + 1,
        )
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      return geometry
    }

    const addCurvedMesh = (material: THREE.Material, geometry: THREE.BufferGeometry) => {
      mesh.add(new THREE.Mesh(geometry, material))
    }

    addCurvedMesh(baseMaterial, createCurvedVerticalBand(glassTop, innerH / 2))
    addCurvedMesh(baseMaterial, createCurvedVerticalBand(-innerH / 2, glassBottom))
    addCurvedMesh(glassMaterial, createCurvedVerticalBand(glassBottom, glassTop, frameDepth * 0.04))
    addCurvedMesh(baseMaterial, createCurvedCap(slabYTop, frameThickness))
    addCurvedMesh(baseMaterial, createCurvedCap(slabYBottom, frameThickness))

    for (let index = 0; index <= mullionCount; index += 1) {
      const x = -halfSpan + (innerW * index) / mullionCount
      addBox(mesh, baseMaterial, sashFrameThickness, innerH, frameDepth * 0.72, x, 0, arcZAt(x))
    }
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addLouveredWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node

  if (node.openingShape === 'rounded' || node.openingShape === 'arch') {
    addShapedLouveredWindowVisuals(node, mesh)
    return
  }

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const slatCount = Math.max(4, Math.min(9, Math.round(height / 0.22)))
    const slatGap = innerH / slatCount
    const slatHeight = Math.max(Math.min(slatGap * 0.62, 0.14), 0.045)
    const slatDepth = Math.max(frameDepth * 0.16, 0.012)
    const slatAngle = -openAmount * (Math.PI / 3)
    const railThickness = Math.max(frameThickness * 0.45, 0.022)
    const slats = new THREE.Group()

    slats.name = LOUVERED_WINDOW_SLATS_NAME
    mesh.add(slats)

    addBox(
      mesh,
      baseMaterial,
      railThickness,
      innerH,
      frameDepth * 0.95,
      -innerW / 2 + railThickness / 2,
      0,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      railThickness,
      innerH,
      frameDepth * 0.95,
      innerW / 2 - railThickness / 2,
      0,
      0,
    )

    for (let index = 0; index < slatCount; index += 1) {
      const y = innerH / 2 - slatGap * (index + 0.5)
      const slat = new THREE.Group()
      slat.position.set(0, y, 0)
      slat.rotation.x = slatAngle
      slats.add(slat)
      addBox(
        slat,
        glassMaterial,
        Math.max(innerW - 2 * railThickness, 0.01),
        slatHeight,
        slatDepth,
        0,
        0,
        0,
      )
    }
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function addShapedLouveredWindowVisuals(node: WindowNode, mesh: THREE.Mesh) {
  const { width, height, frameDepth, frameThickness, sill, sillDepth, sillThickness } = node
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const inset = Math.max(0, Math.min(frameThickness, width / 2 - 0.005, height / 2 - 0.005))
  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerBottom = bottom + inset
  const innerTop = top - inset
  const innerW = innerRight - innerLeft
  const innerH = innerTop - innerBottom

  if (node.openingShape === 'arch') {
    addShape(
      mesh,
      baseMaterial,
      createArchedFrameShape(
        width,
        height,
        getClampedArchHeight(width, height, node.archHeight),
        frameThickness,
      ),
      frameDepth,
    )
  } else {
    addShape(
      mesh,
      baseMaterial,
      createRoundedFrameShape(
        width,
        height,
        frameThickness,
        getWindowRoundedRadii(node, width, height),
      ),
      frameDepth,
    )
  }

  if (innerW > 0.01 && innerH > 0.01) {
    const openAmount = getWindowRenderOpenAmount(node)
    const slatCount = Math.max(4, Math.min(9, Math.round(height / 0.22)))
    const slatGap = innerH / slatCount
    const slatHeight = Math.max(Math.min(slatGap * 0.62, 0.14), 0.045)
    const slatDepth = Math.max(frameDepth * 0.16, 0.012)
    const slatAngle = -openAmount * (Math.PI / 3)
    const railThickness = Math.max(frameThickness * 0.45, 0.022)
    const slatInset = railThickness + 0.004
    const slats = new THREE.Group()

    slats.name = LOUVERED_WINDOW_SLATS_NAME
    mesh.add(slats)

    const getBoundsAtY =
      node.openingShape === 'arch'
        ? (() => {
            const outerArchHeight = getClampedArchHeight(width, height, node.archHeight)
            const archHeight = getClampedArchHeight(innerW, innerH, outerArchHeight - inset)
            const springY = top - outerArchHeight
            return (y: number) => {
              const half = getArchedOpeningHalfWidthAtY(y, innerW / 2, springY, archHeight)
              return { minX: -half, maxX: half }
            }
          })()
        : (() => {
            const innerRadii = insetCornerRadii(
              getWindowRoundedRadii(node, width, height),
              inset,
              innerW,
              innerH,
            )
            return (y: number) =>
              getRoundedHorizontalBoundsAtY(y, innerLeft, innerRight, innerTop, innerRadii)
          })()

    const addVerticalRail = (x: number) => {
      const railX1 = x
      const railX2 = x + (x < 0 ? railThickness : -railThickness)
      const sampleX = x < 0 ? Math.max(railX1, railX2) : Math.min(railX1, railX2)
      const railTop =
        node.openingShape === 'arch'
          ? getArchBoundaryY(
              sampleX,
              innerW / 2,
              top - getClampedArchHeight(width, height, node.archHeight),
              getClampedArchHeight(
                innerW,
                innerH,
                getClampedArchHeight(width, height, node.archHeight) - inset,
              ),
            )
          : getRoundedBoundaryYAtX(
              sampleX,
              innerLeft,
              innerRight,
              innerTop,
              insetCornerRadii(getWindowRoundedRadii(node, width, height), inset, innerW, innerH),
            )
      addShape(
        mesh,
        baseMaterial,
        createRectShape(Math.min(railX1, railX2), Math.max(railX1, railX2), innerBottom, railTop),
        frameDepth * 0.95,
      )
    }

    addVerticalRail(innerLeft)
    addVerticalRail(innerRight)

    for (let index = 0; index < slatCount; index += 1) {
      const y = innerTop - slatGap * (index + 0.5)
      const topBounds = getBoundsAtY(Math.min(y + slatHeight / 2, innerTop))
      const bottomBounds = getBoundsAtY(Math.max(y - slatHeight / 2, innerBottom))
      const minX = Math.max(topBounds.minX, bottomBounds.minX) + slatInset
      const maxX = Math.min(topBounds.maxX, bottomBounds.maxX) - slatInset
      const slatW = Math.max(maxX - minX, 0)
      if (slatW <= 0.01) continue

      const slat = new THREE.Group()
      slat.position.set((minX + maxX) / 2, y, 0)
      slat.rotation.x = slatAngle
      slats.add(slat)
      addBox(slat, glassMaterial, slatW, slatHeight, slatDepth, 0, 0, 0)
    }
  }

  if (sill) {
    const sillW = width + sillDepth * 0.4
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }
}

function updateWindowMesh(node: WindowNode, mesh: THREE.Mesh) {
  // Root mesh is an invisible hitbox; all visuals live in child meshes
  mesh.geometry.dispose()
  mesh.geometry = new THREE.BoxGeometry(node.width, node.height, node.frameDepth)
  mesh.material = hitboxMaterial

  // Sync transform from node (React may lag behind the system by a frame during drag)
  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])

  // Dispose and remove all old visual children; preserve 'cutout'
  for (const child of [...mesh.children]) {
    if (child.name === 'cutout') continue
    disposeObjectGeometry(child)
    mesh.remove(child)
  }

  const {
    width,
    height,
    frameDepth,
    frameThickness,
    columnRatios,
    rowRatios,
    columnDividerThickness,
    rowDividerThickness,
    sill,
    sillDepth,
    sillThickness,
    openingKind,
    openingShape,
    windowType,
  } = node

  if (openingKind === 'opening') {
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'sliding') {
    addSlidingWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'casement') {
    addCasementWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'awning') {
    addAwningWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'hopper') {
    addAwningWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'single-hung') {
    addSingleHungWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'double-hung') {
    addDoubleHungWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'bay') {
    addBayWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'bow') {
    addBowWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (windowType === 'louvered') {
    addLouveredWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (openingShape === 'arch') {
    addArchedWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  if (openingShape === 'rounded') {
    addRoundedWindowVisuals(node, mesh)
    syncWindowCutout(node, mesh)
    return
  }

  const innerW = width - 2 * frameThickness
  const innerH = height - 2 * frameThickness

  // ── Frame members ──
  // Top / bottom — full width
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    height / 2 - frameThickness / 2,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    width,
    frameThickness,
    frameDepth,
    0,
    -height / 2 + frameThickness / 2,
    0,
  )
  // Left / right — inner height to avoid corner overlap
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    -width / 2 + frameThickness / 2,
    0,
    0,
  )
  addBox(
    mesh,
    baseMaterial,
    frameThickness,
    innerH,
    frameDepth,
    width / 2 - frameThickness / 2,
    0,
    0,
  )

  // ── Pane grid ──
  const numCols = columnRatios.length
  const numRows = rowRatios.length

  const usableW = innerW - (numCols - 1) * columnDividerThickness
  const usableH = innerH - (numRows - 1) * rowDividerThickness

  const colSum = columnRatios.reduce((a, b) => a + b, 0)
  const rowSum = rowRatios.reduce((a, b) => a + b, 0)
  const colWidths = columnRatios.map((r) => (r / colSum) * usableW)
  const rowHeights = rowRatios.map((r) => (r / rowSum) * usableH)

  // Compute column x-centers starting from left edge of inner area
  const colXCenters: number[] = []
  let cx = -innerW / 2
  for (let c = 0; c < numCols; c++) {
    colXCenters.push(cx + colWidths[c]! / 2)
    cx += colWidths[c]!
    if (c < numCols - 1) cx += columnDividerThickness
  }

  // Compute row y-centers starting from top edge of inner area (R1 = top)
  const rowYCenters: number[] = []
  let cy = innerH / 2
  for (let r = 0; r < numRows; r++) {
    rowYCenters.push(cy - rowHeights[r]! / 2)
    cy -= rowHeights[r]!
    if (r < numRows - 1) cy -= rowDividerThickness
  }

  // Column dividers — full inner height
  cx = -innerW / 2
  for (let c = 0; c < numCols - 1; c++) {
    cx += colWidths[c]!
    addBox(
      mesh,
      baseMaterial,
      columnDividerThickness,
      innerH,
      frameDepth,
      cx + columnDividerThickness / 2,
      0,
      0,
    )
    cx += columnDividerThickness
  }

  // Row dividers — per column width, so they don't overlap column dividers (top to bottom)
  cy = innerH / 2
  for (let r = 0; r < numRows - 1; r++) {
    cy -= rowHeights[r]!
    const divY = cy - rowDividerThickness / 2
    for (let c = 0; c < numCols; c++) {
      addBox(
        mesh,
        baseMaterial,
        colWidths[c]!,
        rowDividerThickness,
        frameDepth,
        colXCenters[c]!,
        divY,
        0,
      )
    }
    cy -= rowDividerThickness
  }

  // Glass panes
  const glassDepth = Math.max(0.004, frameDepth * 0.08)
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < numRows; r++) {
      addBox(
        mesh,
        glassMaterial,
        colWidths[c]!,
        rowHeights[r]!,
        glassDepth,
        colXCenters[c]!,
        rowYCenters[r]!,
        0,
      )
    }
  }

  // ── Sill ──
  if (sill) {
    const sillW = width + sillDepth * 0.4 // slightly wider than frame
    // Protrudes from the front face of the frame (+Z)
    const sillZ = frameDepth / 2 + sillDepth / 2
    addBox(
      mesh,
      baseMaterial,
      sillW,
      sillThickness,
      sillDepth,
      0,
      -height / 2 - sillThickness / 2,
      sillZ,
    )
  }

  syncWindowCutout(node, mesh)
}

function syncWindowCutout(node: WindowNode, mesh: THREE.Mesh) {
  // ── Cutout (for wall CSG) — always full window dimensions, 1m deep ──
  let cutout = mesh.getObjectByName('cutout') as THREE.Mesh | undefined
  if (!cutout) {
    cutout = new THREE.Mesh()
    cutout.name = 'cutout'
    mesh.add(cutout)
  }
  cutout.geometry.dispose()
  if (isRectangleOnlyWindowType(node)) {
    cutout.geometry = new THREE.BoxGeometry(node.width, node.height, 1.0)
  } else if (node.openingShape === 'arch') {
    cutout.geometry = new THREE.ExtrudeGeometry(
      createArchShape(
        -node.width / 2,
        node.width / 2,
        -node.height / 2,
        node.height / 2,
        getClampedArchHeight(node.width, node.height, node.archHeight),
      ),
      {
        depth: 1,
        bevelEnabled: false,
        curveSegments: 24,
      },
    )
    cutout.geometry.translate(0, 0, -0.5)
  } else if (node.openingShape === 'rounded') {
    cutout.geometry = new THREE.ExtrudeGeometry(
      createRoundedShape(
        -node.width / 2,
        node.width / 2,
        -node.height / 2,
        node.height / 2,
        getWindowRoundedRadii(node, node.width, node.height),
      ),
      {
        depth: 1,
        bevelEnabled: false,
        curveSegments: 24,
      },
    )
    cutout.geometry.translate(0, 0, -0.5)
  } else {
    cutout.geometry = new THREE.BoxGeometry(node.width, node.height, 1.0)
  }
  cutout.visible = false
}
