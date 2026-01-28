import {
  type CeilingEvent,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
  useSpatialQuery,
  type WallEvent,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BoxGeometry, type Mesh, type MeshStandardMaterial, Vector3 } from 'three'
import { resolveLevelId } from '../../../../../packages/core/src/hooks/spatial-grid/spatial-grid-sync'
import {
  ceilingStrategy,
  checkCanPlace,
  floorStrategy,
  wallStrategy,
} from './placement-strategies'
import type { PlacementState, TransitionResult } from './placement-types'
import type { DraftNodeHandle } from './use-draft-node'
import type { Asset } from '../../../../../packages/core/src/schema/nodes/item'

export interface PlacementCoordinatorConfig {
  asset: Asset
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

      draftNode.create(gridPosition.current, asset)

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

    // Sync cursor to the draft mesh's world position (handles floor + wall/ceiling items)
    if (draftNode.current) {
      const mesh = sceneRegistry.nodes.get(draftNode.current.id)
      if (mesh) {
        mesh.getWorldPosition(cursorRef.current.position)
      } else {
        cursorRef.current.position.copy(gridPosition.current)
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

      draftNode.commit(result.nodeUpdate)
      if (config.onCommitted()) {
        draftNode.create(gridPosition.current, asset)
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
        }
        // Mark parent wall dirty so it rebuilds geometry — no store update needed
        if (result.dirtyNodeId) {
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
        draftNode.destroy()
        Object.assign(placementState.current, result.stateUpdate)
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
        draftNode.destroy()
        Object.assign(placementState.current, result.stateUpdate)
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

        // Ref + cursor mesh only — no store update during drag
        cursorRef.current.rotation.y = newRotationY
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

    const boxGeometry = new BoxGeometry(
      asset.dimensions[0],
      asset.dimensions[1],
      asset.dimensions[2],
    )
    boxGeometry.translate(0, asset.dimensions[1] / 2, 0)
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
    if (draftNode.current && placementState.current.surface === 'floor') {
      const mesh = sceneRegistry.nodes.get(draftNode.current.id)
      if (mesh) {
        const distance = mesh.position.distanceToSquared(gridPosition.current)
        if (distance > 1) {
          mesh.position.copy(gridPosition.current)
          return
        }
        mesh.position.lerp(gridPosition.current, delta * 20)
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
