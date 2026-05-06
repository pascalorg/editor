import { type AnyNodeId, type DoorNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { baseMaterial, glassMaterial } from '../../lib/materials'

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })

export const DoorSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'door') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (!mesh) return // Keep dirty until mesh mounts

      updateDoorMesh(node as DoorNode, mesh)
      clearDirty(id as AnyNodeId)

      // Rebuild the parent wall so its cutout reflects the updated door geometry
      if ((node as DoorNode).parentId) {
        useScene.getState().dirtyNodes.add((node as DoorNode).parentId as AnyNodeId)
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
) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  })
  geometry.translate(0, 0, -depth / 2)
  const mesh = new THREE.Mesh(geometry, material)
  parent.add(mesh)
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

function getArchBoundaryY(x: number, halfWidth: number, springY: number, archHeight: number) {
  if (halfWidth <= 1e-6) return springY
  const t = Math.min(Math.abs(x) / halfWidth, 1)
  return springY + archHeight * Math.sqrt(Math.max(1 - t * t, 0))
}

function createArchBandShape(
  width: number,
  outerSpringY: number,
  outerTopY: number,
  innerSpringY: number,
  innerTopY: number,
  insetX: number,
) {
  const halfWidth = width / 2
  const innerHalfWidth = Math.max(halfWidth - insetX, 0)
  const outerArchHeight = Math.max(outerTopY - outerSpringY, 0)
  const safeInnerTopY = Math.min(innerTopY, outerTopY - 0.001)
  const safeInnerSpringY = Math.min(innerSpringY, safeInnerTopY - 0.001)
  const innerArchHeight = Math.max(safeInnerTopY - safeInnerSpringY, 0)
  const shape = new THREE.Shape()
  const segments = 32
  const getSafeInnerBoundaryY = (x: number) =>
    Math.min(
      getArchBoundaryY(x, innerHalfWidth, safeInnerSpringY, innerArchHeight),
      getArchBoundaryY(x, halfWidth, outerSpringY, outerArchHeight) - 0.001,
    )

  shape.moveTo(-halfWidth, outerSpringY)
  for (let index = 1; index <= segments; index += 1) {
    const x = -halfWidth + width * (index / segments)
    shape.lineTo(x, getArchBoundaryY(x, halfWidth, outerSpringY, outerArchHeight))
  }

  if (innerHalfWidth <= 0.001 || safeInnerTopY <= safeInnerSpringY + 0.001) {
    shape.lineTo(halfWidth, outerSpringY)
    shape.closePath()
    return shape
  }

  shape.lineTo(innerHalfWidth, outerSpringY)
  shape.lineTo(innerHalfWidth, getSafeInnerBoundaryY(innerHalfWidth))
  for (let index = segments - 1; index >= 0; index -= 1) {
    const x = -innerHalfWidth + innerHalfWidth * 2 * (index / segments)
    shape.lineTo(x, getSafeInnerBoundaryY(x))
  }
  shape.lineTo(-innerHalfWidth, outerSpringY)
  shape.lineTo(-halfWidth, outerSpringY)
  shape.closePath()

  return shape
}

function createArchHeadBarShape(width: number, bottomY: number, springY: number, topY: number) {
  const halfWidth = width / 2
  const archHeight = Math.max(topY - springY, 0)
  const shape = new THREE.Shape()
  const segments = 32

  shape.moveTo(-halfWidth, bottomY)
  shape.lineTo(halfWidth, bottomY)
  shape.lineTo(halfWidth, springY)
  for (let index = 1; index <= segments; index += 1) {
    const x = halfWidth - width * (index / segments)
    shape.lineTo(x, getArchBoundaryY(x, halfWidth, springY, archHeight))
  }
  shape.lineTo(-halfWidth, bottomY)
  shape.closePath()

  return shape
}

type TopCornerRadii = {
  topLeft: number
  topRight: number
}

function normalizeTopCornerRadii(
  radii: TopCornerRadii,
  width: number,
  height: number,
): TopCornerRadii {
  const next = { ...radii }
  const scale = Math.min(
    1,
    width / Math.max(next.topLeft + next.topRight, 1e-6),
    height / Math.max(next.topLeft, 1e-6),
    height / Math.max(next.topRight, 1e-6),
  )

  if (scale < 1) {
    next.topLeft *= scale
    next.topRight *= scale
  }

  return next
}

