// New kind-specific modules belong in nodes; viewer must not depend on nodes.
// This extends the existing viewer-owned wall cutout and material implementation.
import {
  type AnyNodeId,
  getLibraryMaterialsVersion,
  getWallFaceBandConfig,
  getWallPlaneTop,
  resolveLevelId,
  resolveWallEffectiveHeight,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type Camera, type Material, Matrix4, type Mesh, type Object3D, Vector3 } from 'three'
import { getMaterialTextureVersion } from '../../lib/materials'
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
  assignedMaterials: Material | Material[] | undefined
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

export type WallCutoutViewerState = Pick<
  ReturnType<typeof useViewer.getState>,
  | 'wallMode'
  | 'shading'
  | 'textures'
  | 'colorPreset'
  | 'sceneTheme'
  | 'selection'
  | 'previewSelectedIds'
  | 'hoveredId'
  | 'hoverHighlightMode'
>

export type WallCutoutViewerStore = { getState: () => WallCutoutViewerState }

export class WallCutoutCache {
  readonly walls = new Map<string, CachedWall>()
  readonly rebuilt = new Set<string>()
  private viewer: WallCutoutViewerState | undefined
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
  private textureVersion = -1
  private selected = new Set<string>()
  private highlightKey = ''
  private transformed = new Set<string>()

  constructor(private readonly viewerStore: WallCutoutViewerStore = useViewer) {}

  subscribeLiveTransforms(): () => void {
    return useLiveTransforms.subscribe((state, previous) => {
      for (const [id, transform] of state.transforms) {
        if (transform !== previous.transforms.get(id)) this.transformed.add(id)
      }
      for (const id of previous.transforms.keys()) {
        if (!state.transforms.has(id)) this.transformed.add(id)
      }
    })
  }

  update(camera: Camera, time: number): void {
    const viewer = this.viewerStore.getState()
    const scene = useScene.getState()
    const wallIds = sceneRegistry.byType.wall!
    const libraryVersion = getLibraryMaterialsVersion()
    const textureVersion = getMaterialTextureVersion()
    const previous = this.viewer
    const nodesChanged = this.nodes !== scene.nodes
    const registryChanged =
      this.registryRevision !== sceneRegistry.revision || this.wallCount !== wallIds.size
    let highlightChanged = false
    if (
      !previous ||
      nodesChanged ||
      previous.selection.selectedIds !== viewer.selection.selectedIds ||
      previous.previewSelectedIds !== viewer.previewSelectedIds ||
      previous.hoveredId !== viewer.hoveredId ||
      previous.hoverHighlightMode !== viewer.hoverHighlightMode
    ) {
      this.selected = new Set(
        [...viewer.selection.selectedIds, ...viewer.previewSelectedIds].filter(
          (id) => scene.nodes[id as AnyNodeId]?.type === 'wall',
        ),
      )
      const hovered =
        scene.nodes[viewer.hoveredId as AnyNodeId]?.type === 'wall' ? viewer.hoveredId : null
      const key = `${Array.from(this.selected).sort().join('|')}::${viewer.hoverHighlightMode === 'delete' ? (hovered ?? '') : ''}::${viewer.hoverHighlightMode === 'default' ? (hovered ?? '') : ''}`
      highlightChanged = key !== this.highlightKey
      this.highlightKey = key
    }
    const appearanceChanged =
      !previous ||
      highlightChanged ||
      this.materials !== scene.materials ||
      this.libraryVersion !== libraryVersion ||
      (this.textureVersion !== textureVersion && this.selected.size > 0) ||
      previous.wallMode !== viewer.wallMode ||
      previous.shading !== viewer.shading ||
      previous.textures !== viewer.textures ||
      previous.colorPreset !== viewer.colorPreset ||
      previous.sceneTheme !== viewer.sceneTheme
    const previewId = (state: typeof viewer | undefined) =>
      state && state.hoverHighlightMode !== 'default' && state.hoverHighlightMode !== 'delete'
        ? state.hoveredId
        : null
    const releasedPreview = previewId(previous) !== previewId(viewer) ? previewId(previous) : null
    this.viewer = viewer
    const invalidated =
      appearanceChanged ||
      nodesChanged ||
      registryChanged ||
      this.rebuilt.size > 0 ||
      this.transformed.size > 0 ||
      releasedPreview !== null

    if (!invalidated && viewer.wallMode !== 'cutaway') return

    camera.getWorldDirection(this.cameraDirection)
    this.cameraTarget.copy(this.cameraDirection).add(camera.position)
    const cameraChanged =
      viewer.wallMode === 'cutaway' &&
      time - this.lastUpdateTime > 0.1 &&
      (camera.position.distanceTo(this.lastCameraPosition) > 0.5 ||
        this.cameraTarget.distanceTo(this.lastCameraTarget) > 0.3)
    if (!invalidated && !cameraChanged) return

    if (registryChanged || nodesChanged) {
      for (const [id, wall] of this.walls) {
        if (
          !wallIds.has(id) ||
          sceneRegistry.nodes.get(id) !== wall.mesh ||
          scene.nodes[id as AnyNodeId]?.type !== 'wall'
        )
          this.walls.delete(id)
      }
    }

    if (invalidated) {
      const changedPaths = new Map<string, boolean>()
      const pathChanged = (id: string): boolean => {
        const cached = changedPaths.get(id)
        if (cached !== undefined) return cached
        const node = scene.nodes[id as AnyNodeId]
        const changed =
          this.transformed.has(id) ||
          (nodesChanged && this.nodes?.[id as AnyNodeId] !== node) ||
          !!(node?.parentId && pathChanged(node.parentId))
        changedPaths.set(id, changed)
        return changed
      }
      const visited = new Set<Object3D>()
      for (const id of wallIds) {
        const node = scene.nodes[id as AnyNodeId]
        if (node?.type !== 'wall') continue
        let wall = this.walls.get(id)
        const added = !wall
        if (!wall) {
          const mesh = sceneRegistry.nodes.get(id) as Mesh | undefined
          if (!mesh) continue
          wall = {
            mesh,
            node,
            normal: new Vector3(),
            matrix: new Matrix4().makeScale(0, 0, 0),
            geometry: mesh.geometry,
            negativeFacing: undefined,
            hidden: undefined,
            variantKey: undefined,
            assignedMaterials: undefined,
            visibleVariant: { key: 'visible', materials: [] },
            hiddenVariant: { key: 'invisible', materials: [] },
          }
          this.walls.set(id, wall)
        }
        const changed = pathChanged(id)
        const rebuilt = this.rebuilt.has(id)
        if (added || changed || rebuilt) this.refreshNormal(wall, visited)
        wall.node = node
        if (added || appearanceChanged || (nodesChanged && changed)) this.refreshAppearance(wall)
        if (
          added ||
          appearanceChanged ||
          changed ||
          rebuilt ||
          releasedPreview === id ||
          cameraChanged
        ) {
          this.apply(wall, viewer.wallMode, added || appearanceChanged || (nodesChanged && changed))
        }
      }
    } else {
      for (const wall of this.walls.values()) this.apply(wall, viewer.wallMode, false)
    }
    this.rebuilt.clear()
    this.transformed.clear()
    this.nodes = scene.nodes
    this.materials = scene.materials
    this.registryRevision = sceneRegistry.revision
    this.wallCount = wallIds.size
    this.libraryVersion = libraryVersion
    this.textureVersion = getMaterialTextureVersion()
    if (appearanceChanged || cameraChanged) {
      this.lastCameraPosition.copy(camera.position)
      this.lastCameraTarget.copy(this.cameraTarget)
      this.lastUpdateTime = time
    }
  }

