import type { GeometryContext, LeanToExtensionNode, SurfaceRole } from '@pascal-app/core'
import {
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, type Material, Mesh } from 'three'
import { LEAN_TO_EXTENSION_GEOMETRY_REVISION, resolveLeanToLayout } from './layout'
import { LEAN_TO_SLOT_DEFAULTS, type LeanToSlotId } from './slots'

export function leanToExtensionGeometryKey(node: LeanToExtensionNode): string {
  return JSON.stringify([
    LEAN_TO_EXTENSION_GEOMETRY_REVISION,
    node.span,
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
  ])
}

function addBox(
  group: Group,
  args: {
    name: string
    size: [number, number, number]
    position: [number, number, number]
    rotationX?: number
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
  mesh.rotation.x = args.rotationX ?? 0
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.surfaceRole = args.role
  if (args.slotId) mesh.userData.slotId = args.slotId
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
  const group = new Group()
  group.name = 'lean-to-extension-geometry'
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
    addBox(group, {
      name: 'lean-to-preview-roof',
      size: [layout.roofWidth, node.roofThickness, layout.slopeLength],
      position: [layout.roofCenterX, layout.roofCenterY, layout.roofCenterZ],
      rotationX: layout.pitchRadians,
      role: 'roof',
      colorPreset,
      sceneTheme,
    })
  }

  if (node.highSideMode === 'independent-high-beam') {
    addBox(group, {
      name: 'lean-to-independent-high-beam',
      size: [layout.span, node.ledgerHeight, node.ledgerDepth],
      position: [
        0,
        layout.highEdgeHeight -
          node.roofThickness / 2 -
          node.ledgerHeight / 2 +
          node.ledgerVerticalOffset,
        0,
      ],
      role: 'joinery',
      colorPreset,
      sceneTheme,
      material: ledgerMaterial,
      slotId: 'ledger',
    })
  }

  if (node.sideFlashing) {
    for (const [side, condition] of [
      [-1, node.leftEndCondition],
      [1, node.rightEndCondition],
    ] as const) {
      if (condition === 'open') continue
      addBox(group, {
        name: `lean-to-${side < 0 ? 'left' : 'right'}-side-flashing`,
        size: [node.flashingProjection, node.flashingHeight, layout.slopeLength],
        position: [
          side < 0 ? -(layout.span / 2 + node.leftOverhang) : layout.span / 2 + node.rightOverhang,
          layout.roofCenterY + node.flashingHeight / 3,
          layout.roofCenterZ,
        ],
        rotationX: layout.pitchRadians,
        role: 'roof',
        colorPreset,
        sceneTheme,
        material: flashingMaterial,
        slotId: 'flashing',
      })
    }
  }

  addBox(group, {
    name: 'lean-to-front-beam',
    size: [layout.beamSpan, node.beamHeight, node.beamWidth],
    position: [0, layout.beamCenterY, layout.beamZ],
    role: 'joinery',
    colorPreset,
    sceneTheme,
    material: beamMaterial,
    slotId: 'beam',
  })

  if (!ctx) {
    for (const [index, x] of layout.postXs.entries()) {
      addBox(group, {
        name: `lean-to-post-${index}`,
        size: [node.postWidth, layout.postHeight, node.postDepth],
        position: [x, layout.postHeight / 2, layout.beamZ],
        role: 'joinery',
        colorPreset,
        sceneTheme,
        material: postsMaterial,
        slotId: 'posts',
      })
      if (node.footingStyle !== 'none') {
        addBox(group, {
          name: `lean-to-post-footing-${index}`,
          size: [node.postWidth * footingScale, footingHeight, node.postDepth * footingScale],
          position: [x, footingHeight / 2, layout.beamZ],
          role: 'joinery',
          colorPreset,
          sceneTheme,
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
      addBox(group, {
        name: `lean-to-high-post-${index}`,
        size: [node.postWidth, highPostHeight, node.postDepth],
        position: [x, highPostHeight / 2, 0],
        role: 'joinery',
        colorPreset,
        sceneTheme,
        material: postsMaterial,
        slotId: 'posts',
      })
      if (node.footingStyle !== 'none') {
        addBox(group, {
          name: `lean-to-high-post-footing-${index}`,
          size: [node.postWidth * footingScale, footingHeight, node.postDepth * footingScale],
          position: [x, footingHeight / 2, 0],
          role: 'joinery',
          colorPreset,
          sceneTheme,
          material: footingsMaterial,
          slotId: 'footings',
        })
      }
    }
  }

  if (node.postBracing === 'knee') {
    for (const [index, x] of layout.postXs.entries()) {
      addBox(group, {
        name: `lean-to-knee-brace-${index}`,
        size: [node.rafterWidth, node.rafterHeight, Math.min(0.8, layout.projection / 2)],
        position: [x, layout.beamCenterY - 0.22, Math.max(0, layout.beamZ - 0.22)],
        rotationX: Math.PI / 4,
        role: 'joinery',
        colorPreset,
        sceneTheme,
        material: framingMaterial,
        slotId: 'framing',
      })
    }
  }

  if (node.framingStrategy === 'rafters') {
    for (const [index, x] of layout.rafterXs.entries()) {
      addBox(group, {
        name: `lean-to-rafter-${index}`,
        size: [node.rafterWidth, node.rafterHeight, layout.rafterSlopeLength],
        position: [x, layout.rafterCenterY, layout.rafterCenterZ],
        rotationX: layout.pitchRadians,
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
      addBox(group, {
        name: `lean-to-purlin-${index}`,
        size: [layout.roofWidth, node.purlinHeight, node.purlinWidth],
        position: [layout.roofCenterX, y, z],
        rotationX: layout.pitchRadians,
        role: 'joinery',
        colorPreset,
        sceneTheme,
        material: framingMaterial,
        slotId: 'framing',
      })
    }
  }

  return group
}