function getDoorTopRadii(node: DoorNode, width: number, height: number): TopCornerRadii {
  if (node.openingRadiusMode === 'individual') {
    const [topLeft = 0, topRight = 0] = node.openingTopRadii ?? [0.15, 0.15]
    return normalizeTopCornerRadii(
      {
        topLeft: Math.max(topLeft, 0),
        topRight: Math.max(topRight, 0),
      },
      width,
      height,
    )
  }

  const maxRadius = Math.min(width / 2, height)
  const radius = Math.min(Math.max(node.cornerRadius ?? 0.15, 0), maxRadius)
  return { topLeft: radius, topRight: radius }
}

function createRoundedTopShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  radii: TopCornerRadii,
) {
  const shape = new THREE.Shape()
  const { topLeft, topRight } = normalizeTopCornerRadii(radii, right - left, top - bottom)

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
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

  shape.lineTo(left, bottom)
  shape.closePath()
  return shape
}

function createRoundedDoorFrameShape(
  width: number,
  height: number,
  frameThickness: number,
  radii: TopCornerRadii,
) {
  const halfWidth = width / 2
  const bottom = -height / 2
  const top = height / 2
  const outerRadii = normalizeTopCornerRadii(radii, width, height)
  const outer = createRoundedTopShape(-halfWidth, halfWidth, bottom, top, outerRadii)
  const inset = Math.min(frameThickness, width / 2 - 0.005, height - 0.005)

  if (inset <= 0.001) return outer

  const innerLeft = -halfWidth + inset
  const innerRight = halfWidth - inset
  const innerTop = top - inset
  const innerRadii = normalizeTopCornerRadii(
    {
      topLeft: Math.max(outerRadii.topLeft - inset, 0),
      topRight: Math.max(outerRadii.topRight - inset, 0),
    },
    innerRight - innerLeft,
    innerTop - bottom,
  )
  const holeShape = createRoundedTopShape(innerLeft, innerRight, bottom, innerTop, innerRadii)
  const hole = new THREE.Path(holeShape.getPoints(32).reverse())
  outer.holes.push(hole)

  return outer
}

function shapeToReversedPath(shape: THREE.Shape) {
  return new THREE.Path(shape.getPoints(40).reverse())
}

function createRoundedLeafFrameShape(
  width: number,
  bottom: number,
  top: number,
  radii: TopCornerRadii,
  insetX: number,
  insetY: number,
) {
  const halfWidth = width / 2
  const outerRadii = normalizeTopCornerRadii(radii, width, top - bottom)
  const outer = createRoundedTopShape(-halfWidth, halfWidth, bottom, top, outerRadii)
  const innerLeft = -halfWidth + insetX
  const innerRight = halfWidth - insetX
  const innerBottom = bottom + insetY
  const innerTop = top - insetY

  if (innerRight <= innerLeft + 0.01 || innerTop <= innerBottom + 0.01) return outer

  const innerRadii = normalizeTopCornerRadii(
    {
      topLeft: Math.max(outerRadii.topLeft - Math.max(insetX, insetY), 0),
      topRight: Math.max(outerRadii.topRight - Math.max(insetX, insetY), 0),
    },
    innerRight - innerLeft,
    innerTop - innerBottom,
  )
  outer.holes.push(
    shapeToReversedPath(
      createRoundedTopShape(innerLeft, innerRight, innerBottom, innerTop, innerRadii),
    ),
  )

  return outer
}

function createTopClippedRectShape(
  left: number,
  right: number,
  bottom: number,
  top: number,
  getBoundaryY: (x: number) => number,
) {
  const segments = 20
  const points: { x: number; y: number }[] = []

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments
    const x = right + (left - right) * t
    const y = Math.min(top, getBoundaryY(x))
    if (y > bottom + 0.001) points.push({ x, y })
  }

  if (points.length < 2) return null

  const shape = new THREE.Shape()
  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  for (const point of points) {
    shape.lineTo(point.x, point.y)
  }
  shape.closePath()
  return shape
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
}

