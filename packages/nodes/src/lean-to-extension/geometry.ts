import type { GeometryContext, LeanToExtensionNode, SurfaceRole } from '@pascal-app/core'
import {
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, type Material, Mesh, Quaternion, Vector3 } from 'three'
import { bendLocalPoint, bendRotationYAtLocalX, isCurvedLeanTo } from './arc'
import { readLeanToCornerJointMetadata } from './corner-joint'
import { LEAN_TO_EXTENSION_GEOMETRY_REVISION, resolveLeanToLayout } from './layout'
import { LEAN_TO_SLOT_DEFAULTS, type LeanToSlotId } from './slots'

// Number of straight facets used to approximate a curved member spanning the arc.
export function leanToFacetCount(node: LeanToExtensionNode): number {
  if (!isCurvedLeanTo(node)) return 1
  return Math.max(4, Math.min(32, Math.ceil(node.span / 0.4)))
}

export function leanToExtensionGeometryKey(node: LeanToExtensionNode): string {
  return JSON.stringify([
    LEAN_TO_EXTENSION_GEOMETRY_REVISION,
    node.span,
    node.spanArcCenterZ,
    node.spanArcRadius,
    node.projection,
    node.highEdgeHeight,
    node.pitch,
    node.roofThickness,
    node.highOverhang,
    node.lowOverhang,
    node.leftOverhang,
    node.rightOverhang,
    node.coveringType,
    node.beamWidth,
    node.beamHeight,
    node.ledgerDepth,
    node.ledgerHeight,
    node.highSideMode,
    node.ledgerVerticalOffset,
    node.lowBeamInset,
    node.rafterWidth,
    node.rafterHeight,
    node.rafterSpacing,
    node.rafterEndInset,
    node.postWidth,
    node.postDepth,
    node.postCount,
    node.postLayoutMode,
    node.postSpacing,
    node.postInset,
    node.postBracing,
    node.footingStyle,
    node.sideFlashing,
    node.flashingProjection,
    node.flashingHeight,
    node.slots,
    node.framingStrategy,
    node.purlinWidth,
    node.purlinHeight,
    node.purlinSpacing,
    node.leftEndCondition,
    node.rightEndCondition,
    readLeanToCornerJointMetadata(node),
  ])
}

function addBox(
  group: Group,
  args: {
    name: string
    size: [number, number, number]
    position: [number, number, number]
    rotationX?: number
    rotationY?: number
    role: SurfaceRole
    colorPreset: ColorPreset
    sceneTheme?: string
    material?: Material
    slotId?: LeanToSlotId
  },
) {
  const geometry = new BoxGeometry(...args.size)
  applyWorldScaleBoxUVs(geometry, ...args.size)
  const mesh = new Mesh(
    geometry,
    args.material ??
      createSurfaceRoleMaterial(args.role, args.colorPreset, FrontSide, args.sceneTheme),
  )
  mesh.name = args.name
  mesh.position.set(...args.position)
  // YXZ: apply pitch (X) first, then yaw (Y) around vertical to face along the arc.
  mesh.rotation.set(args.rotationX ?? 0, args.rotationY ?? 0, 0, 'YXZ')
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.surfaceRole = args.role
  if (args.slotId) mesh.userData.slotId = args.slotId
  group.add(mesh)
}

function addBoxBetween(
  group: Group,
  args: {
    name: string
    start: [number, number, number]
    end: [number, number, number]
    width: number
    height: number
    role: SurfaceRole
    colorPreset: ColorPreset
    sceneTheme?: string
    material: Material
    slotId: LeanToSlotId
  },
) {
  const start = new Vector3(...args.start)
  const end = new Vector3(...args.end)
  const direction = end.clone().sub(start)
  const length = direction.length()
  if (length <= 1e-6) return
  const geometry = new BoxGeometry(args.width, args.height, length)
  applyWorldScaleBoxUVs(geometry, args.width, args.height, length)
  const mesh = new Mesh(geometry, args.material)
  mesh.name = args.name
  mesh.position.copy(start.add(end).multiplyScalar(0.5))
  mesh.quaternion.copy(
    new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction.normalize()),
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.surfaceRole = args.role
  mesh.userData.slotId = args.slotId
  group.add(mesh)
}

