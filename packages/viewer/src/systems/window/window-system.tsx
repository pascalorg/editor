import { type AnyNodeId, sceneRegistry, useScene, type WindowNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { baseMaterial, glassMaterial } from '../../lib/materials'

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })

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
    if (child instanceof THREE.Mesh) child.geometry.dispose()
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
  } = node

  if (openingKind === 'opening') {
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
  if (node.openingShape === 'arch') {
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
