import { isCurvedWall, type WallNode } from '@pascal-app/core'
import type { WallGeometryAdapter } from '@pascal-app/viewer'
import type { Mesh } from 'three'
import { buildCurtainWallGeometry } from './curtain-wall-geometry'
import { buildCurtainWallShadowGeometry, CURTAIN_WALL_SHADOW_NAME } from './curtain-wall-shadow'

export const curtainWallGeometryAdapter: WallGeometryAdapter = {
  prepareChildren(wall, children, context) {
    if (wall.wallType !== 'curtain' || isCurvedWall(wall)) {
      return { envelopeChildren: [...children], renderChildren: [...children] }
    }
    const renderChildren = children.map((child) => {
      if ((child.type !== 'door' && child.type !== 'window') || child.openingShape === 'rectangle')
        return child
      return context.isLive(child.id) ? { ...child, openingShape: 'rectangle' as const } : child
    })
    return {
      envelopeChildren: renderChildren.filter(
        (child) => child.type !== 'door' && child.type !== 'window',
      ),
      renderChildren,
    }
  },
  buildGeometry(wall, envelope, children) {
    return wall.wallType === 'curtain'
      ? buildCurtainWallGeometry(wall as WallNode, envelope, children)
      : envelope
  },
  syncAuxiliaryGeometry(wall, mesh, geometry) {
    if (wall.wallType !== 'curtain') return
    const shadowMesh = mesh.getObjectByName(CURTAIN_WALL_SHADOW_NAME) as Mesh | undefined
    if (!shadowMesh) return
    shadowMesh.geometry.dispose()
    shadowMesh.geometry = buildCurtainWallShadowGeometry(
      geometry,
      wall.curtainWall?.glassOpacity === 1,
    )
  },
}
