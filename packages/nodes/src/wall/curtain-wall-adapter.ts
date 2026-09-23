import { useLiveNodeOverrides, type WallNode } from '@pascal-app/core'
import type { WallGeometryAdapter } from '@pascal-app/viewer'
import type { Material, Mesh } from 'three'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { buildCurtainWallShadowGeometry, CURTAIN_WALL_SHADOW_NAME } from './curtain-wall-shadow'

function isOpaque(material: Material | undefined) {
  return material !== undefined && (!material.transparent || material.opacity >= 1)
}

const deferredShadowWalls = new Set<string>()

export const curtainWallGeometryAdapter: WallGeometryAdapter = {
  prepareChildren(wall, children, context) {
    if (wall.wallType !== 'curtain') {
      return { envelopeChildren: [...children], renderChildren: [...children] }
    }
    const renderChildren = children.map((child) => {
      if ((child.type !== 'door' && child.type !== 'window') || child.openingShape === 'rectangle')
        return child
      const override = useLiveNodeOverrides.getState().get(child.id)
      const liveBounds =
        context.isLive(child.id) &&
        (!override || 'position' in override || 'width' in override || 'height' in override)
      return liveBounds ? { ...child, openingShape: 'rectangle' as const } : child
    })
    return {
      envelopeChildren: renderChildren.filter(
        (child) => child.type !== 'door' && child.type !== 'window',
      ),
      renderChildren,
    }
  },
  buildGeometry(wall, envelope, children) {
    if (wall.wallType !== 'curtain') return envelope
    const livePreview = children.some(
      (child) =>
        (child.type === 'door' || child.type === 'window') &&
        useLiveNodeOverrides.getState().get(child.id) !== undefined,
    )
    const deferShadow = children.some((child) => {
      if (child.type !== 'door' && child.type !== 'window') return false
      const metadata = useLiveNodeOverrides.getState().get(child.id)?.metadata as
        | Record<string, unknown>
        | undefined
      return metadata?.deferParentRebuild === true
    })
    if (deferShadow) deferredShadowWalls.add(wall.id)
    else deferredShadowWalls.delete(wall.id)
    return buildCurtainWallGeometry(wall as WallNode, envelope, children, livePreview)
  },
  syncAuxiliaryGeometry(wall, mesh, geometry) {
    if (wall.wallType !== 'curtain') return
    if (deferredShadowWalls.has(wall.id)) return
    const shadowMesh = mesh.getObjectByName(CURTAIN_WALL_SHADOW_NAME) as Mesh | undefined
    if (!shadowMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    shadowMesh.geometry.dispose()
    shadowMesh.geometry = buildCurtainWallShadowGeometry(geometry, isOpaque(materials[1]))
  },
}
