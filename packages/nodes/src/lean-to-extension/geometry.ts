import type { GeometryContext, LeanToExtensionNode, SurfaceRole } from '@pascal-app/core'
import {
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
} from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, type Material, Mesh } from 'three'
import { LEAN_TO_EXTENSION_GEOMETRY_REVISION, resolveLeanToLayout } from './layout'

export function leanToExtensionGeometryKey(node: LeanToExtensionNode): string {
  return JSON.stringify([
    LEAN_TO_EXTENSION_GEOMETRY_REVISION,
    node.span,
    node.projection,
    node.highEdgeHeight,
    node.pitch,
    node.roofThickness,
    node.eaveOverhang,
    node.sideOverhang,
    node.beamWidth,
    node.beamHeight,
    node.ledgerDepth,
    node.ledgerHeight,
    node.rafterWidth,
    node.rafterHeight,
    node.postWidth,
    node.postDepth,
    node.postCount,
    node.postInset,
    node.highSideFlashing,
    node.sideFlashing,
    node.flashingProjection,
    node.flashingHeight,
    node.flashingMaterial,
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
  group.add(mesh)
}

export function buildLeanToExtensionGeometry(
  node: LeanToExtensionNode,
  _ctx?: GeometryContext,
  _shading: RenderShading = 'rendered',
  _textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const layout = resolveLeanToLayout(node)
  const group = new Group()
  group.name = 'lean-to-extension-geometry'
  const flashingMaterial = createMaterial(node.flashingMaterial, _shading)

  if (!_ctx) {
    addBox(group, {
      name: 'lean-to-preview-roof',
      size: [layout.span + 2 * node.sideOverhang, node.roofThickness, layout.slopeLength],
      position: [0, layout.roofCenterY, layout.roofCenterZ],
      rotationX: layout.pitchRadians,
      role: 'roof',
      colorPreset,
      sceneTheme,
    })
  }

  addBox(group, {
    name: 'lean-to-ledger',
    size: [layout.span, node.ledgerHeight, node.ledgerDepth],
    position: [0, layout.highEdgeHeight - node.roofThickness / 2 - node.ledgerHeight / 2, 0],
    role: 'joinery',
    colorPreset,
    sceneTheme,
  })

  if (node.highSideFlashing) {
    addBox(group, {
      name: 'lean-to-high-side-flashing',
      size: [layout.span + 2 * node.sideOverhang, node.flashingHeight, node.flashingProjection],
      position: [
        0,
        layout.highEdgeHeight + node.flashingHeight / 2 - 0.015,
        -node.flashingProjection / 2,
      ],
      role: 'roof',
      colorPreset,
      sceneTheme,
      material: flashingMaterial,
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
          side * (layout.span / 2 + node.sideOverhang),
          layout.roofCenterY + node.flashingHeight / 3,
          layout.roofCenterZ,
        ],
        rotationX: layout.pitchRadians,
        role: 'roof',
        colorPreset,
        sceneTheme,
        material: flashingMaterial,
      })
    }
  }

  addBox(group, {
    name: 'lean-to-front-beam',
    size: [layout.beamSpan, node.beamHeight, node.beamWidth],
    position: [0, layout.beamCenterY, layout.projection],
    role: 'joinery',
    colorPreset,
    sceneTheme,
  })

  if (!_ctx) {
    for (const [index, x] of layout.postXs.entries()) {
      addBox(group, {
        name: `lean-to-post-${index}`,
        size: [node.postWidth, layout.postHeight, node.postDepth],
        position: [x, layout.postHeight / 2, layout.projection],
        role: 'joinery',
        colorPreset,
        sceneTheme,
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
      })
    }
  } else if (node.framingStrategy === 'purlins' || node.framingStrategy === 'covering-specific') {
    const spacing =
      node.framingStrategy === 'covering-specific'
        ? Math.min(node.purlinSpacing, 0.6)
        : node.purlinSpacing
    const count = Math.max(2, Math.ceil(layout.rafterSlopeLength / spacing) + 1)
    for (let index = 0; index < count; index++) {
      const fraction = index / (count - 1)
      const z = fraction * layout.rafterCenterZ * 2
      const y = layout.rafterCenterY + (layout.rafterCenterZ - z) * Math.tan(layout.pitchRadians)
      addBox(group, {
        name: `lean-to-purlin-${index}`,
        size: [layout.span, node.purlinHeight, node.purlinWidth],
        position: [0, y, z],
        rotationX: layout.pitchRadians,
        role: 'joinery',
        colorPreset,
        sceneTheme,
      })
    }
  }

  return group
}
