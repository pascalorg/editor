import {
  type AnyNodeId,
  type CeilingEvent,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
  useSpatialQuery,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BoxGeometry, Euler, type Mesh, type MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { spatialGridManager } from '../../../../../packages/core/src/hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../../../../packages/core/src/hooks/spatial-grid/spatial-grid-sync'
import {
  ceilingStrategy,
  checkCanPlace,
  floorStrategy,
  wallStrategy,
} from './placement-strategies'
import type { PlacementState, TransitionResult } from './placement-types'
import type { DraftNodeHandle } from './use-draft-node'
import type { AssetInput } from '@pascal-app/core'

const DEFAULT_DIMENSIONS: [number, number, number] = [1, 1, 1]

export interface PlacementCoordinatorConfig {
  asset: AssetInput
  draftNode: DraftNodeHandle
  initDraft: (gridPosition: Vector3) => void
  onCommitted: () => boolean
  onCancel?: () => void
  initialState?: PlacementState
}

export function usePlacementCoordinator(config: PlacementCoordinatorConfig): React.ReactNode {
  const cursorRef = useRef<Mesh>(null!)
  const gridPosition = useRef(new Vector3(0, 0, 0))
  const placementState = useRef<PlacementState>(
    config.initialState ?? { surface: 'floor', wallId: null, ceilingId: null },
  )

  const { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling } = useSpatialQuery()
  const { asset, draftNode } = config

  useEffect(() => {
    useScene.temporal.getState().pause()

    const validators = { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling }

    // Reset placement state
    placementState.current = config.initialState ?? {
      surface: 'floor',
      wallId: null,
      ceilingId: null,
    }

    // ---- Helpers ----

    const getContext = () => ({
      asset,
      levelId: useViewer.getState().selection.levelId,
      draftItem: draftNode.current,
      gridPosition: gridPosition.current,
      state: { ...placementState.current },
    })

    const revalidate = (): boolean => {
      const placeable = checkCanPlace(getContext(), validators)
      ;(cursorRef.current.material as MeshStandardMaterial).color.set(
        placeable ? 'green' : 'red',
      )
      return placeable
    }

    const applyTransition = (result: TransitionResult) => {
      Object.assign(placementState.current, result.stateUpdate)
      gridPosition.current.set(...result.gridPosition)
      cursorRef.current.position.set(...result.cursorPosition)
      cursorRef.current.rotation.y = result.cursorRotationY

      const draft = draftNode.current
      if (draft) {
        // Update ref for validation — no store update during drag
        Object.assign(draft, result.nodeUpdate)
      }
      revalidate()
    }

    const ensureDraft = (result: TransitionResult) => {
      gridPosition.current.set(...result.gridPosition)
      cursorRef.current.position.set(...result.cursorPosition)
      cursorRef.current.rotation.y = result.cursorRotationY

      draftNode.create(gridPosition.current, asset, [0, result.cursorRotationY, 0])

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
    config.initDraft(gridPosition.current)

    // Sync cursor to the draft mesh's world position and rotation
    if (draftNode.current) {
      const mesh = sceneRegistry.nodes.get(draftNode.current.id)
      if (mesh) {
        mesh.getWorldPosition(cursorRef.current.position)
        // Extract world Y rotation (handles wall-parented items correctly)
        const q = new Quaternion()
        mesh.getWorldQuaternion(q)
        cursorRef.current.rotation.y = new Euler().setFromQuaternion(q, 'YXZ').y
      } else {
        cursorRef.current.position.copy(gridPosition.current)
        cursorRef.current.rotation.y = draftNode.current.rotation[1] ?? 0
      }
    }

    revalidate()

    // ---- Floor Handlers ----

    const onGridMove = (event: GridEvent) => {
      const result = floorStrategy.move(getContext(), event)
      if (!result) return

      gridPosition.current.set(...result.gridPosition)
      cursorRef.current.position.set(...result.cursorPosition)

      const draft = draftNode.current
      if (draft) draft.position = result.gridPosition

      revalidate()
    }

    const onGridClick = (event: GridEvent) => {
      const result = floorStrategy.click(getContext(), event, validators)
      if (!result) return

      // Preserve cursor rotation for the next draft
      const currentRotation: [number, number, number] = [0, cursorRef.current.rotation.y, 0]

      draftNode.commit(result.nodeUpdate)
      if (config.onCommitted()) {
        draftNode.create(gridPosition.current, asset, currentRotation)
        revalidate()
      }
    }

    // ---- Wall Handlers ----

    const onWallEnter = (event: WallEvent) => {
      const nodes = useScene.getState().nodes
      const result = wallStrategy.enter(getContext(), event, resolveLevelId, nodes)
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
      const ctx = getContext()

      if (ctx.state.surface !== 'wall') {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(ctx, event, resolveLevelId, nodes)
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
        const setup = wallStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      const result = wallStrategy.move(ctx, event)
      if (!result) return

      event.stopPropagation()

      const posChanged =
        gridPosition.current.x !== result.gridPosition[0] ||
        gridPosition.current.y !== result.gridPosition[1] ||
        gridPosition.current.z !== result.gridPosition[2]

      gridPosition.current.set(...result.gridPosition)
      cursorRef.current.position.set(...result.cursorPosition)
      cursorRef.current.rotation.y = result.cursorRotationY

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
      }
    }

    const onWallClick = (event: WallEvent) => {
      const result = wallStrategy.click(getContext(), event, validators)
      if (!result) return

      event.stopPropagation()
      draftNode.commit(result.nodeUpdate)
      if (result.dirtyNodeId) {
        useScene.getState().dirtyNodes.add(result.dirtyNodeId)
      }

      if (config.onCommitted()) {
        const nodes = useScene.getState().nodes
        const enterResult = wallStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (enterResult) {
          applyTransition(enterResult)
        } else {
          revalidate()
        }
      }
    }

    const onWallLeave = (event: WallEvent) => {
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
            useScene.getState().updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
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

    // ---- Ceiling Handlers ----

    const onCeilingEnter = (event: CeilingEvent) => {
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
      if (!draftNode.current && placementState.current.surface === 'ceiling') {
        const nodes = useScene.getState().nodes
        const setup = ceilingStrategy.enter(getContext(), event, resolveLevelId, nodes)
        if (!setup) return

        event.stopPropagation()
        ensureDraft(setup)
        return
      }

      const result = ceilingStrategy.move(getContext(), event)
      if (!result) return

      event.stopPropagation()
      gridPosition.current.set(...result.gridPosition)
      cursorRef.current.position.set(...result.cursorPosition)

      revalidate()

      const draft = draftNode.current
      if (draft) {
        draft.position = result.gridPosition
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.position.copy(gridPosition.current)
      }
    }

    const onCeilingClick = (event: CeilingEvent) => {
      const result = ceilingStrategy.click(getContext(), event, validators)
      if (!result) return

      event.stopPropagation()
      draftNode.commit(result.nodeUpdate)

      if (config.onCommitted()) {
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
            useScene.getState().updateNode(draft.id, { parentId: result.nodeUpdate.parentId as string })
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
      // Escape / right-click → cancel
      if (event.key === 'Escape' && config.onCancel) {
        event.preventDefault()
        config.onCancel()
        return
      }

      const draft = draftNode.current
      if (!draft) return

      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        const currentRotation = draft.rotation
        const newRotationY = (currentRotation[1] ?? 0) + rotationDelta
        draft.rotation = [currentRotation[0], newRotationY, currentRotation[2]]

        // Ref + cursor mesh + item mesh — no store update during drag
        cursorRef.current.rotation.y = newRotationY
        const mesh = sceneRegistry.nodes.get(draft.id)
        if (mesh) mesh.rotation.y = newRotationY
        revalidate()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // ---- Right-click cancel ----
    const onContextMenu = (event: MouseEvent) => {
      if (config.onCancel) {
        event.preventDefault()
        config.onCancel()
      }
    }
    window.addEventListener('contextmenu', onContextMenu)

    // ---- Bounding box geometry ----

    const dims = asset.dimensions ?? DEFAULT_DIMENSIONS
    const boxGeometry = new BoxGeometry(dims[0], dims[1], dims[2])
    boxGeometry.translate(0, dims[1] / 2, 0)
    cursorRef.current.geometry = boxGeometry

    // ---- Subscribe ----

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('ceiling:enter', onCeilingEnter)
    emitter.on('ceiling:move', onCeilingMove)
    emitter.on('ceiling:click', onCeilingClick)
    emitter.on('ceiling:leave', onCeilingLeave)

    return () => {
      draftNode.destroy()
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('ceiling:enter', onCeilingEnter)
      emitter.off('ceiling:move', onCeilingMove)
      emitter.off('ceiling:click', onCeilingClick)
      emitter.off('ceiling:leave', onCeilingLeave)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [asset, canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling, draftNode])

  useFrame((_, delta) => {
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
        const levelId = useViewer.getState().selection.levelId
        if (levelId) {
          const slabElevation = spatialGridManager.getSlabElevationForItem(
            levelId,
            [gridPosition.current.x, gridPosition.current.y, gridPosition.current.z],
            asset.dimensions ?? DEFAULT_DIMENSIONS,
            draftNode.current.rotation,
          )
          mesh.position.y = slabElevation
          cursorRef.current.position.y = slabElevation
        }
      }
    }
  })

  return (
    <group>
      <mesh ref={cursorRef}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color="red" wireframe />
      </mesh>
    </group>
  )
}