function addMiteredBeam(
  group: Group,
  args: {
    minX: number
    maxX: number
    leftMiterCenter: number | null
    rightMiterCenter: number | null
    leftMiterSlope: number
    rightMiterSlope: number
    height: number
    depth: number
    y: number
    z: number
    colorPreset: ColorPreset
    sceneTheme?: string
    material: Material
  },
) {
  const length = args.maxX - args.minX
  if (length <= 1e-6) return
  const centerX = (args.minX + args.maxX) / 2
  const halfLength = length / 2
  const geometry = new BoxGeometry(length, args.height, args.depth)
  applyWorldScaleBoxUVs(geometry, length, args.height, args.depth)
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index)
    const z = positions.getZ(index)
    if (args.leftMiterCenter !== null && Math.abs(x + halfLength) <= 1e-6) {
      positions.setX(index, args.leftMiterCenter - centerX - z * args.leftMiterSlope)
    } else if (args.rightMiterCenter !== null && Math.abs(x - halfLength) <= 1e-6) {
      positions.setX(index, args.rightMiterCenter - centerX + z * args.rightMiterSlope)
    }
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, args.material)
  mesh.name = 'lean-to-front-beam'
  mesh.position.set(centerX, args.y, args.z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.surfaceRole = 'joinery'
  mesh.userData.slotId = 'beam'
  group.add(mesh)
}

function resolveLeanToSlotMaterial(
  node: LeanToExtensionNode,
  slotId: LeanToSlotId,
  ctx: GeometryContext | undefined,
  shading: RenderShading,
  textures: boolean,
  role: SurfaceRole,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): Material {
  if (!textures) return createSurfaceRoleMaterial(role, colorPreset, FrontSide, sceneTheme)
  const ref = node.slots?.[slotId]
  const slotDefault = LEAN_TO_SLOT_DEFAULTS[slotId]
  return (
    (ref ? resolveMaterialRef(ref, ctx?.materials, shading) : null) ??
    (slotDefault
      ? resolveSlotDefaultMaterial(slotDefault, shading)
      : createSurfaceRoleMaterial(role, colorPreset, FrontSide, sceneTheme))
  )
}

