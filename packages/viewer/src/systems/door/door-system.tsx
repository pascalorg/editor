import {
  clampDoorOperationState,
  type AnyNodeId,
  type DoorNode,
  getDoorRenderOpenAmount,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { baseMaterial, glassMaterial } from '../../lib/materials'

// Invisible material for root mesh — used as selection hitbox only
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false })
const revealMaterial = new THREE.MeshBasicMaterial({ color: '#7f766c' })

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

function addRotatedBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotationY: number,
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  m.rotation.y = rotationY
  parent.add(m)
}

function addBoxWithRotation(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotation: [number, number, number],
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  m.rotation.set(rotation[0], rotation[1], rotation[2])
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

function addLeafSegmentContent({
  addLeafBox,
  leafWidth,
  leafHeight,
  leafCenterX,
  leafCenterY,
  leafDepth,
  segments,
  contentPadding,
  keepFrameWhenEmpty = false,
}: {
  addLeafBox: (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => void
  leafWidth: number
  leafHeight: number
  leafCenterX: number
  leafCenterY: number
  leafDepth: number
  segments: DoorNode['segments']
  contentPadding: DoorNode['contentPadding']
  keepFrameWhenEmpty?: boolean
}) {
  const hasLeafContent = segments.some((seg) => seg.type !== 'empty')
  const shouldRenderFrame = hasLeafContent || keepFrameWhenEmpty
  const cpX = contentPadding[0]
  const cpY = contentPadding[1]
  if (shouldRenderFrame && cpY > 0) {
    addLeafBox(
      baseMaterial,
      leafWidth,
      cpY,
      leafDepth,
      leafCenterX,
      leafCenterY + leafHeight / 2 - cpY / 2,
      0,
    )
    addLeafBox(
      baseMaterial,
      leafWidth,
      cpY,
      leafDepth,
      leafCenterX,
      leafCenterY - leafHeight / 2 + cpY / 2,
      0,
    )
  }
  if (shouldRenderFrame && cpX > 0) {
    const innerH = leafHeight - 2 * cpY
    addLeafBox(
      baseMaterial,
      cpX,
      innerH,
      leafDepth,
      leafCenterX - leafWidth / 2 + cpX / 2,
      leafCenterY,
      0,
    )
    addLeafBox(
      baseMaterial,
      cpX,
      innerH,
      leafDepth,
      leafCenterX + leafWidth / 2 - cpX / 2,
      leafCenterY,
      0,
    )
  }

  const contentW = leafWidth - 2 * cpX
  const contentH = leafHeight - 2 * cpY
  const totalRatio = segments.reduce((sum, s) => sum + s.heightRatio, 0)
  const contentTop = leafCenterY + contentH / 2

  let segY = contentTop
  for (const seg of segments) {
    const segH = (seg.heightRatio / totalRatio) * contentH
    const segCenterY = segY - segH / 2
    const numCols = seg.columnRatios.length
    const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
    const usableW = contentW - (numCols - 1) * seg.dividerThickness
    const colWidths = seg.columnRatios.map((r) => (r / colSum) * usableW)

    const colXCenters: number[] = []
    let cx = leafCenterX - contentW / 2
    for (let c = 0; c < numCols; c++) {
      colXCenters.push(cx + colWidths[c]! / 2)
      cx += colWidths[c]!
      if (c < numCols - 1) cx += seg.dividerThickness
    }

    if (seg.type !== 'empty') {
      cx = leafCenterX - contentW / 2
      for (let c = 0; c < numCols - 1; c++) {
        cx += colWidths[c]!
        addLeafBox(
          baseMaterial,
          seg.dividerThickness,
          segH,
          leafDepth + 0.001,
          cx + seg.dividerThickness / 2,
          segCenterY,
          0,
        )
        cx += seg.dividerThickness
      }
    }

    for (let c = 0; c < numCols; c++) {
      const colW = colWidths[c]!
      const colX = colXCenters[c]!

      if (seg.type === 'glass') {
        const glassDepth = Math.max(0.004, leafDepth * 0.15)
        addLeafBox(glassMaterial, colW, segH, glassDepth, colX, segCenterY, 0)
      } else if (seg.type === 'panel') {
        addLeafBox(baseMaterial, colW, segH, leafDepth, colX, segCenterY, 0)
        const panelW = colW - 2 * seg.panelInset
        const panelH = segH - 2 * seg.panelInset
        if (panelW > 0.01 && panelH > 0.01) {
          const effectiveDepth = Math.abs(seg.panelDepth) < 0.002 ? 0.005 : Math.abs(seg.panelDepth)
          const panelZ = leafDepth / 2 + effectiveDepth / 2
          addLeafBox(baseMaterial, panelW, panelH, effectiveDepth, colX, segCenterY, panelZ)
        }
      }
    }

    segY -= segH
  }
}

function addDoorLeaf(
  mesh: THREE.Mesh,
  {
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    hingeX,
    hingeSide,
    swingRotation,
    segments,
    contentPadding,
    handle,
    handleBothSides = false,
    handleHeight,
    handleSide,
    doorCloser,
    panicBar,
    panicBarHeight,
    doorHeight,
  }: {
    leafWidth: number
    leafHeight: number
    leafCenterX: number
    leafCenterY: number
    leafDepth: number
    hingeX: number
    hingeSide: 'left' | 'right'
    swingRotation: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
    handle: boolean
    handleBothSides?: boolean
    handleHeight: number
    handleSide: DoorNode['handleSide']
    doorCloser: boolean
    panicBar: boolean
    panicBarHeight: number
    doorHeight: number
  },
) {
  const hasLeafContent = segments.some((seg) => seg.type !== 'empty')
  const leafGroup = new THREE.Group()
  leafGroup.position.set(hingeX, 0, 0)
  leafGroup.rotation.y = swingRotation
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

  addLeafSegmentContent({
    addLeafBox,
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
  })

  if (hasLeafContent && handle) {
    const handleY = handleHeight - doorHeight / 2
    const faceZ = leafDepth / 2
    const handleX =
      handleSide === 'right'
        ? leafCenterX + leafWidth / 2 - 0.045
        : leafCenterX - leafWidth / 2 + 0.045

    addLeafBox(baseMaterial, 0.028, 0.14, 0.01, handleX, handleY, faceZ + 0.005)
    addLeafBox(baseMaterial, 0.022, 0.1, 0.035, handleX, handleY, faceZ + 0.025)

    if (handleBothSides) {
      addLeafBox(baseMaterial, 0.028, 0.14, 0.01, handleX, handleY, -faceZ - 0.005)
      addLeafBox(baseMaterial, 0.022, 0.1, 0.035, handleX, handleY, -faceZ - 0.025)
    }
  }

  if (hasLeafContent && doorCloser) {
    const closerY = leafCenterY + leafHeight / 2 - 0.04
    addLeafBox(baseMaterial, 0.28, 0.055, 0.055, leafCenterX, closerY, leafDepth / 2 + 0.03)
    addLeafBox(
      baseMaterial,
      0.14,
      0.015,
      0.015,
      leafCenterX + leafWidth / 4,
      closerY + 0.025,
      leafDepth / 2 + 0.015,
    )
  }

  if (hasLeafContent && panicBar) {
    const barY = panicBarHeight - doorHeight / 2
    addLeafBox(baseMaterial, leafWidth * 0.72, 0.04, 0.055, leafCenterX, barY, leafDepth / 2 + 0.03)
  }

  if (hasLeafContent) {
    const hingeMarkerX = hingeSide === 'right' ? hingeX - 0.012 : hingeX + 0.012
    const hingeH = 0.1
    const hingeW = 0.024
    const hingeD = leafDepth + 0.016
    const leafBottom = leafCenterY - leafHeight / 2
    const leafTop = leafCenterY + leafHeight / 2
    addBox(mesh, baseMaterial, hingeW, hingeH, hingeD, hingeMarkerX, leafBottom + 0.25, 0)
    addBox(mesh, baseMaterial, hingeW, hingeH, hingeD, hingeMarkerX, (leafBottom + leafTop) / 2, 0)
    addBox(mesh, baseMaterial, hingeW, hingeH, hingeD, hingeMarkerX, leafTop - 0.25, 0)
  }
}

function addFoldingDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
    leafCount,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
    leafCount: DoorNode['leafCount']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const panelCount = leafCount === 2 ? 2 : 4
  const foldAmount = clampDoorOperationState(operationState)
  const panelLength = insideWidth / panelCount
  const foldAngle = Math.PI * 0.44 * foldAmount

  addBox(
    mesh,
    baseMaterial,
    insideWidth,
    Math.min(frameThickness * 0.5, 0.025),
    Math.max(frameDepth * 0.45, 0.035),
    0,
    leafCenterY + leafHeight / 2 - 0.018,
    0,
  )

  const vertices: Array<{ x: number; z: number }> = [{ x: -insideWidth / 2, z: 0 }]
  for (let index = 0; index < panelCount; index++) {
    const previous = vertices[index]!
    const direction = index % 2 === 0 ? -1 : 1
    const angle = direction * foldAngle
    vertices.push({
      x: previous.x + panelLength * Math.cos(angle),
      z: previous.z + panelLength * Math.sin(angle),
    })
  }

  for (let index = 0; index < panelCount; index++) {
    const start = vertices[index]!
    const end = vertices[index + 1]!
    const dx = end.x - start.x
    const dz = end.z - start.z
    const centerX = (start.x + end.x) / 2
    const centerZ = (start.z + end.z) / 2
    const rotationY = Math.atan2(-dz, dx)
    const localX = {
      x: Math.cos(rotationY),
      z: -Math.sin(rotationY),
    }

    const addFoldingLeafBox = (
      material: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
    ) => {
      addRotatedBox(
        mesh,
        material,
        w,
        h,
        d,
        centerX + localX.x * x + Math.sin(rotationY) * z,
        y,
        centerZ + localX.z * x + Math.cos(rotationY) * z,
        rotationY,
      )
    }

    addLeafSegmentContent({
      addLeafBox: addFoldingLeafBox,
      leafWidth: Math.max(0.08, panelLength),
      leafHeight,
      leafCenterX: 0,
      leafCenterY,
      leafDepth,
      segments,
      contentPadding,
      keepFrameWhenEmpty: true,
    })

    for (const point of [start, end]) {
      addBox(
        mesh,
        revealMaterial,
        0.018,
        leafHeight * 0.92,
        leafDepth + 0.016,
        point.x,
        leafCenterY,
        point.z,
      )
    }
  }

  const handlePoint = vertices[vertices.length - 1]!
  const handleY = handleHeight - doorHeight / 2
  addBox(
    mesh,
    baseMaterial,
    0.035,
    0.16,
    leafDepth + 0.035,
    handlePoint.x - 0.035,
    handleY,
    handlePoint.z + 0.045,
  )
  addBox(
    mesh,
    baseMaterial,
    0.035,
    0.16,
    leafDepth + 0.035,
    handlePoint.x - 0.035,
    handleY,
    handlePoint.z - 0.045,
  )
}

function addPocketDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
    slideDirection,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const openAmount = clampDoorOperationState(operationState)
  const slideSign = slideDirection === 'right' ? 1 : -1
  const leafWidth = insideWidth
  const leafCenterX = slideSign * insideWidth * openAmount
  const topY = leafCenterY + leafHeight / 2
  const pocketCenterX = slideSign * insideWidth
  const handleY = handleHeight - doorHeight / 2
  const handleX = leafCenterX - slideSign * (leafWidth / 2 - 0.055)

  addBox(
    mesh,
    baseMaterial,
    insideWidth * 2,
    Math.min(frameThickness * 0.45, 0.024),
    Math.max(frameDepth * 0.38, 0.03),
    slideSign * (insideWidth / 2),
    topY - 0.018,
    0,
  )
  addBox(
    mesh,
    revealMaterial,
    insideWidth * 0.9,
    0.018,
    Math.max(frameDepth * 0.32, 0.026),
    pocketCenterX,
    topY - 0.055,
    0,
  )
  addBox(
    mesh,
    revealMaterial,
    0.018,
    leafHeight * 0.94,
    leafDepth + 0.014,
    slideSign * insideWidth * 0.5,
    leafCenterY,
    0,
  )

  const addPocketLeafBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(mesh, material, w, h, d, x, y, z)

  addLeafSegmentContent({
    addLeafBox: addPocketLeafBox,
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
  })
  addBox(mesh, baseMaterial, 0.03, 0.18, leafDepth + 0.03, handleX, handleY, leafDepth / 2 + 0.02)
  addBox(mesh, baseMaterial, 0.03, 0.18, leafDepth + 0.03, handleX, handleY, -leafDepth / 2 - 0.02)
}

function addBarnDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
    slideDirection,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const openAmount = clampDoorOperationState(operationState)
  const slideSign = slideDirection === 'right' ? 1 : -1
  const leafWidth = insideWidth * 1.06
  const leafCenterX = slideSign * insideWidth * openAmount
  const faceZ = frameDepth / 2 + leafDepth / 2 + 0.028
  const trackY = leafCenterY + leafHeight / 2 + Math.max(frameThickness * 0.55, 0.045)
  const railLength = insideWidth * 2.25
  const railCenterX = slideSign * (insideWidth * 0.56)
  const handleY = handleHeight - doorHeight / 2
  const handleX = leafCenterX - slideSign * (leafWidth / 2 - 0.075)
  const wheelY = trackY - 0.075

  addBox(mesh, revealMaterial, railLength, 0.035, 0.035, railCenterX, trackY, faceZ + 0.01)
  addBox(mesh, revealMaterial, 0.05, 0.13, 0.035, -insideWidth / 2, trackY - 0.02, faceZ + 0.01)
  addBox(mesh, revealMaterial, 0.05, 0.13, 0.035, insideWidth / 2, trackY - 0.02, faceZ + 0.01)

  const addBarnLeafBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(mesh, material, w, h, d, x, y, faceZ + z)

  addLeafSegmentContent({
    addLeafBox: addBarnLeafBox,
    leafWidth,
    leafHeight,
    leafCenterX,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    keepFrameWhenEmpty: true,
  })

  addRotatedBox(
    mesh,
    revealMaterial,
    0.018,
    leafHeight * 0.86,
    0.012,
    leafCenterX,
    leafCenterY,
    faceZ + leafDepth / 2 + 0.014,
    -0.52,
  )
  addRotatedBox(
    mesh,
    revealMaterial,
    0.018,
    leafHeight * 0.86,
    0.012,
    leafCenterX,
    leafCenterY,
    faceZ + leafDepth / 2 + 0.014,
    0.52,
  )

  for (const offset of [-leafWidth * 0.28, leafWidth * 0.28]) {
    addBox(mesh, revealMaterial, 0.085, 0.085, 0.035, leafCenterX + offset, wheelY, faceZ + 0.022)
    addBox(
      mesh,
      revealMaterial,
      0.026,
      0.16,
      0.026,
      leafCenterX + offset,
      wheelY - 0.075,
      faceZ + 0.022,
    )
  }

  addBox(
    mesh,
    baseMaterial,
    0.032,
    0.22,
    leafDepth + 0.034,
    handleX,
    handleY,
    faceZ + leafDepth / 2 + 0.02,
  )
  addBox(
    mesh,
    baseMaterial,
    0.032,
    0.22,
    leafDepth + 0.034,
    handleX,
    handleY,
    faceZ - leafDepth / 2 - 0.02,
  )
}

function addSlidingDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
    slideDirection,
    doorHeight,
    handleHeight,
    segments,
    contentPadding,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
    slideDirection: DoorNode['slideDirection']
    doorHeight: number
    handleHeight: number
    segments: DoorNode['segments']
    contentPadding: DoorNode['contentPadding']
  },
) {
  const openAmount = clampDoorOperationState(operationState)
  const activeOnRight = slideDirection === 'left'
  const fixedSign = activeOnRight ? -1 : 1
  const activeSign = activeOnRight ? 1 : -1
  const panelWidth = insideWidth * 0.54
  const panelHeight = leafHeight
  const closedActiveX = activeSign * insideWidth * 0.23
  const fixedX = fixedSign * insideWidth * 0.23
  const activeX = closedActiveX - activeSign * insideWidth * 0.44 * openAmount
  const frontZ = leafDepth / 2 + 0.016
  const backZ = -leafDepth / 2 - 0.006
  const railY = leafCenterY + panelHeight / 2 - Math.min(frameThickness * 0.35, 0.02)
  const handleY = handleHeight - doorHeight / 2
  const handleX = activeX + activeSign * (panelWidth / 2 - 0.06)

  addBox(mesh, revealMaterial, insideWidth, 0.024, Math.max(frameDepth * 0.32, 0.026), 0, railY, 0)
  addBox(
    mesh,
    revealMaterial,
    insideWidth,
    0.018,
    Math.max(frameDepth * 0.28, 0.022),
    0,
    -leafHeight / 2 + 0.04,
    0,
  )

  const addFixedPanelBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(mesh, material, w, h, d, x + fixedX, y, z + backZ)

  const addActivePanelBox = (
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ) => addBox(mesh, material, w, h, d, x + activeX, y, z + frontZ)

  addLeafSegmentContent({
    addLeafBox: addFixedPanelBox,
    leafWidth: panelWidth,
    leafHeight: panelHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    keepFrameWhenEmpty: true,
  })
  addLeafSegmentContent({
    addLeafBox: addActivePanelBox,
    leafWidth: panelWidth,
    leafHeight: panelHeight,
    leafCenterX: 0,
    leafCenterY,
    leafDepth,
    segments,
    contentPadding,
    keepFrameWhenEmpty: true,
  })
  addBox(mesh, baseMaterial, 0.032, 0.24, 0.016, handleX, handleY, frontZ + leafDepth / 2 + 0.01)
  addBox(mesh, baseMaterial, 0.032, 0.24, 0.016, handleX, handleY, frontZ - leafDepth / 2 - 0.01)
}

function addGarageSectionalDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
    garagePanelCount,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
    garagePanelCount: number
  },
) {
  const openAmount = getDoorRenderOpenAmount('garage-sectional', operationState)
  const panelCount = Math.max(3, Math.min(12, Math.round(garagePanelCount)))
  const panelHeight = leafHeight / panelCount
  const panelGap = Math.min(0.012, panelHeight * 0.08)
  const travelDepth = Math.max(leafHeight, 1.4)
  const curveRadius = panelHeight * 0.58
  const curveLength = (Math.PI / 2) * curveRadius
  const travel = openAmount * ((panelCount - 1) * panelHeight + curveLength + panelHeight * 0.65)
  const overheadY = leafCenterY + leafHeight / 2 - panelHeight / 2
  const railY = leafCenterY + leafHeight / 2 - 0.04
  const railZ = -travelDepth / 2

  addBox(
    mesh,
    revealMaterial,
    0.035,
    Math.max(0.04, frameThickness * 0.75),
    travelDepth,
    -insideWidth / 2 + 0.035,
    railY,
    railZ,
  )
  addBox(
    mesh,
    revealMaterial,
    0.035,
    Math.max(0.04, frameThickness * 0.75),
    travelDepth,
    insideWidth / 2 - 0.035,
    railY,
    railZ,
  )

  for (let index = 0; index < panelCount; index++) {
    const orderFromTop = panelCount - 1 - index
    const pathPosition = travel - orderFromTop * panelHeight
    let y = overheadY + pathPosition
    let z = 0
    let rotationX = 0

    if (pathPosition > 0 && pathPosition <= curveLength) {
      const theta = pathPosition / curveRadius
      rotationX = -theta
      y = overheadY + curveRadius * Math.sin(theta)
      z = -curveRadius * (1 - Math.cos(theta))
    } else if (pathPosition > curveLength) {
      rotationX = -Math.PI / 2
      y = overheadY + curveRadius
      z = -(curveRadius + pathPosition - curveLength)
    }

    const revealOffset = (panelHeight - panelGap) * 0.22
    const trimDepth = 0.01
    const trimFaceOffset = leafDepth / 2 + trimDepth + 0.006
    const addSectionalTrim = (localY: number) => {
      addBoxWithRotation(
        mesh,
        revealMaterial,
        insideWidth - 0.16,
        0.012,
        trimDepth,
        0,
        y + localY * Math.cos(rotationX) - trimFaceOffset * Math.sin(rotationX),
        z + localY * Math.sin(rotationX) + trimFaceOffset * Math.cos(rotationX),
        [rotationX, 0, 0],
      )
    }

    addBoxWithRotation(
      mesh,
      baseMaterial,
      insideWidth,
      Math.max(0.04, panelHeight - panelGap),
      leafDepth,
      0,
      y,
      z,
      [rotationX, 0, 0],
    )
    addSectionalTrim(revealOffset)
    addSectionalTrim(-revealOffset)
  }

  addBox(mesh, revealMaterial, insideWidth, 0.032, Math.max(frameDepth * 0.36, 0.03), 0, railY, 0)
}

function addGarageRollupDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
  },
) {
  const openAmount = clampDoorOperationState(operationState)
  const slatHeight = Math.max(0.055, Math.min(0.11, leafHeight / 22))
  const visibleHeight = leafHeight * (1 - openAmount)
  const visibleSlatCount = Math.ceil(visibleHeight / slatHeight)
  const topY = leafCenterY + leafHeight / 2
  const curtainCenterY = topY - visibleHeight / 2
  const drumMaxRadius = Math.max(0.12, Math.min(0.22, leafHeight * 0.075))
  const drumY = topY + drumMaxRadius * 0.12
  const drumZ = -frameDepth / 2 - drumMaxRadius * 0.72

  addBox(
    mesh,
    revealMaterial,
    0.032,
    leafHeight,
    Math.max(frameDepth * 0.48, 0.035),
    -insideWidth / 2 + 0.03,
    leafCenterY,
    0,
  )
  addBox(
    mesh,
    revealMaterial,
    0.032,
    leafHeight,
    Math.max(frameDepth * 0.48, 0.035),
    insideWidth / 2 - 0.03,
    leafCenterY,
    0,
  )

  if (visibleHeight > 0.01) {
    addBox(mesh, baseMaterial, insideWidth, visibleHeight, leafDepth, 0, curtainCenterY, 0)

    for (let index = 0; index < visibleSlatCount; index++) {
      const y = topY - Math.min(visibleHeight, index * slatHeight)
      addBox(mesh, revealMaterial, insideWidth - 0.08, 0.01, 0.012, 0, y, leafDepth / 2 + 0.012)
    }

    addBox(
      mesh,
      revealMaterial,
      insideWidth - 0.04,
      0.028,
      leafDepth + 0.018,
      0,
      topY - visibleHeight,
      leafDepth / 2 + 0.004,
    )
  }

  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(drumMaxRadius, drumMaxRadius, insideWidth + frameThickness, 36),
    baseMaterial,
  )
  drum.position.set(0, drumY, drumZ)
  drum.rotation.z = Math.PI / 2
  mesh.add(drum)

  addBox(
    mesh,
    revealMaterial,
    insideWidth + frameThickness,
    0.026,
    Math.max(frameDepth * 0.52, 0.04),
    0,
    topY + 0.02,
    0,
  )
}

