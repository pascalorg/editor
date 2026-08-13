import type { GeometryContext, LeanToExtensionNode, SurfaceRole } from '@pascal-app/core'
import {
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
} from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, Mesh } from 'three'
import { LEAN_TO_EXTENSION_GEOMETRY_REVISION, resolveLeanToLayout } from './layout'

export function leanToExtensionGeometryKey(node: LeanToExtensionNode): string {
  return JSON.stringify([
    LEAN_TO_EXTENSION_GEOMETRY_REVISION,
    node.span,
    node.projection,
    node.highEdgeHeight,
    node.pitch,
    node.connectionInset,
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
  },
) {
  const geometry = new BoxGeometry(...args.size)
  applyWorldScaleBoxUVs(geometry, ...args.size)
  const mesh = new Mesh(
    geometry,
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

  if (!_ctx) {
    addBox(group, {
      name: 'lean-to-preview-roof',
      size: [layout.span + 2 * node.sideOverhang, node.roofThickness, layout.visibleSlopeLength],
      position: [0, layout.visibleRoofCenterY, layout.visibleRoofCenterZ],
      rotationX: layout.pitchRadians,
      role: 'roof',
      colorPreset,
      sceneTheme,
    })
  }

  const connectionRun = layout.roofRun - layout.visibleRoofRun
  if (connectionRun > 0.001) {
    const connectionCenterZ = connectionRun / 2
    const roofBuildUp =
      node.roofThickness / Math.max(0.1, Math.cos(layout.pitchRadians)) +
      (node.shingleThickness ?? 0.025) * Math.cos(layout.pitchRadians)
    addBox(group, {
      name: 'lean-to-connection-underlap',
      size: [
        layout.span + 2 * node.sideOverhang,
        node.rafterHeight,
        connectionRun / Math.max(0.001, Math.cos(layout.pitchRadians)),
      ],
      position: [
        0,
        layout.highEdgeHeight -
          connectionCenterZ * Math.tan(layout.pitchRadians) -
          roofBuildUp -
          node.rafterHeight / 2,
        connectionCenterZ,
      ],
      rotationX: layout.pitchRadians,
      role: 'joinery',
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

  return group
}