export function buildLeanToExtensionGeometry(
  node: LeanToExtensionNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const layout = resolveLeanToLayout(node)
  const cornerJoints = readLeanToCornerJointMetadata(node)
  const group = new Group()
  group.name = 'lean-to-extension-geometry'

  const curved = isCurvedLeanTo(node)
  const facets = leanToFacetCount(node)
  const bend = (localX: number, localZ: number): [number, number] => {
    const point = bendLocalPoint(node, localX, localZ)
    return [point.x, point.y]
  }
  const bendRotY = (localX: number) => bendRotationYAtLocalX(node, localX)
  // Point-like member (post, rafter, brace): placed on the arc with a per-member yaw.
  const addBentBox = (args: {
    name: string
    size: [number, number, number]
    localX: number
    localZ: number
    y: number
    rotationX?: number
    role: SurfaceRole
    material?: Material
    slotId?: LeanToSlotId
  }) => {
    const [x, z] = bend(args.localX, args.localZ)
    addBox(group, {
      name: args.name,
      size: args.size,
      position: [x, args.y, z],
      rotationX: args.rotationX,
      rotationY: bendRotY(args.localX),
      role: args.role,
      colorPreset,
      sceneTheme,
      material: args.material,
      slotId: args.slotId,
    })
  }
  // Width-spanning member (roof strip, purlin, high beam): faceted along the arc.
  const addBentStrip = (args: {
    name: string
    centerX: number
    totalWidth: number
    height: number
    depth: number
    localZ: number
    y: number
    rotationX?: number
    role: SurfaceRole
    material?: Material
    slotId?: LeanToSlotId
  }) => {
    const count = curved ? facets : 1
    const facetWidth = args.totalWidth / count
    for (let index = 0; index < count; index++) {
      const centerX = args.centerX - args.totalWidth / 2 + (index + 0.5) * facetWidth
      const [x, z] = bend(centerX, args.localZ)
      addBox(group, {
        name: count > 1 ? `${args.name}-${index}` : args.name,
        size: [facetWidth + (count > 1 ? 0.004 : 0), args.height, args.depth],
        position: [x, args.y, z],
        rotationX: args.rotationX,
        rotationY: bendRotY(centerX),
        role: args.role,
        colorPreset,
        sceneTheme,
        material: args.material,
        slotId: args.slotId,
      })
    }
  }
  const flashingMaterial = resolveLeanToSlotMaterial(
    node,
    'flashing',
    ctx,
    shading,
    textures,
    'roof',
    colorPreset,
    sceneTheme,
  )
  const ledgerMaterial = resolveLeanToSlotMaterial(
    node,
    'ledger',
    ctx,
    shading,
    textures,
    'wall',
    colorPreset,
    sceneTheme,
  )
  const beamMaterial = resolveLeanToSlotMaterial(
    node,
    'beam',
    ctx,
    shading,
    textures,
    'wall',
    colorPreset,
    sceneTheme,
  )
  const framingMaterial = resolveLeanToSlotMaterial(
    node,
    'framing',
    ctx,
    shading,
    textures,
    'wall',
    colorPreset,
    sceneTheme,
  )
  const postsMaterial = resolveLeanToSlotMaterial(
    node,
    'posts',
    ctx,
    shading,
    textures,
    'joinery',
    colorPreset,
    sceneTheme,
  )
  const footingsMaterial = resolveLeanToSlotMaterial(
    node,
    'footings',
    ctx,
    shading,
    textures,
    'joinery',
    colorPreset,
    sceneTheme,
  )
  const footingHeight = node.footingStyle === 'concrete-pad' ? 0.12 : 0.04
  const footingScale = node.footingStyle === 'concrete-pad' ? 2 : 1.4

  if (!ctx) {
    addBentStrip({
      name: 'lean-to-preview-roof',
      centerX: layout.roofCenterX,
      totalWidth: layout.roofWidth,
      height: node.roofThickness,
      depth: layout.slopeLength,
      localZ: layout.roofCenterZ,
      y: layout.roofCenterY,
      rotationX: layout.pitchRadians,
      role: 'roof',
    })
  }

  if (node.highSideMode === 'independent-high-beam') {
    addBentStrip({
      name: 'lean-to-independent-high-beam',
      centerX: 0,
      totalWidth: layout.span,
      height: node.ledgerHeight,
      depth: node.ledgerDepth,
      localZ: 0,
      y:
        layout.highEdgeHeight -
        node.roofThickness / 2 -
        node.ledgerHeight / 2 +
        node.ledgerVerticalOffset,
      role: 'joinery',
      material: ledgerMaterial,
      slotId: 'ledger',
    })
  }

  if (node.sideFlashing) {
    for (const [side, condition] of [
      [-1, node.leftEndCondition],
      [1, node.rightEndCondition],
    ] as const) {
      if (condition !== 'wall-abutment') continue
      addBentBox({
        name: `lean-to-${side < 0 ? 'left' : 'right'}-side-flashing`,
        size: [node.flashingProjection, node.flashingHeight, layout.slopeLength],
        localX:
          side < 0 ? -(layout.span / 2 + node.leftOverhang) : layout.span / 2 + node.rightOverhang,
        localZ: layout.roofCenterZ,
        y: layout.roofCenterY + node.flashingHeight / 3,
        rotationX: layout.pitchRadians,
        role: 'roof',
        material: flashingMaterial,
        slotId: 'flashing',
      })
    }
  }

  const leftBeamExtension = cornerJoints.left?.beamExtension ?? 0
  const rightBeamExtension = cornerJoints.right?.beamExtension ?? 0
  const leftMiterCenter = cornerJoints.left ? -layout.span / 2 - leftBeamExtension : null
  const rightMiterCenter = cornerJoints.right ? layout.span / 2 + rightBeamExtension : null
  const beamMinX =
    leftMiterCenter === null ? -layout.beamSpan / 2 : leftMiterCenter - node.beamWidth / 2
  const beamMaxX =
    rightMiterCenter === null ? layout.beamSpan / 2 : rightMiterCenter + node.beamWidth / 2
  if (curved) {
    addBentStrip({
      name: 'lean-to-front-beam',
      centerX: (beamMinX + beamMaxX) / 2,
      totalWidth: beamMaxX - beamMinX,
      height: node.beamHeight,
      depth: node.beamWidth,
      localZ: layout.beamZ,
      y: layout.beamCenterY,
      role: 'joinery',
      material: beamMaterial,
      slotId: 'beam',
    })
  } else {
    addMiteredBeam(group, {
      minX: beamMinX,
      maxX: beamMaxX,
      leftMiterCenter,
      rightMiterCenter,
      leftMiterSlope: Math.tan(cornerJoints.left?.gutterMitre ?? 0),
      rightMiterSlope: Math.tan(cornerJoints.right?.gutterMitre ?? 0),
      height: node.beamHeight,
      depth: node.beamWidth,
      y: layout.beamCenterY,
      z: layout.beamZ,
      colorPreset,
      sceneTheme,
      material: beamMaterial,
    })
  }

  if (!ctx) {
    for (const [index, x] of layout.postXs.entries()) {
      addBentBox({
        name: `lean-to-post-${index}`,
        size: [node.postWidth, layout.postHeight, node.postDepth],
        localX: x,
        localZ: layout.beamZ,
        y: layout.postHeight / 2,
        role: 'joinery',
        material: postsMaterial,
        slotId: 'posts',
      })
      if (node.footingStyle !== 'none') {
        addBentBox({
          name: `lean-to-post-footing-${index}`,
          size: [node.postWidth * footingScale, footingHeight, node.postDepth * footingScale],
          localX: x,
          localZ: layout.beamZ,
          y: footingHeight / 2,
          role: 'joinery',
          material: footingsMaterial,
          slotId: 'footings',
        })
      }
    }
  }

  if (!ctx && node.highSideMode === 'independent-high-beam') {
    const highPostHeight = Math.max(
      0.2,
      layout.highEdgeHeight -
        node.roofThickness / 2 -
        node.ledgerHeight +
        node.ledgerVerticalOffset,
    )
    for (const [index, x] of layout.postXs.entries()) {
      addBentBox({
        name: `lean-to-high-post-${index}`,
        size: [node.postWidth, highPostHeight, node.postDepth],
        localX: x,
        localZ: 0,
        y: highPostHeight / 2,
        role: 'joinery',
        material: postsMaterial,
        slotId: 'posts',
      })
      if (node.footingStyle !== 'none') {
        addBentBox({
          name: `lean-to-high-post-footing-${index}`,
          size: [node.postWidth * footingScale, footingHeight, node.postDepth * footingScale],
          localX: x,
          localZ: 0,
          y: footingHeight / 2,
          role: 'joinery',
          material: footingsMaterial,
          slotId: 'footings',
        })
      }
    }
  }

  if (node.postBracing === 'knee') {
    for (const [index, x] of layout.postXs.entries()) {
      addBentBox({
        name: `lean-to-knee-brace-${index}`,
        size: [node.rafterWidth, node.rafterHeight, Math.min(0.8, layout.projection / 2)],
        localX: x,
        localZ: Math.max(0, layout.beamZ - 0.22),
        y: layout.beamCenterY - 0.22,
        rotationX: Math.PI / 4,
        role: 'joinery',
        material: framingMaterial,
        slotId: 'framing',
      })
    }
  }

  if (node.framingStrategy === 'rafters') {
    const regularRafters = layout.rafterXs.filter(
      (_x, index) =>
        !(cornerJoints.left && index === 0) &&
        !(cornerJoints.right && index === layout.rafterXs.length - 1),
    )
    for (const [index, x] of regularRafters.entries()) {
      addBentBox({
        name: `lean-to-rafter-${index}`,
        size: [node.rafterWidth, node.rafterHeight, layout.rafterSlopeLength],
        localX: x,
        localZ: layout.rafterCenterZ,
        y: layout.rafterCenterY,
        rotationX: layout.pitchRadians,
        role: 'joinery',
        material: framingMaterial,
        slotId: 'framing',
      })
    }
    const roofBuildUp =
      node.roofThickness / Math.max(0.1, Math.cos(layout.pitchRadians)) +
      (node.shingleThickness ?? 0.025) * Math.cos(layout.pitchRadians)
    const rafterY = (z: number) =>
      layout.highEdgeHeight -
      z * Math.tan(layout.pitchRadians) -
      roofBuildUp -
      node.rafterHeight / 2
    for (const [side, joint] of Object.entries(cornerJoints)) {
      if (!(joint?.sharedPostOwner && joint.seam)) continue
      const [start, end] = joint.seam
      addBoxBetween(group, {
        name: `lean-to-${side}-corner-rafter`,
        start: [start[0], rafterY(start[1]), start[1]],
        end: [end[0], rafterY(end[1]), end[1]],
        width: node.rafterWidth,
        height: node.rafterHeight,
        role: 'joinery',
        colorPreset,
        sceneTheme,
        material: framingMaterial,
        slotId: 'framing',
      })
    }
  } else if (node.framingStrategy === 'purlins' || node.framingStrategy === 'covering-specific') {
    const coveringSpacing = node.coveringType === 'shingle' ? 0.4 : 0.6
    const spacing =
      node.framingStrategy === 'covering-specific'
        ? Math.min(node.purlinSpacing, coveringSpacing)
        : node.purlinSpacing
    const count = Math.max(2, Math.ceil(layout.rafterSlopeLength / spacing) + 1)
    for (let index = 0; index < count; index++) {
      const fraction = index / (count - 1)
      const z = fraction * layout.rafterCenterZ * 2
      const y = layout.rafterCenterY + (layout.rafterCenterZ - z) * Math.tan(layout.pitchRadians)
      addBentStrip({
        name: `lean-to-purlin-${index}`,
        centerX: layout.roofCenterX,
        totalWidth: layout.roofWidth,
        height: node.purlinHeight,
        depth: node.purlinWidth,
        localZ: z,
        y,
        rotationX: layout.pitchRadians,
        role: 'joinery',
        material: framingMaterial,
        slotId: 'framing',
      })
    }
  }

  return group
}