  private refreshAppearance(wall: CachedWall): void {
    const viewer = this.viewer!
    const scene = useScene.getState()
    const node = wall.node
    const deleted = viewer.hoverHighlightMode === 'delete' && viewer.hoveredId === node.id
    let selectionHighlighted = !deleted && this.selected.has(node.id)
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
    const variant = (hidden: boolean): Variant => {
      const key = resolveWallMaterialVariant({
        translucentMode: viewer.wallMode === 'translucent',
        hidden,
        deleteHighlighted: deleted,
        selectionHighlighted,
        hoverHighlighted: viewer.hoverHighlightMode === 'default' && viewer.hoveredId === node.id,
      })
      return { key, materials: materialsForVariant(key, materials) }
    }
    wall.visibleVariant = variant(false)
    wall.hiddenVariant = variant(true)
  }

  private refreshNormal(wall: CachedWall, visited: Set<Object3D>): void {
    const update = (object: Object3D): void => {
      if (visited.has(object)) return
      if (object.parent) update(object.parent)
      object.updateWorldMatrix(false, false)
      visited.add(object)
    }
    update(wall.mesh)
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
    wall.hidden = hidden
    // The wall batch and pointer handlers consume this boolean, including
    // false on stamp lift; translucent walls must continue receiving events.
    const stamp = mode !== 'translucent' && hidden
    if (wall.mesh.userData.wallHidden !== stamp) wall.mesh.userData.wallHidden = stamp
    const variant = hidden ? wall.hiddenVariant : wall.visibleVariant
    // Non-highlight hover owns a temporary material until its restore callback runs.
    const viewer = this.viewer!
    if (
      viewer.hoveredId === wall.node.id &&
      viewer.hoverHighlightMode !== 'default' &&
      viewer.hoverHighlightMode !== 'delete'
    ) {
      if (refresh) wall.variantKey = undefined
      return
    }
    if (wall.variantKey !== variant.key || refresh) {
      if (
        wall.mesh.material !== variant.materials &&
        !sameMaterialArray(wall.mesh.material, variant.materials)
      ) {
        wall.mesh.material = variant.materials
      }
      wall.variantKey = variant.key
      wall.assignedMaterials = wall.mesh.material
    } else if (wall.mesh.material !== wall.assignedMaterials) {
      wall.mesh.material = wall.assignedMaterials!
    }
  }
}