function addGarageTiltupDoor(
  mesh: THREE.Mesh,
  {
    insideWidth,
    leafHeight,
    leafCenterY,
    leafDepth,
    frameThickness,
    frameDepth,
    operationState,
  }: {
    insideWidth: number
    leafHeight: number
    leafCenterY: number
    leafDepth: number
    frameThickness: number
    frameDepth: number
    operationState: number
  },
) {
  const openAmount = clampDoorOperationState(operationState)
  const angle = (Math.PI / 2) * openAmount
  const hingeY = leafCenterY + leafHeight / 2
  const panelCenterY = hingeY - Math.cos(angle) * (leafHeight / 2)
  const panelCenterZ = -Math.sin(angle) * (leafHeight / 2)
  const railLength = Math.max(leafHeight * 0.72, 1.2)
  const railY = hingeY - frameThickness * 0.35
  const railZ = -railLength / 2

  addBox(
    mesh,
    revealMaterial,
    0.03,
    Math.max(frameThickness * 0.7, 0.035),
    railLength,
    -insideWidth / 2 + 0.04,
    railY,
    railZ,
  )
  addBox(
    mesh,
    revealMaterial,
    0.03,
    Math.max(frameThickness * 0.7, 0.035),
    railLength,
    insideWidth / 2 - 0.04,
    railY,
    railZ,
  )

  addBoxWithRotation(
    mesh,
    baseMaterial,
    insideWidth,
    leafHeight,
    leafDepth,
    0,
    panelCenterY,
    panelCenterZ,
    [-angle, 0, 0],
  )

  const insetWidth = Math.max(0.1, insideWidth - 0.22)
  const insetHeight = Math.max(0.1, leafHeight - 0.28)
  const trimDepth = 0.012
  const trimFaceOffset = leafDepth / 2 + trimDepth + 0.006
  const addTiltupTrim = (localX: number, localY: number, trimWidth: number, trimHeight: number) => {
    addBoxWithRotation(
      mesh,
      revealMaterial,
      trimWidth,
      trimHeight,
      trimDepth,
      localX,
      panelCenterY + localY * Math.cos(angle) + trimFaceOffset * Math.sin(angle),
      panelCenterZ - localY * Math.sin(angle) + trimFaceOffset * Math.cos(angle),
      [-angle, 0, 0],
    )
  }

  addTiltupTrim(0, insetHeight / 2, insetWidth, 0.018)
  addTiltupTrim(0, -insetHeight / 2, insetWidth, 0.018)
  addTiltupTrim(-insetWidth / 2, 0, 0.018, insetHeight)
  addTiltupTrim(insetWidth / 2, 0, 0.018, insetHeight)

  addBox(mesh, revealMaterial, insideWidth, 0.026, Math.max(frameDepth * 0.4, 0.035), 0, hingeY, 0)
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
    swingAngle: nodeSwingAngle = 0,
    doorType = 'hinged',
    operationState: nodeOperationState = 0,
    leafCount = 1,
    slideDirection = 'left',
    garagePanelCount = 4,
  } = node
  const runtimeDoorState = useInteractive.getState().doors[node.id]
  const swingAngle = runtimeDoorState?.swingAngle ?? nodeSwingAngle
  const operationState = runtimeDoorState?.operationState ?? nodeOperationState
  const clampedSwingAngle = Math.max(0, Math.min(Math.PI / 2, swingAngle))

  if (openingKind === 'opening') {
    syncDoorCutout(node, mesh)
    return
  }

  const insideWidth = width - 2 * frameThickness
  const leafH = height - frameThickness // only top frame
  const leafDepth = 0.04
  const leafCenterY = -frameThickness / 2
  const swingDirectionSign = swingDirection === 'inward' ? 1 : -1

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
      insideWidth,
      thresholdHeight,
      frameDepth,
      0,
      -height / 2 + thresholdHeight / 2,
      0,
    )
  }

  if (doorType === 'garage-sectional') {
    addGarageSectionalDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
      garagePanelCount,
    })
  } else if (doorType === 'garage-rollup') {
    addGarageRollupDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
    })
  } else if (doorType === 'garage-tiltup') {
    addGarageTiltupDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
    })
  } else if (doorType === 'folding') {
    addFoldingDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
      leafCount,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'pocket') {
    addPocketDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
      slideDirection,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'barn') {
    addBarnDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
      slideDirection,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'sliding') {
    addSlidingDoor(mesh, {
      insideWidth,
      leafHeight: leafH,
      leafCenterY,
      leafDepth,
      frameThickness,
      frameDepth,
      operationState,
      slideDirection,
      doorHeight: height,
      handleHeight,
      segments,
      contentPadding,
    })
  } else if (doorType === 'double' || doorType === 'french') {
    const doubleLeafW = insideWidth / 2
    addDoorLeaf(mesh, {
      leafWidth: doubleLeafW,
      leafHeight: leafH,
      leafCenterX: -insideWidth / 4,
      leafCenterY,
      leafDepth,
      hingeX: -insideWidth / 2,
      hingeSide: 'left',
      swingRotation: -clampedSwingAngle * swingDirectionSign,
      segments,
      contentPadding,
      handle,
      handleBothSides: doorType === 'double' || doorType === 'french',
      handleHeight,
      handleSide: 'right',
      doorCloser,
      panicBar,
      panicBarHeight,
      doorHeight: height,
    })
    addDoorLeaf(mesh, {
      leafWidth: doubleLeafW,
      leafHeight: leafH,
      leafCenterX: insideWidth / 4,
      leafCenterY,
      leafDepth,
      hingeX: insideWidth / 2,
      hingeSide: 'right',
      swingRotation: clampedSwingAngle * swingDirectionSign,
      segments,
      contentPadding,
      handle,
      handleBothSides: doorType === 'double' || doorType === 'french',
      handleHeight,
      handleSide: 'left',
      doorCloser: false,
      panicBar,
      panicBarHeight,
      doorHeight: height,
    })
  } else {
    const hingeX = hingesSide === 'right' ? insideWidth / 2 : -insideWidth / 2
    const hingeDirectionSign = hingesSide === 'right' ? 1 : -1
    addDoorLeaf(mesh, {
      leafWidth: insideWidth,
      leafHeight: leafH,
      leafCenterX: 0,
      leafCenterY,
      leafDepth,
      hingeX,
      hingeSide: hingesSide,
      swingRotation: clampedSwingAngle * swingDirectionSign * hingeDirectionSign,
      segments,
      contentPadding,
      handle,
      handleBothSides: doorType === 'hinged',
      handleHeight,
      handleSide,
      doorCloser,
      panicBar,
      panicBarHeight,
      doorHeight: height,
    })
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
