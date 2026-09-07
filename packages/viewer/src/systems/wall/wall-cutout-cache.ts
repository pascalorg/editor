import {
  type AnyNodeId,
  getLibraryMaterialsVersion,
  getWallFaceBandConfig,
  getWallPlaneTop,
  resolveLevelId,
  resolveWallEffectiveHeight,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type Camera, type Material, Matrix4, type Mesh, Vector3 } from 'three'
import useViewer, { type WallMode } from '../../store/use-viewer'
import { resolveWallMaterialVariant, type WallMaterialVariant } from './wall-material-variant'
import {
  getHoverHighlightMaterials,
  getMaterialsForWall,
  getSelectionHighlightMaterials,
  type WallMaterials,
} from './wall-materials'

export function sameMaterialArray(a: Material | Material[], b: Material[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((material, i) => material === b[i])
}

/** Materialize a resolved variant from the wall's cached material set. */
function materialsForVariant(variant: WallMaterialVariant, materials: WallMaterials) {
  switch (variant) {
    case 'visible':
      return materials.visible
    case 'invisible':
      return materials.invisible
    case 'translucent':
      return materials.translucent
    case 'delete-visible':
      return materials.deleteVisible
    case 'delete-invisible':
      return materials.deleteInvisible
    case 'delete-translucent':
      return materials.deleteTranslucent
    case 'selection-visible':
      return getSelectionHighlightMaterials(materials.visible)
    case 'selection-invisible':
      return getSelectionHighlightMaterials(materials.invisible)
    case 'selection-translucent':
      return getSelectionHighlightMaterials(materials.translucent)
    case 'hover-invisible':
      return getHoverHighlightMaterials(materials.invisible)
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

type Variant = { key: WallMaterialVariant; materials: Material[] }
type CachedWall = {
  mesh: Mesh
  node: WallNode
  normal: Vector3
  matrix: Matrix4
  geometry: Mesh['geometry']
  negativeFacing: boolean | undefined
  hidden: boolean | undefined
  variantKey: WallMaterialVariant | undefined
  visibleVariant: Variant
  hiddenVariant: Variant
}

// About 0.06 degrees: retain the previous side at edge-on poses without
// introducing a perceptible delay when an orbit crosses a wall's plane.
export const WALL_FACING_HYSTERESIS = 0.001

export function wallHiddenFromFacing(
  node: Pick<WallNode, 'frontSide' | 'backSide'>,
  mode: WallMode,
  negativeFacing: boolean,
): boolean {
  if (mode === 'up') return false
  if (mode === 'down') return true
  if (node.frontSide === 'interior' && node.backSide === 'interior') return true
  return negativeFacing
    ? node.frontSide === 'exterior' && node.backSide !== 'exterior'
    : node.backSide === 'exterior' && node.frontSide !== 'exterior'
}

export function wallFacingNegative(dot: number, previous: boolean | undefined): boolean {
  if (previous === undefined) return dot < 0
  return previous ? dot < WALL_FACING_HYSTERESIS : dot < -WALL_FACING_HYSTERESIS
}

export class WallCutoutCache {
  readonly walls = new Map<string, CachedWall>()
  readonly rebuilt = new Set<string>()
  private viewer: ReturnType<typeof useViewer.getState> | undefined
  private nodes: ReturnType<typeof useScene.getState>['nodes'] | undefined
  private materials: ReturnType<typeof useScene.getState>['materials'] | undefined
  private registryRevision = -1
  private wallCount = -1
  private libraryVersion = -1
  private lastCameraPosition = new Vector3()
  private lastCameraTarget = new Vector3()
  private cameraDirection = new Vector3()
  private cameraTarget = new Vector3()
  private lastUpdateTime = 0
  private highlightMaps: Array<{ material: Material & { map?: unknown }; map: unknown }> = []

  update(camera: Camera, time: number): void {
    const viewer = useViewer.getState()
    const scene = useScene.getState()
    const wallIds = sceneRegistry.byType.wall!
    const libraryVersion = getLibraryMaterialsVersion()
    const previous = this.viewer
    const nodesChanged = this.nodes !== scene.nodes
    const registryChanged =
      this.registryRevision !== sceneRegistry.revision || this.wallCount !== wallIds.size
    const refresh =
      !previous ||
      nodesChanged ||
      registryChanged ||
      this.materials !== scene.materials ||
      this.libraryVersion !== libraryVersion ||
      this.highlightMaps.some(({ material, map }) => material.map !== map) ||
      previous.wallMode !== viewer.wallMode ||
      previous.shading !== viewer.shading ||
      previous.textures !== viewer.textures ||
      previous.colorPreset !== viewer.colorPreset ||
      previous.sceneTheme !== viewer.sceneTheme ||
      previous.selection.selectedIds !== viewer.selection.selectedIds ||
      previous.previewSelectedIds !== viewer.previewSelectedIds ||
      previous.hoveredId !== viewer.hoveredId ||
      previous.hoverHighlightMode !== viewer.hoverHighlightMode

    // Only cutaway's output depends on facing. Low always hides, translucent
    // always draws the translucent variant and keeps pointer events enabled.
    if (!refresh && this.rebuilt.size === 0 && viewer.wallMode !== 'cutaway') return

    camera.getWorldDirection(this.cameraDirection)
    this.cameraTarget.copy(this.cameraDirection).add(camera.position)
    const cameraChanged =
      viewer.wallMode === 'cutaway' &&
      time - this.lastUpdateTime > 0.1 &&
      (camera.position.distanceTo(this.lastCameraPosition) > 0.5 ||
        this.cameraTarget.distanceTo(this.lastCameraTarget) > 0.3)
    if (!refresh && this.rebuilt.size === 0 && !cameraChanged) return

    if (registryChanged || nodesChanged) {
      for (const [id, wall] of this.walls) {
        if (
          !wallIds.has(id) ||
          sceneRegistry.nodes.get(id) !== wall.mesh ||
          scene.nodes[id as AnyNodeId]?.type !== 'wall'
        ) {
          this.walls.delete(id)
        }
      }
    }

    if (refresh) {
      this.highlightMaps = []
      const selected = new Set([...viewer.selection.selectedIds, ...viewer.previewSelectedIds])
      for (const id of wallIds) {
        const mesh = sceneRegistry.nodes.get(id) as Mesh | undefined
        const node = scene.nodes[id as AnyNodeId]
        if (!mesh || node?.type !== 'wall') continue
        let wall = this.walls.get(id)
        if (!wall) {
          wall = {
            mesh,
            node,
            normal: new Vector3(),
            matrix: new Matrix4().makeScale(0, 0, 0),
            geometry: mesh.geometry,
            negativeFacing: undefined,
            hidden: undefined,
            variantKey: undefined,
            visibleVariant: { key: 'visible', materials: [] },
            hiddenVariant: { key: 'invisible', materials: [] },
          }
          this.walls.set(id, wall)
          this.refreshNormal(wall)
        } else if (nodesChanged || this.rebuilt.has(id)) {
          this.refreshNormal(wall)
        }
        wall.node = node
        const deleted = viewer.hoverHighlightMode === 'delete' && viewer.hoveredId === id
        let selectionHighlighted = !deleted && selected.has(id)
        if (selectionHighlighted) {
          const levelId = resolveLevelId(node, scene.nodes)
          const support = spatialGridManager.getSlabSupportForWall(
            levelId,
            node.start,
            node.end,
            node.curveOffset ?? 0,
            node.thickness,
            node.supportSlabId,
          )
          const height = resolveWallEffectiveHeight(
            node,
            getWallPlaneTop(node, levelId, scene.nodes),
            support.elevation,
          )
          selectionHighlighted = !getWallFaceBandConfig(node, height).enabled
        }
        const materials = getMaterialsForWall(
          node,
          viewer.shading,
          viewer.textures,
          viewer.colorPreset,
          viewer.sceneTheme,
          scene.materials,
        )
        // Selection clones need to pick up textures that arrive after mount.
        // Check only these few source materials, never every wall's material set.
        if (selectionHighlighted) {
          for (const material of materials.visible) {
            this.highlightMaps.push({
              material,
              map: (material as Material & { map?: unknown }).map,
            })
          }
        }
        const variant = (hidden: boolean): Variant => {
          const key = resolveWallMaterialVariant({
            translucentMode: viewer.wallMode === 'translucent',
            hidden,
            deleteHighlighted: deleted,
            selectionHighlighted,
            hoverHighlighted: viewer.hoverHighlightMode === 'default' && viewer.hoveredId === id,
          })
          return { key, materials: materialsForVariant(key, materials) }
        }
        wall.visibleVariant = variant(false)
        wall.hiddenVariant = variant(true)
        this.apply(wall, viewer.wallMode, true)
      }
    } else {
      for (const id of this.rebuilt) {
        const wall = this.walls.get(id)
        if (!wall) continue
        this.refreshNormal(wall)
        this.apply(wall, viewer.wallMode, true)
      }
      if (cameraChanged) {
        for (const [id, wall] of this.walls) {
          if (!this.rebuilt.has(id)) this.apply(wall, viewer.wallMode, false)
        }
      }
    }
    this.rebuilt.clear()
    this.viewer = viewer
    this.nodes = scene.nodes
    this.materials = scene.materials
    this.registryRevision = sceneRegistry.revision
    this.wallCount = wallIds.size
    this.libraryVersion = libraryVersion
    if (refresh || cameraChanged) {
      this.lastCameraPosition.copy(camera.position)
      this.lastCameraTarget.copy(this.cameraTarget)
      this.lastUpdateTime = time
    }
  }

  private refreshNormal(wall: CachedWall): void {
    wall.mesh.updateWorldMatrix(true, false)
    if (wall.matrix.equals(wall.mesh.matrixWorld) && wall.geometry === wall.mesh.geometry) return
    wall.matrix.copy(wall.mesh.matrixWorld)
    wall.geometry = wall.mesh.geometry
    wall.normal.setFromMatrixColumn(wall.matrix, 2).normalize()
  }

  private apply(wall: CachedWall, mode: WallMode, refresh: boolean): void {
    if (mode === 'cutaway') {
      wall.negativeFacing = wallFacingNegative(
        wall.normal.dot(this.cameraDirection),
        wall.negativeFacing,
      )
    }
    const hidden = wallHiddenFromFacing(wall.node, mode, wall.negativeFacing ?? false)
    if (!refresh && hidden === wall.hidden) return
    wall.hidden = hidden
    // The wall batch and pointer handlers consume this boolean, including
    // false on stamp lift; translucent walls must continue receiving events.
    const stamp = mode !== 'translucent' && hidden
    if (wall.mesh.userData.wallHidden !== stamp) wall.mesh.userData.wallHidden = stamp
    const variant = hidden ? wall.hiddenVariant : wall.visibleVariant
    if (wall.variantKey !== variant.key || refresh) {
      if (
        wall.mesh.material !== variant.materials &&
        !sameMaterialArray(wall.mesh.material, variant.materials)
      ) {
        wall.mesh.material = variant.materials
      }
      wall.variantKey = variant.key
    }
  }
}