function updateDoorMesh(node: DoorNode, mesh: THREE.Mesh) {
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
    disposeObject(child)
    mesh.remove(child)
  }

  const {
    width,
    height,
    openingKind,
    openingShape,
    frameThickness,
    frameDepth,
    threshold,
    thresholdHeight,
    segments,
    handle,
    handleHeight,
    handleSide,
    doorCloser,
    panicBar,
    panicBarHeight,
    contentPadding,
    hingesSide,
    swingDirection,
    swingAngle = 0,
  } = node
  const hasLeafContent = segments.some((seg) => seg.type !== 'empty')
  const clampedSwingAngle = Math.max(0, Math.min(Math.PI / 2, swingAngle))

  if (openingKind === 'opening') {
    syncDoorCutout(node, mesh)
    return
  }

  // Leaf occupies the full opening (no bottom frame bar — door opens to floor)
  const leafW = width - 2 * frameThickness
  const leafH = height - frameThickness // only top frame
  const leafDepth = 0.04
  // Leaf center is shifted down from door center by half the top frame
  const leafCenterY = -frameThickness / 2
  const hingeX = hingesSide === 'right' ? leafW / 2 : -leafW / 2
  const swingDirectionSign = swingDirection === 'inward' ? 1 : -1
  const hingeDirectionSign = hingesSide === 'right' ? 1 : -1
  const leafSwingRotation = clampedSwingAngle * swingDirectionSign * hingeDirectionSign
  const leafGroup = new THREE.Group()
  leafGroup.position.set(hingeX, 0, 0)
  leafGroup.rotation.y = leafSwingRotation
  mesh.add(leafGroup)
  const addLeafBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(leafGroup, material, w, h, d, x - hingeX, y, z)
  const addLeafShape = (shape: THREE.Shape, material: THREE.Material, depth: number, z = 0) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      curveSegments: 24,
    })
    geometry.translate(-hingeX, 0, -depth / 2 + z)
    const leafMesh = new THREE.Mesh(geometry, material)
    leafGroup.add(leafMesh)
  }

  // ── Frame members ──
  if (openingShape === 'arch') {
    const frameBottom = -height / 2
    const frameTop = height / 2
    const frameArchHeight = getClampedArchHeight(width, height, node.archHeight)
    const frameSpringY = frameTop - frameArchHeight
    const frameInnerTopY = frameTop - frameThickness
    const frameInnerSpringY = Math.min(frameSpringY + frameThickness, frameInnerTopY)
    const useShallowHeadBar = frameArchHeight <= frameThickness * 2
    const frameHeadBottomY = useShallowHeadBar ? frameSpringY - frameThickness : frameSpringY
    const postHeight = Math.max(frameHeadBottomY - frameBottom, 0.01)

    addBox(
      mesh,
      baseMaterial,
      frameThickness,
      postHeight,
      frameDepth,
      -width / 2 + frameThickness / 2,
      frameBottom + postHeight / 2,
      0,
    )
    addBox(
      mesh,
      baseMaterial,
      frameThickness,
      postHeight,
      frameDepth,
      width / 2 - frameThickness / 2,
      frameBottom + postHeight / 2,
      0,
    )
    addShape(
      mesh,
      baseMaterial,
      useShallowHeadBar
        ? createArchHeadBarShape(width, frameHeadBottomY, frameSpringY, frameTop)
        : createArchBandShape(
            width,
            frameSpringY,
            frameTop,
            frameInnerSpringY,
            frameInnerTopY,
            frameThickness,
          ),
      frameDepth,
    )
  } else if (openingShape === 'rounded') {
    addShape(
      mesh,
      baseMaterial,
      createRoundedDoorFrameShape(
        width,
        height,
        frameThickness,
        getDoorTopRadii(node, width, height),
      ),
      frameDepth,
    )
  } else {
    // Left post — full height
    addBox(
      mesh,
      baseMaterial,
      frameThickness,
      height,
      frameDepth,
      -width / 2 + frameThickness / 2,
      0,
      0,
    )
    // Right post — full height
    addBox(
      mesh,
      baseMaterial,
      frameThickness,
      height,
      frameDepth,
      width / 2 - frameThickness / 2,
      0,
      0,
    )
    // Head (top bar) — full width
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
  }

  // ── Threshold (inside the frame) ──
  if (threshold) {
    addBox(
      mesh,
      baseMaterial,
      leafW,
      thresholdHeight,
      frameDepth,
      0,
      -height / 2 + thresholdHeight / 2,
      0,
    )
  }

  const usesShapedLeaf = openingShape === 'arch' || openingShape === 'rounded'
  const leafBottom = leafCenterY - leafH / 2
  const leafTop = leafCenterY + leafH / 2
  const leafArchHeight = getClampedArchHeight(
    leafW,
    leafH,
    Math.max((node.archHeight ?? leafW / 2) - frameThickness, 0.01),
  )
  const leafArchSpringY = leafTop - leafArchHeight
  const frameRadii = getDoorTopRadii(node, width, height)
  const leafTopRadii = normalizeTopCornerRadii(
    {
      topLeft: Math.max(frameRadii.topLeft - frameThickness, 0),
      topRight: Math.max(frameRadii.topRight - frameThickness, 0),
    },
    leafW,
    leafH,
  )
  const cpX = contentPadding[0]
  const cpY = contentPadding[1]
  const useShallowLeafHeadBar = openingShape === 'arch' && cpY > 0 && leafArchHeight <= cpY * 2
  const shallowLeafHeadBottomY = leafArchSpringY - cpY
  const getLeafBoundaryY = (x: number) => {
    if (openingShape === 'arch') {
      if (useShallowLeafHeadBar) return shallowLeafHeadBottomY

      const innerTop = leafTop - cpY
      const innerSpringY = Math.min(Math.max(leafArchSpringY + cpY, leafBottom + cpY), innerTop)
      const innerArchHeight = Math.max(innerTop - innerSpringY, 0.001)
      const halfContentW = Math.max((leafW - 2 * cpX) / 2, 0.001)
      const outerBoundaryY = getArchBoundaryY(x, leafW / 2, leafArchSpringY, leafArchHeight)
      return Math.min(
        getArchBoundaryY(x, halfContentW, innerSpringY, innerArchHeight),
        outerBoundaryY - 0.001,
      )
    }

    if (openingShape === 'rounded') {
      const left = -leafW / 2 + cpX
      const right = leafW / 2 - cpX
      const top = leafTop - cpY
      const innerRadii = normalizeTopCornerRadii(
        {
          topLeft: Math.max(leafTopRadii.topLeft - Math.max(cpX, cpY), 0),
          topRight: Math.max(leafTopRadii.topRight - Math.max(cpX, cpY), 0),
        },
        right - left,
        top - (leafBottom + cpY),
      )

      if (innerRadii.topLeft > 1e-6 && x < left + innerRadii.topLeft) {
        const centerX = left + innerRadii.topLeft
        const centerY = top - innerRadii.topLeft
        const dx = x - centerX
        return centerY + Math.sqrt(Math.max(innerRadii.topLeft * innerRadii.topLeft - dx * dx, 0))
      }

      if (innerRadii.topRight > 1e-6 && x > right - innerRadii.topRight) {
        const centerX = right - innerRadii.topRight
        const centerY = top - innerRadii.topRight
        const dx = x - centerX
        return centerY + Math.sqrt(Math.max(innerRadii.topRight * innerRadii.topRight - dx * dx, 0))
      }

      return top
    }

    return leafTop
  }
  const createLeafCellShape = (left: number, right: number, bottom: number, top: number) =>
    createTopClippedRectShape(left, right, bottom, top, getLeafBoundaryY)

  // ── Leaf — contentPadding border strips (no full backing; glass areas are open) ──
  if (hasLeafContent && openingShape === 'arch') {
    const leafInnerTopY = leafTop - cpY
    const leafInnerSpringY = Math.min(
      Math.max(leafArchSpringY + cpY, leafBottom + cpY),
      leafInnerTopY,
    )
    const sideBottom = leafBottom + cpY
    const sideTop = useShallowLeafHeadBar ? shallowLeafHeadBottomY : leafArchSpringY
    const sideHeight = Math.max(sideTop - sideBottom, 0)

    if (cpY > 0) {
      addLeafBox(baseMaterial, leafW, cpY, leafDepth, 0, leafBottom + cpY / 2, 0)
    }
    if (cpX > 0 && sideHeight > 0.01) {
      addLeafBox(
        baseMaterial,
        cpX,
        sideHeight,
        leafDepth,
        -leafW / 2 + cpX / 2,
        sideBottom + sideHeight / 2,
        0,
      )
      addLeafBox(
        baseMaterial,
        cpX,
        sideHeight,
        leafDepth,
        leafW / 2 - cpX / 2,
        sideBottom + sideHeight / 2,
        0,
      )
    }
    addLeafShape(
      useShallowLeafHeadBar
        ? createArchHeadBarShape(leafW, shallowLeafHeadBottomY, leafArchSpringY, leafTop)
        : createArchBandShape(
            leafW,
            leafArchSpringY,
            leafTop,
            leafInnerSpringY,
            leafInnerTopY,
            cpX,
          ),
      baseMaterial,
      leafDepth,
    )
  } else if (hasLeafContent && openingShape === 'rounded') {
    addLeafShape(
      createRoundedLeafFrameShape(leafW, leafBottom, leafTop, leafTopRadii, cpX, cpY),
      baseMaterial,
      leafDepth,
    )
  } else if (hasLeafContent && cpY > 0) {
    // Top strip
    addLeafBox(baseMaterial, leafW, cpY, leafDepth, 0, leafCenterY + leafH / 2 - cpY / 2, 0)
    // Bottom strip
    addLeafBox(baseMaterial, leafW, cpY, leafDepth, 0, leafCenterY - leafH / 2 + cpY / 2, 0)
  }
  if (hasLeafContent && !usesShapedLeaf && cpX > 0) {
    const innerH = leafH - 2 * cpY
    // Left strip
    addLeafBox(baseMaterial, cpX, innerH, leafDepth, -leafW / 2 + cpX / 2, leafCenterY, 0)
    // Right strip
    addLeafBox(baseMaterial, cpX, innerH, leafDepth, leafW / 2 - cpX / 2, leafCenterY, 0)
  }

  // Content area inside padding
  const contentW = leafW - 2 * cpX
  const contentH = leafH - 2 * cpY

  // ── Segments (stacked top to bottom within content area) ──
  const totalRatio = segments.reduce((sum, s) => sum + s.heightRatio, 0)
  const contentTop = leafCenterY + contentH / 2

  let segY = contentTop
  for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
    const seg = segments[segIndex]!
    const segH = (seg.heightRatio / totalRatio) * contentH
    const segCenterY = segY - segH / 2
    const segTop = segY
    const segBottom = segY - segH

    const numCols = seg.columnRatios.length
    const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
    const usableW = contentW - (numCols - 1) * seg.dividerThickness
    const colWidths = seg.columnRatios.map((r) => (r / colSum) * usableW)

    // Column x-centers (relative to mesh center)
    const colXCenters: number[] = []
    let cx = -contentW / 2
    for (let c = 0; c < numCols; c++) {
      colXCenters.push(cx + colWidths[c]! / 2)
      cx += colWidths[c]!
      if (c < numCols - 1) cx += seg.dividerThickness
    }

    // Column dividers within this segment
    if (seg.type !== 'empty') {
      cx = -contentW / 2
      for (let c = 0; c < numCols - 1; c++) {
        cx += colWidths[c]!
        if (usesShapedLeaf) {
          const dividerLeft = cx
          const dividerRight = cx + seg.dividerThickness
          const dividerShape = createLeafCellShape(dividerLeft, dividerRight, segBottom, segTop)
          if (dividerShape) {
            addLeafShape(dividerShape, baseMaterial, 0.012, leafDepth / 2 + 0.006)
          }
        } else {
          addLeafBox(
            baseMaterial,
            seg.dividerThickness,
            segH,
            leafDepth + 0.001,
            cx + seg.dividerThickness / 2,
            segCenterY,
            0,
          )
        }
        cx += seg.dividerThickness
      }
    }

    // Segment content per column
    for (let c = 0; c < numCols; c++) {
      const colW = colWidths[c]!
      const colX = colXCenters[c]!
      const cellLeft = colX - colW / 2
      const cellRight = colX + colW / 2

      if (seg.type === 'glass') {
        const glassDepth = Math.max(0.004, leafDepth * 0.15)
        if (usesShapedLeaf) {
          const shape = createLeafCellShape(cellLeft, cellRight, segBottom, segTop)
          if (shape)
            addLeafShape(shape, glassMaterial, glassDepth, leafDepth / 2 + glassDepth / 2 + 0.004)
        } else {
          // Glass only — no opaque backing so it's truly transparent
          addLeafBox(glassMaterial, colW, segH, glassDepth, colX, segCenterY, 0)
        }
      } else if (seg.type === 'panel') {
        if (usesShapedLeaf) {
          const shape = createLeafCellShape(cellLeft, cellRight, segBottom, segTop)
          if (shape) addLeafShape(shape, baseMaterial, leafDepth)
        } else {
          // Opaque leaf backing for this column
          addLeafBox(baseMaterial, colW, segH, leafDepth, colX, segCenterY, 0)
        }
        // Raised panel detail
        const panelW = colW - 2 * seg.panelInset
        const panelH = segH - 2 * seg.panelInset
        if (panelW > 0.01 && panelH > 0.01) {
          const effectiveDepth = Math.abs(seg.panelDepth) < 0.002 ? 0.005 : Math.abs(seg.panelDepth)
          const panelZ = leafDepth / 2 + effectiveDepth / 2
          if (usesShapedLeaf) {
            const shape = createLeafCellShape(
              colX - panelW / 2,
              colX + panelW / 2,
              segCenterY - panelH / 2,
              segCenterY + panelH / 2,
            )
            if (shape) addLeafShape(shape, baseMaterial, effectiveDepth, panelZ)
          } else {
            addLeafBox(baseMaterial, panelW, panelH, effectiveDepth, colX, segCenterY, panelZ)
          }
        }
      } else {
        // 'empty' leaves the opening unfilled
      }
    }

    if (usesShapedLeaf && segIndex < segments.length - 1) {
      const railThickness = Math.min(Math.max(cpY, 0.02), Math.max(segH * 0.35, 0.02))
      const railShape = createLeafCellShape(
        -contentW / 2,
        contentW / 2,
        segBottom - railThickness / 2,
        segBottom + railThickness / 2,
      )
      if (railShape) addLeafShape(railShape, baseMaterial, 0.012, leafDepth / 2 + 0.006)
    }

    segY -= segH
  }

  // ── Handle ──
  if (hasLeafContent && handle) {
    // Convert from floor-based height to mesh-center-based Y
    const handleY = handleHeight - height / 2
    // Handle grip sits on the front face (+Z) of the leaf
    const faceZ = leafDepth / 2

    // X position: handleSide refers to which side the grip is on
    const handleX = handleSide === 'right' ? leafW / 2 - 0.045 : -leafW / 2 + 0.045

    // Backplate
    addLeafBox(baseMaterial, 0.028, 0.14, 0.01, handleX, handleY, faceZ + 0.005)
    // Grip lever
    addLeafBox(baseMaterial, 0.022, 0.1, 0.035, handleX, handleY, faceZ + 0.025)
  }

  // ── Door closer (commercial hardware at top) ──
  if (hasLeafContent && doorCloser) {
    const closerY = leafCenterY + leafH / 2 - 0.04
    // Body
    addLeafBox(baseMaterial, 0.28, 0.055, 0.055, 0, closerY, leafDepth / 2 + 0.03)
    // Arm (simplified as thin bar to frame side)
    addLeafBox(baseMaterial, 0.14, 0.015, 0.015, leafW / 4, closerY + 0.025, leafDepth / 2 + 0.015)
  }

  // ── Panic bar ──
  if (hasLeafContent && panicBar) {
    const barY = panicBarHeight - height / 2
    addLeafBox(baseMaterial, leafW * 0.72, 0.04, 0.055, 0, barY, leafDepth / 2 + 0.03)
  }

  // ── Hinges (3 knuckle-style hinges on the hinge side) ──
  if (hasLeafContent) {
    const hingeX = hingesSide === 'right' ? leafW / 2 - 0.012 : -leafW / 2 + 0.012
    const hingeZ = 0 // centered in leaf depth
    const hingeH = 0.1
    const hingeW = 0.024
    const hingeD = leafDepth + 0.016
    // Bottom hinge ~0.25m from floor, middle hinge, top hinge ~0.25m from top
    addBox(mesh, baseMaterial, hingeW, hingeH, hingeD, hingeX, leafBottom + 0.25, hingeZ)
    addBox(mesh, baseMaterial, hingeW, hingeH, hingeD, hingeX, (leafBottom + leafTop) / 2, hingeZ)
    addBox(mesh, baseMaterial, hingeW, hingeH, hingeD, hingeX, leafTop - 0.25, hingeZ)
  }

  syncDoorCutout(node, mesh)
}

function syncDoorCutout(node: DoorNode, mesh: THREE.Mesh) {
  // ── Cutout (for wall CSG) — always full door dimensions, 1m deep ──
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
      createRoundedTopShape(
        -node.width / 2,
        node.width / 2,
        -node.height / 2,
        node.height / 2,
        getDoorTopRadii(node, node.width, node.height),
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
