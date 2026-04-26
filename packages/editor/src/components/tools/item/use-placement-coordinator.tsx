import type { AssetInput, ItemNode } from '@pascal-app/core'
import {
  type AnyNodeId,
  type CeilingEvent,
  emitter,
  type GridEvent,
  getScaledDimensions,
  type ItemEvent,
  resolveLevelId,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
  useSpatialQuery,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BoxGeometry,
  EdgesGeometry,
  Euler,
  type Group,
  type LineSegments,
  type Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { distance, smoothstep, uv, vec2 } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { snapToGrid } from './placement-math'
import {
  ceilingStrategy,
  checkCanPlace,
  floorStrategy,
  itemSurfaceStrategy,
  wallStrategy,
} from './placement-strategies'
import type { PlacementState, TransitionResult } from './placement-types'
import type { DraftNodeHandle } from './use-draft-node'

const DEFAULT_DIMENSIONS: [number, number, number] = [1, 1, 1]

// Shared materials for placement cursor - we just change colors, not swap materials
// Note: EdgesGeometry doesn't work with dashed lines, so using solid lines
const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44, // red-500 (invalid)
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const basePlaneMaterial = new MeshBasicNodeMaterial({
  color: 0xef_44_44, // red-500 (invalid)
  transparent: true,
  depthTest: false,
  depthWrite: false,
})

// Create radial opacity: transparent in center, opaque at edges
const center = vec2(0.5, 0.5)
const dist = distance(uv(), center)
const radialOpacity = smoothstep(0, 0.7, dist).mul(0.6)
basePlaneMaterial.opacityNode = radialOpacity

export interface PlacementCoordinatorConfig {
  asset: AssetInput | null
  disabled?: boolean
  isDisabled?: () => boolean
  draftNode: DraftNodeHandle
  /** Item ids to ignore during placement validation, such as the source item in move-preview mode. */
  ignoreItemIds?: string[]
  initDraft: (gridPosition: Vector3) => void
  onCommitRequested?: (request: {
    nodeUpdate: Partial<ItemNode>
    surface: PlacementState['surface']
  }) => boolean
  onCommitted: () => boolean
  onCancel?: () => void
  initialState?: PlacementState
  /** Scale to use when lazily creating a draft (e.g. for wall/ceiling duplicates). Defaults to [1,1,1]. */
  defaultScale?: [number, number, number]
  /** Keep the draft/controller alive when the placement tool unmounts after handoff. */
  preserveDraftOnUnmount?: boolean | (() => boolean)
  /** Restrict placement interactions to the floor surface only. */
  surfaceMode?: 'all' | 'floor-only'
}

export function usePlacementCoordinator(config: PlacementCoordinatorConfig): React.ReactNode {
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)
  const basePlaneRef = useRef<Mesh>(null!)
  const gridPosition = useRef(new Vector3(0, 0, 0))
  const floorHeightOffsetRef = useRef(0)
  const lastRawPos = useRef(new Vector3(0, 0, 0))
  const placementState = useRef<PlacementState>(
    config.initialState ?? { surface: 'floor', wallId: null, ceilingId: null, surfaceItemId: null },
  )
  const shiftFreeRef = useRef(false)
  const allowNonFloorSurfaces = config.surfaceMode !== 'floor-only'

  // Store config callbacks in refs to avoid re-running effect when they change
  const configRef = useRef(config)
  configRef.current = config

  const { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling } = useSpatialQuery()
  const { asset, draftNode } = config

  useEffect(() => {
    if (!asset) return
    useScene.temporal.getState().pause()

    const validators = { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling }

    // Reset placement state
    placementState.current = configRef.current.initialState ?? {
      surface: 'floor',
      wallId: null,
      ceilingId: null,
      surfaceItemId: null,
    }

    // ---- Helpers ----

    const syncFloorHeightOffset = () => {
      const draft = draftNode.current
      const levelId = useViewer.getState().selection.levelId
      if (!(draft && levelId) || draft.asset.attachTo) {
        floorHeightOffsetRef.current = 0
        return
      }

      // Floor item Y is stored as bottom-height above the slab, not world elevation.
      floorHeightOffsetRef.current = draft.position[1]
    }

    const getContext = () => ({
      asset,
      floorHeightOffset: floorHeightOffsetRef.current,
      ignoredItemIds: Array.from(
        new Set([
          ...(configRef.current.ignoreItemIds ?? []),
          ...(draftNode.current ? [draftNode.current.id] : []),
        ]),
      ),
      levelId: useViewer.getState().selection.levelId,
      draftItem: draftNode.current,
      gridPosition: gridPosition.current,
      state: { ...placementState.current },
    })
    const shouldCommit = (nodeUpdate: Partial<ItemNode>) =>
      configRef.current.onCommitRequested?.({
        nodeUpdate,
        surface: placementState.current.surface,
      }) ?? true
    const isDisabled = () => Boolean(configRef.current.disabled || configRef.current.isDisabled?.())

    const getActiveValidators = () =>
      shiftFreeRef.current
        ? {
            canPlaceOnFloor: () => ({ valid: true }),
            canPlaceOnWall: () => ({ valid: true }),
            canPlaceOnCeiling: () => ({ valid: true }),
          }
        : validators

    const revalidate = (): boolean => {
      const placeable = shiftFreeRef.current || checkCanPlace(getContext(), validators)
      const color = placeable ? 0x22_c5_5e : 0xef_44_44 // green-500 : red-500
      edgeMaterial.color.setHex(color)
      basePlaneMaterial.color.setHex(color)
      return placeable
    }

    // Tool visuals are rendered inside the building-local ToolManager group, so all cursor
    // positions must be in building-local space. Wall/ceiling/item-surface strategies return
    // world-space cursor positions (from their event.position); convert them here.
    const worldToBuildingLocal = (x: number, y: number, z: number): Vector3 => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      return buildingMesh ? buildingMesh.worldToLocal(new Vector3(x, y, z)) : new Vector3(x, y, z)
    }

    const applyTransition = (result: TransitionResult) => {
      Object.assign(placementState.current, result.stateUpdate)
      gridPosition.current.set(...result.gridPosition)

      const c = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(c.x, c.y, c.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        // Update ref for validation — no store update during drag
        Object.assign(draft, result.nodeUpdate)
      }
      revalidate()
    }

    const ensureDraft = (result: TransitionResult) => {
      gridPosition.current.set(...result.gridPosition)
      const c = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(c.x, c.y, c.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      draftNode.create(
        gridPosition.current,
        asset,
        [0, result.cursorRotationY, 0],
        configRef.current.defaultScale,
      )
      syncFloorHeightOffset()

      const draft = draftNode.current
      if (draft) {
        Object.assign(draft, result.nodeUpdate)
        // One-time setup: put node in the right parent so it renders correctly
        useScene.getState().updateNode(draft.id, result.nodeUpdate)
      }

      if (!revalidate()) {
        draftNode.destroy()
      }
    }

    // ---- Init draft ----
    configRef.current.initDraft(gridPosition.current)
    syncFloorHeightOffset()

    // Sync cursor to the draft mesh's world position and rotation
    if (draftNode.current) {
      const mesh = sceneRegistry.nodes.get(draftNode.current.id)
      if (mesh) {
        const worldPos = new Vector3()
        mesh.getWorldPosition(worldPos)
        const localPos = worldToBuildingLocal(worldPos.x, worldPos.y, worldPos.z)
        cursorGroupRef.current.position.copy(localPos)
        // Extract world Y rotation (handles wall-parented items correctly)
        const q = new Quaternion()
        mesh.getWorldQuaternion(q)
        cursorGroupRef.current.rotation.y = new Euler().setFromQuaternion(q, 'YXZ').y
      } else {
        cursorGroupRef.current.position.copy(gridPosition.current)
        cursorGroupRef.current.rotation.y = draftNode.current.rotation[1] ?? 0
      }
    }

    revalidate()

    // ---- Floor Handlers ----

    let previousGridPos: [number, number, number] | null = null

    const onGridMove = (event: GridEvent) => {
      if (isDisabled()) return
      // Lazy draft creation: if no draft yet (e.g. level wasn't ready during init), create now
      if (draftNode.current === null && asset && asset.attachTo === undefined) {
        configRef.current.initDraft(gridPosition.current)
      }

      lastRawPos.current.set(event.localPosition[0], event.localPosition[1], event.localPosition[2])
      const result = floorStrategy.move(getContext(), event)
      if (!result) return

      const snappedGridPositionUnchanged =
        gridPosition.current.x === result.gridPosition[0] &&
        gridPosition.current.y === result.gridPosition[1] &&
        gridPosition.current.z === result.gridPosition[2]
      const cursorXZUnchanged =
        cursorGroupRef.current.position.x === result.cursorPosition[0] &&
        cursorGroupRef.current.position.z === result.cursorPosition[2]

      if (snappedGridPositionUnchanged && cursorXZUnchanged) {
        return
      }

      // Play snap sound when grid position changes
      if (
        previousGridPos &&
        (result.gridPosition[0] !== previousGridPos[0] ||
          result.gridPosition[2] !== previousGridPos[2])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPos = [...result.gridPosition] as [number, number, number]
      gridPosition.current.set(...result.gridPosition)
      // Only update X and Z for cursor - useFrame will handle Y (slab elevation)
      cursorGroupRef.current.position.x = result.cursorPosition[0]
      cursorGroupRef.current.position.z = result.cursorPosition[2]

      const draft = draftNode.current
      if (draft) draft.position = result.gridPosition

      // Publish live transform for 2D floorplan
      if (draft) {
        useLiveTransforms.getState().set(draft.id, {
          position: result.gridPosition,
          rotation: cursorGroupRef.current.rotation.y,
        })
      }

      revalidate()
    }

    const onGridClick = (event: GridEvent) => {
      if (isDisabled()) return

      const result = floorStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      if (!shouldCommit(result.nodeUpdate)) {
        return
      }

      // Preserve cursor rotation for the next draft
      const currentRotation: [number, number, number] = [0, cursorGroupRef.current.rotation.y, 0]

      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }

      draftNode.commit(result.nodeUpdate)
      if (configRef.current.onCommitted()) {
        draftNode.create(gridPosition.current, asset, currentRotation)
        revalidate()
      }
    }

    // ---- Wall Handlers ----

    const onWallEnter = (event: WallEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const nodes = useScene.getState().nodes
      const result = wallStrategy.enter(
        getContext(),
        event,
        resolveLevelId,
        nodes,
        getActiveValidators(),
      )
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to new wall
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
        if (result.stateUpdate.wallId) {
          useScene.getState().dirtyNodes.add(result.stateUpdate.wallId as AnyNodeId)
        }
      }
    }

    const onWallMove = (event: WallEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const ctx = getContext()

      if (ctx.state.surface !== 'wall') {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(
          ctx,
          event,
          resolveLevelId,
          nodes,
          getActiveValidators(),
        )
        if (!enterResult) return

        event.stopPropagation()
        applyTransition(enterResult)
        if (draftNode.current && enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
          if (enterResult.stateUpdate.wallId) {
            useScene.getState().dirtyNodes.add(enterResult.stateUpdate.wallId as AnyNodeId)
          }
        }
        return
      }

      if (!draftNode.current) {
        const nodes = useScene.getState().nodes
        const setup = wallStrategy.enter(
          getContext(),
          event,
          resolveLevelId,
          nodes,
          getActiveValidators(),
        )
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      const result = wallStrategy.move(ctx, event, getActiveValidators())
      if (!result) return

      event.stopPropagation()

      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      // Play snap sound when grid position changes
      if (posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const wc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(wc.x, wc.y, wc.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft && result.nodeUpdate) {
        if ('side' in result.nodeUpdate) draft.side = result.nodeUpdate.side
        if ('rotation' in result.nodeUpdate)
          draft.rotation = result.nodeUpdate.rotation as [number, number, number]
      }

      const placeable = revalidate()

      if (draft && placeable) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) {
          mesh.position.copy(gridPosition.current)
          const rot = result.nodeUpdate?.rotation
          if (rot) mesh.rotation.y = rot[1]

          // Push wall-side items out by half the parent wall's thickness
          if (asset.attachTo === 'wall-side' && placementState.current.wallId) {
            const parentWall = useScene.getState().nodes[placementState.current.wallId as AnyNodeId]
            if (parentWall?.type === 'wall') {
              const wallThickness = (parentWall as WallNode).thickness ?? 0.1
              mesh.position.z = (wallThickness / 2) * (draft.side === 'front' ? 1 : -1)
            }
          }
        }
        // Mark parent wall dirty so it rebuilds geometry — only when position changed
        if (result.dirtyNodeId && posChanged) {
          useScene.getState().dirtyNodes.add(result.dirtyNodeId)
        }

        // Publish live transform for 2D floorplan
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }
    }

    const onWallClick = (event: WallEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const result = wallStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      if (!shouldCommit(result.nodeUpdate)) {
        return
      }

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)
      if (result.dirtyNodeId) {
        useScene.getState().dirtyNodes.add(result.dirtyNodeId)
      }

      if (configRef.current.onCommitted()) {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(
          getContext(),
          event,
          resolveLevelId,
          nodes,
          validators,
        )
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    const onWallLeave = (event: WallEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const result = wallStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (asset.attachTo) {
        if (draftNode.isAdopted) {
          // Move mode: keep draft alive, reparent to level
          const oldWallId = placementState.current.wallId
          applyTransition(result)
          const draft = draftNode.current
          if (draft) {
            useScene
              .getState()
              .updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
          }
          if (oldWallId) {
            useScene.getState().dirtyNodes.add(oldWallId as AnyNodeId)
          }
        } else {
          // Create mode: destroy transient and reset state
          draftNode.destroy()
          Object.assign(placementState.current, result.stateUpdate)
        }
      } else {
        applyTransition(result)
      }
    }

    // ---- Item Surface Handlers ----

    const onItemEnter = (event: ItemEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return
      if (event.node.id === draftNode.current?.id) return
      const result = itemSurfaceStrategy.enter(getContext(), event)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to surface item
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
      }
    }

    const onItemMove = (event: ItemEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return
      if (event.node.id === draftNode.current?.id) return
      const ctx = getContext()

      if (ctx.state.surface !== 'item-surface') {
        // Try entering surface mode
        const enterResult = itemSurfaceStrategy.enter(ctx, event)
        if (!enterResult) return

        event.stopPropagation()
        applyTransition(enterResult)
        if (draftNode.current && enterResult.nodeUpdate.parentId) {
          useScene.getState().updateNode(draftNode.current.id, enterResult.nodeUpdate)
        }
        return
      }

      if (!draftNode.current) {
        const enterResult = itemSurfaceStrategy.enter(getContext(), event)
        if (!enterResult) return
        event.stopPropagation()
        ensureDraft(enterResult)
        return
      }

      lastRawPos.current.set(event.position[0], event.position[1], event.position[2])
      const result = itemSurfaceStrategy.move(ctx, event)
      if (!result) return

      event.stopPropagation()

      gridPosition.current.set(...result.gridPosition)
      const ic = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(ic.x, ic.y, ic.z)
      cursorGroupRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.set(...result.gridPosition)

        // Publish live transform for 2D floorplan
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: result.cursorRotationY,
        })
      }

      revalidate()
    }

    const onItemLeave = (event: ItemEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return
      if (event.node.id === draftNode.current?.id) return
      if (placementState.current.surface !== 'item-surface') return

      event.stopPropagation()

      // Transition back to floor using building-local position
      const wx = Math.round(event.localPosition[0] * 2) / 2
      const wz = Math.round(event.localPosition[2] * 2) / 2
      const floorPos: [number, number, number] = [wx, 0, wz]

      Object.assign(placementState.current, { surface: 'floor', surfaceItemId: null })
      gridPosition.current.set(wx, 0, wz)
      cursorGroupRef.current.position.x = wx
      cursorGroupRef.current.position.z = wz

      const draft = draftNode.current
      if (draft) {
        draft.position = floorPos
        useScene.getState().updateNode(draft.id, {
          parentId: useViewer.getState().selection.levelId as string,
          position: floorPos,
        })
      }

      revalidate()
    }

    const onItemClick = (event: ItemEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return
      if (event.node.id === draftNode.current?.id) return
      const result = itemSurfaceStrategy.click(getContext(), event)
      if (!result) return

      if (!shouldCommit(result.nodeUpdate)) {
        return
      }

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)

      if (configRef.current.onCommitted()) {
        // Try to set up next draft on the same surface
        const enterResult = itemSurfaceStrategy.enter(getContext(), event)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    // ---- Ceiling Handlers ----

    const onCeilingEnter = (event: CeilingEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const nodes = useScene.getState().nodes
      const result = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
      if (!result) return

      event.stopPropagation()
      applyTransition(result)

      if (!draftNode.current) {
        ensureDraft(result)
      } else if (result.nodeUpdate.parentId) {
        // Existing draft (move mode): reparent to new ceiling
        useScene.getState().updateNode(draftNode.current.id, result.nodeUpdate)
        if (result.stateUpdate.ceilingId) {
          useScene.getState().dirtyNodes.add(result.stateUpdate.ceilingId as AnyNodeId)
        }
      }
    }

    const onCeilingMove = (event: CeilingEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      if (!draftNode.current && placementState.current.surface === 'ceiling') {
        const nodes = useScene.getState().nodes
        const setup = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      lastRawPos.current.set(event.position[0], event.position[1], event.position[2])
      const result = ceilingStrategy.move(getContext(), event)
      if (!result) return

      event.stopPropagation()

      // Play snap sound when grid position changes
      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      if (posChanged) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      gridPosition.current.set(...result.gridPosition)
      const cc = worldToBuildingLocal(...result.cursorPosition)
      cursorGroupRef.current.position.set(cc.x, cc.y, cc.z)

      revalidate()

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.copy(gridPosition.current)

        // Publish live transform for 2D floorplan
        useLiveTransforms.getState().set(draft.id, {
          position: result.cursorPosition,
          rotation: cursorGroupRef.current.rotation.y,
        })
      }
    }

    const onCeilingClick = (event: CeilingEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const result = ceilingStrategy.click(getContext(), event, getActiveValidators())
      if (!result) return

      if (!shouldCommit(result.nodeUpdate)) {
        return
      }

      event.stopPropagation()
      // Clear live transform before commit
      if (draftNode.current) {
        useLiveTransforms.getState().clear(draftNode.current.id)
      }
      draftNode.commit(result.nodeUpdate)

      if (configRef.current.onCommitted()) {
        const nodes = useScene.getState().nodes
        const enterResult = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    const onCeilingLeave = (event: CeilingEvent) => {
      if (isDisabled()) return
      if (!allowNonFloorSurfaces) return

      const result = ceilingStrategy.leave(getContext())
      if (!result) return

      event.stopPropagation()

      if (asset.attachTo) {
        if (draftNode.isAdopted) {
          // Move mode: keep draft alive, reparent to level
          const oldCeilingId = placementState.current.ceilingId
          applyTransition(result)
          const draft = draftNode.current
          if (draft) {
            useScene
              .getState()
              .updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
          }
          if (oldCeilingId) {
            useScene.getState().dirtyNodes.add(oldCeilingId as AnyNodeId)
          }
        } else {
          // Create mode: destroy transient and reset state
          draftNode.destroy()
          Object.assign(placementState.current, result.stateUpdate)
        }
      } else {
        applyTransition(result)
      }
    }

    // ---- Keyboard rotation ----

    const ROTATION_STEP = Math.PI / 2
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftFreeRef.current = true
        revalidate()
        return
      }

      // Don't intercept keys when focus is inside a text input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (isDisabled()) return

      const draft = draftNode.current
      if (!draft) return

      let rotationDelta = 0
      if ((event.key === 'r' || event.key === 'R') && !event.metaKey && !event.ctrlKey)
        rotationDelta = ROTATION_STEP
      else if ((event.key === 't' || event.key === 'T') && !event.metaKey && !event.ctrlKey)
        rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')
        const currentRotation = draft.rotation
        const newRotationY = (currentRotation[1] ?? 0) + rotationDelta
        draft.rotation = [currentRotation[0], newRotationY, currentRotation[2]]

        // Ref + cursor mesh + item mesh — no store update during drag
        cursorGroupRef.current.rotation.y = newRotationY
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.rotation.y = newRotationY

        // Re-snap position immediately with updated rotation (dimX/dimZ may swap at 90°)
        const surface = placementState.current.surface
        if (surface === 'floor' || surface === 'ceiling') {
          const dims = getScaledDimensions(draft)
          const [dimX, , dimZ] = dims
          const swapDims = Math.abs(Math.sin(newRotationY)) > 0.9
          const x = snapToGrid(lastRawPos.current.x, swapDims ? dimZ : dimX)
          const z = snapToGrid(lastRawPos.current.z, swapDims ? dimX : dimZ)
          gridPosition.current.set(x, gridPosition.current.y, z)
          draft.position = [x, gridPosition.current.y, z]
          cursorGroupRef.current.position.x = x
          cursorGroupRef.current.position.z = z
          if (mesh) {
            mesh.position.x = x
            mesh.position.z = z
          }
        } else if (surface === 'item-surface' && placementState.current.surfaceItemId) {
          const surfaceMesh = sceneRegistry.nodes.get(placementState.current.surfaceItemId)
          if (surfaceMesh) {
            const localPos = surfaceMesh.worldToLocal(lastRawPos.current.clone())
            const dims = getScaledDimensions(draft)
            const [dimX, , dimZ] = dims
            const swapDims = Math.abs(Math.sin(newRotationY)) > 0.9
            const x = snapToGrid(localPos.x, swapDims ? dimZ : dimX)
            const z = snapToGrid(localPos.z, swapDims ? dimX : dimZ)
            const y = gridPosition.current.y
            gridPosition.current.set(x, y, z)
            draft.position = [x, y, z]
            const worldSnapped = surfaceMesh.localToWorld(new Vector3(x, y, z))
            const localSnapped = worldToBuildingLocal(
              worldSnapped.x,
              worldSnapped.y,
              worldSnapped.z,
            )
            cursorGroupRef.current.position.set(localSnapped.x, localSnapped.y, localSnapped.z)
            if (mesh) mesh.position.set(x, y, z)
          }
        }

        // Update live transform for 2D floorplan with post-snap position
        const currentLive = useLiveTransforms.getState().get(draft.id)
        if (currentLive) {
          useLiveTransforms.getState().set(draft.id, {
            ...currentLive,
            position: [
              cursorGroupRef.current.position.x,
              cursorGroupRef.current.position.y,
              cursorGroupRef.current.position.z,
            ] as [number, number, number],
            rotation: newRotationY,
          })
        }

        revalidate()
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (isDisabled()) return

      if (event.key === 'Shift') {
        shiftFreeRef.current = false
        revalidate()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    // ---- tool:cancel (Escape / programmatic) ----
    const onCancel = () => {
      if (configRef.current.onCancel) {
        configRef.current.onCancel()
      }
    }
    emitter.on('tool:cancel', onCancel)

    // ---- Bounding box geometry ----

    const draft = draftNode.current
    const dims = draft ? getScaledDimensions(draft) : (asset.dimensions ?? DEFAULT_DIMENSIONS)
    const boxGeometry = new BoxGeometry(dims[0], dims[1], dims[2])
    const wallSideZOffset = asset.attachTo === 'wall-side' ? -dims[2] / 2 : 0
    boxGeometry.translate(0, dims[1] / 2, wallSideZOffset)
    const edgesGeometry = new EdgesGeometry(boxGeometry)
    edgesRef.current.geometry = edgesGeometry

    // ---- Undo protection ----
    // Undo replaces the entire `nodes` object with a previous snapshot, which doesn't
    // include the draft (created while temporal was paused). Re-insert it so the mesh
    // doesn't disappear mid-placement.
    // We defer via queueMicrotask to avoid nested setState during the undo callback.
    // Temporal is already paused during placement, so createNode won't enter the undo stack.
    let tearingDown = false
    const unsubDraftWatch = useScene.subscribe((state) => {
      if (tearingDown) return
      const draft = draftNode.current
      if (draft === null) return
      if (draftNode.mode === 'clone') return
      if (draft.id in state.nodes) return

      queueMicrotask(() => {
        if (tearingDown) return
        const draft = draftNode.current
        if (draft === null) return
        if (draftNode.mode === 'clone') return
        if (draft.id in useScene.getState().nodes) return
        // Temporal is paused during placement, createNode won't be tracked
        useScene.getState().createNode(draft, draft.parentId as AnyNodeId)
      })
    })

    // ---- Subscribe ----

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('item:enter', onItemEnter)
    emitter.on('item:move', onItemMove)
    emitter.on('item:leave', onItemLeave)
    emitter.on('item:click', onItemClick)
    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('ceiling:enter', onCeilingEnter)
    emitter.on('ceiling:move', onCeilingMove)
    emitter.on('ceiling:click', onCeilingClick)
    emitter.on('ceiling:leave', onCeilingLeave)

    return () => {
      tearingDown = true
      unsubDraftWatch()
      const preserveDraftOnUnmount =
        typeof configRef.current.preserveDraftOnUnmount === 'function'
          ? configRef.current.preserveDraftOnUnmount()
          : configRef.current.preserveDraftOnUnmount === true
      if (!preserveDraftOnUnmount) {
        // Clear live transform for any remaining draft
        if (draftNode.current) {
          useLiveTransforms.getState().clear(draftNode.current.id)
        }
        draftNode.destroy()
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('item:enter', onItemEnter)
      emitter.off('item:move', onItemMove)
      emitter.off('item:leave', onItemLeave)
      emitter.off('item:click', onItemClick)
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('ceiling:enter', onCeilingEnter)
      emitter.off('ceiling:move', onCeilingMove)
      emitter.off('ceiling:click', onCeilingClick)
      emitter.off('ceiling:leave', onCeilingLeave)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [allowNonFloorSurfaces, asset, canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling, draftNode])

  // Reparent floor draft to the new level when the user switches levels mid-placement.
  // Wall/ceiling items are managed by their own surface entry events (ensureDraft / reparent).
  const viewerLevelId = useViewer((s) => s.selection.levelId)
  useEffect(() => {
    if (!asset) return
    const draft = draftNode.current
    if (!(draft && viewerLevelId) || asset.attachTo) return
    if (draft.parentId === viewerLevelId) return
    draft.parentId = viewerLevelId
    useScene.getState().updateNode(draft.id as AnyNodeId, { parentId: viewerLevelId })
  }, [viewerLevelId, draftNode, asset])

  useFrame((_, delta) => {
    if (!asset) return
    if (!draftNode.current) return
    const mesh = sceneRegistry.nodes.get(draftNode.current.id)
    if (!mesh) return

    // Hide wall/ceiling-attached items when between surfaces (only cursor visible)
    if (asset.attachTo && placementState.current.surface === 'floor') {
      mesh.visible = false
      return
    }
    mesh.visible = true

    if (placementState.current.surface === 'floor') {
      const distance = mesh.position.distanceToSquared(gridPosition.current)
      if (distance > 1) {
        mesh.position.copy(gridPosition.current)
      } else {
        mesh.position.lerp(gridPosition.current, delta * 20)
      }

      // Adjust Y for slab elevation (floor items on top of slabs)
      if (!asset.attachTo) {
        const nodes = useScene.getState().nodes
        const levelId = resolveLevelId(draftNode.current, nodes)
        const slabElevation = spatialGridManager.getSlabElevationForItem(
          levelId,
          [gridPosition.current.x, gridPosition.current.y, gridPosition.current.z],
          getScaledDimensions(draftNode.current),
          draftNode.current.rotation,
        )
        mesh.position.y = slabElevation + floorHeightOffsetRef.current
        // Cursor group is at the world root (not inside a level group), so add the
        // level group's current world Y to convert from level-local to world space.
        const levelGroup = sceneRegistry.nodes.get(levelId as AnyNodeId)
        cursorGroupRef.current.position.y =
          slabElevation + floorHeightOffsetRef.current + (levelGroup?.position.y ?? 0)
      }
    }
  })

  const initialDraft = draftNode.current
  const dims = initialDraft
    ? getScaledDimensions(initialDraft)
    : (config.asset?.dimensions ?? DEFAULT_DIMENSIONS)
  const initialBoxGeometry = new BoxGeometry(dims[0], dims[1], dims[2])
  const wallSideZOffset = config.asset?.attachTo === 'wall-side' ? -dims[2] / 2 : 0
  initialBoxGeometry.translate(0, dims[1] / 2, wallSideZOffset)

  // Base plane geometry (colored rectangle on the ground)
  const basePlaneGeometry = new PlaneGeometry(dims[0], dims[2])
  basePlaneGeometry.rotateX(-Math.PI / 2) // Make it horizontal
  basePlaneGeometry.translate(0, 0.01, wallSideZOffset) // Slightly above ground to avoid z-fighting

  return (
    <group ref={cursorGroupRef}>
      <lineSegments layers={EDITOR_LAYER} material={edgeMaterial} ref={edgesRef} renderOrder={999}>
        <edgesGeometry args={[initialBoxGeometry]} />
      </lineSegments>
      <mesh
        geometry={basePlaneGeometry}
        layers={EDITOR_LAYER}
        material={basePlaneMaterial}
        ref={basePlaneRef}
        renderOrder={999}
      />
    </group>
  )
}
