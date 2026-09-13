'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type NodeEvent,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import {
  clearPlacementSurface,
  consumePlacementDragRelease,
  EDITOR_LAYER,
  isGridSnapActive,
  publishPlacementSurface,
  snapToHalf,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { BoxGeometry, EdgesGeometry, Vector3 } from 'three'
import type { DeviceNode } from '../device/schema'
import type { ServiceNode } from '../service/schema'
import {
  beginMoveHistorySession,
  holdHiddenWallPointerEventsCompat,
  isWallMeshHidden,
} from './host-compat'
import {
  currentWallAnchor,
  type FloorMoveTarget,
  floorCommitPatch,
  floorLiveOverride,
  floorMoveTarget,
  heightBandFor,
  isWallMountedMoveNode,
  moveBodyDims,
  nearestWallMoveTarget,
  resolveWallMoveTarget,
  shouldIgnoreWallEventForMove,
  wallCommitPatch,
  wallLiveOverride,
  type WallMoveTarget,
} from './move-core'

/**
 * Window-parity MOVE tool for Bones wall-mount nodes (`bones:device` +
 * `bones:service`) — mounted by the host's MoveTool dispatcher through
 * `def.affordanceTools.move` whenever `useEditor.movingNode` is one of these
 * kinds (same activation as a window: the context-toolbar Move cross, or a
 * press-drag).
 *
 * Wall-mounted nodes (devices always; wall service types) slide along the
 * wall SURFACE like a window:
 *  - the cursor model is `wall:enter` / `wall:move` / `wall:click`, with the
 *    #689 hidden-wall pointer hold so an X-ray drag keeps riding the node's
 *    own hidden wall, and the #694 own-wall gate so an interposed hidden
 *    wall can never steal the drag (ignored events are NOT stopPropagation'd
 *    — the ray falls through to the own wall behind);
 *  - a green ghost box rides the wall plane at the (grid-snapped) cursor;
 *    the REAL box — the engine-snapped fixture the framing renderer draws —
 *    follows live through `useLiveNodeOverrides` + the framing live
 *    recompute, which routes every preview through `applyDeviceOverrides`
 *    (stud/blocking snap, RO clearance, height bands: the night-5 rules);
 *  - over open floor the node keeps riding the NEAREST wall (a wall-mount
 *    box has no off-wall drop — this also keeps cross-wall moves fluid);
 *  - drop (click / press-drag release) is ONE tracked write — the anchor
 *    form `wallId` + `wallT` + `heightAff` with `position` reset to the
 *    [0,0,0] sentinel — inside a #694-style refcounted history session:
 *    one undo entry, undo restores the exact pre-drag anchor.
 *
 * Floor-placed service types (heat pump pad, sewer exit) get the equivalent
 * planar move with the same affordance: a grid-snapped ground drag riding
 * `grid:move`, committed as the same single tracked `position` write.
 *
 * Cancel (Esc / tool switch) never writes the scene: the preview lives
 * entirely in `useLiveNodeOverrides`, so cancel just clears the override.
 */

const GHOST_COLOR = 0x22_c5_5e

type MovingNode = (DeviceNode | ServiceNode) & { parentId?: string | null }

type GhostPose = {
  position: readonly [number, number, number]
  rotationY: number
}

const WallMountMoveTool = ({ node }: { node: MovingNode }) => {
  const [ghost, setGhost] = useState<GhostPose | null>(null)

  const body = useMemo(() => moveBodyDims(node as never), [node])
  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(body[0], body[1], body[2])
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [body])
  useEffect(() => () => edgesGeo.dispose(), [edgesGeo])

  useEffect(() => {
    const wallMode = isWallMountedMoveNode(node as never)
    const band = heightBandFor(node as never)
    const levelId = node.parentId ?? null

    // One undo entry per gesture (#694 pattern): refcounted pause for the
    // move's lifetime; `commitStep` opens the single tracking window.
    const session = beginMoveHistorySession()
    // #689: keep hidden walls pointer-targetable — the wall-surface cursor
    // model needs their wall:* events in X-ray 'down' mode.
    const releaseHiddenWallHold = wallMode ? holdHiddenWallPointerEventsCompat() : () => {}

    let committed = false
    let hasMoved = false
    let lastWallTarget: WallMoveTarget | null = null
    let lastFloorTarget: FloorMoveTarget | null = null

    // The walls this node may ride even while HIDDEN: the wall it was
    // grabbed from + the current mid-drag host (#694 own-wall rule).
    const anchor = currentWallAnchor(
      useScene.getState().nodes as never,
      node as never,
    )
    const grabWallId: string | null = anchor.wallId
    // Height carried across the floor fallback (no wall face under the
    // cursor → the box keeps its current mount height on the nearest wall).
    let heightCarry = anchor.heightAff

    // Wall events own the pointer while the cursor rides a wall face; the
    // floor fallback stands down until the stamp goes stale (same clock
    // de-dupe the window move tool uses — the two streams have different
    // event clocks, so timestamps can't be compared directly).
    let wallOwnedPointerAt = Number.NEGATIVE_INFINITY
    const WALL_OWNS_POINTER_MS = 64
    const markWallOwnedPointer = () => {
      wallOwnedPointerAt = performance.now()
    }
    const wallOwnsPointer = () => performance.now() - wallOwnedPointerAt < WALL_OWNS_POINTER_MS

    // ONE soft grid-snap tick per snapped step the ghost crosses.
    const FREE_STEP_M = 0.1
    let lastStepKey: string | null = null
    const tickGridStep = (...coords: number[]) => {
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : FREE_STEP_M
      const key = coords.map((c) => Math.round(c / step)).join(',')
      if (key === lastStepKey) return
      lastStepKey = key
      triggerSFX('sfx:grid-snap')
    }

    const getLevelYOffset = () => {
      if (!levelId) return 0
      const level = sceneRegistry.nodes.get(levelId as AnyNodeId) as
        | { position: { y: number } }
        | undefined
      return level?.position.y ?? 0
    }

    const exitMoveMode = () => {
      useEditor.getState().setMovingNode(null)
    }

    const clearPreview = () => {
      useLiveNodeOverrides.getState().clear(node.id)
      setGhost(null)
      clearPlacementSurface()
    }

    // ── Wall-slide preview ─────────────────────────────────────────
    const applyWallPreview = (target: WallMoveTarget) => {
      lastWallTarget = target
      heightCarry = target.heightAff
      hasMoved = true
      // The live override: renderer + framing live recompute both ride it —
      // the engine box follows with the stud/blocking snap applied.
      useLiveNodeOverrides.getState().set(node.id, wallLiveOverride(target) as never)
      const y = getLevelYOffset() + target.heightAff
      setGhost({
        position: [target.plan[0], y, target.plan[1]],
        rotationY: target.rotationY,
      })
      // Tilt the snap grid into the wall plane at the box (normal = local +Z).
      publishPlacementSurface(
        new Vector3(target.plan[0], y, target.plan[1]),
        new Vector3(Math.sin(target.rotationY), 0, Math.cos(target.rotationY)),
      )
      tickGridStep(target.plan[0], target.plan[1], target.heightAff)
    }

    const wallEventIgnored = (event: WallEvent) =>
      shouldIgnoreWallEventForMove({
        eventWallId: event.node.id,
        eventWallHidden: isWallMeshHidden(event.node.id),
        ownWallIds: [grabWallId, lastWallTarget?.wallId],
      })

    const resolveFromWallEvent = (event: WallEvent): WallMoveTarget | null =>
      resolveWallMoveTarget({
        wall: event.node as never,
        wallId: event.node.id,
        localX: event.localPosition[0],
        localY: event.localPosition[1],
        body,
        band,
        snap: snapToHalf,
      })

    const onWallMove = (event: WallEvent) => {
      if (committed || !wallMode) return
      // Interposed hidden wall: ignore WITHOUT stopPropagation — the ray
      // falls through to the own wall behind it (#694).
      if (wallEventIgnored(event)) return
      // Only walls on the node's own level host the anchor.
      if (levelId && event.node.parentId !== levelId) return
      const target = resolveFromWallEvent(event)
      if (!target) return // curved / degenerate wall — floor fallback covers it
      markWallOwnedPointer()
      applyWallPreview(target)
      event.stopPropagation()
    }

    // ── Floor fallback: ride the NEAREST wall (wall mode) or the plan
    //    point (floor mode) ───────────────────────────────────────────
    const onGridMove = (event: GridEvent) => {
      if (committed) return
      if (useViewer.getState().cameraDragging) return
      if (wallOwnsPointer()) return
      const plan: readonly [number, number] = [event.localPosition[0], event.localPosition[2]]
      if (wallMode) {
        const target = nearestWallMoveTarget({
          nodes: useScene.getState().nodes as never,
          node: node as never,
          plan,
          heightAff: heightCarry,
          body,
          band,
          snap: snapToHalf,
        })
        if (!target) return
        // #694 parity for the floor fallback too: never re-anchor onto a
        // HIDDEN wall that isn't one of the node's own walls — the user
        // can't see it. The own hidden wall keeps working (X-ray drag).
        if (
          shouldIgnoreWallEventForMove({
            eventWallId: target.wallId,
            eventWallHidden: isWallMeshHidden(target.wallId),
            ownWallIds: [grabWallId, lastWallTarget?.wallId],
          })
        ) {
          return
        }
        applyWallPreview(target)
        return
      }
      const target = floorMoveTarget(plan, snapToHalf)
      lastFloorTarget = target
      hasMoved = true
      useLiveNodeOverrides.getState().set(node.id, floorLiveOverride(target) as never)
      tickGridStep(target.plan[0], target.plan[1])
    }

    // ── Commit: restore-free (no mid-drag scene writes) — the drop is the
    //    gesture's ONE tracked write, then the override clears ──────────
    const commit = () => {
      if (committed || !hasMoved) return
      const patch = wallMode
        ? lastWallTarget && wallCommitPatch(lastWallTarget)
        : lastFloorTarget && floorCommitPatch(lastFloorTarget)
      if (!patch) return
      committed = true
      session.commitStep(() => {
        useScene.getState().updateNode(node.id as AnyNodeId, patch as never)
      })
      // Scene write first, then the override clears — every render shows
      // either the live drag spot or the committed anchor, never a flash of
      // the pre-drag position.
      clearPreview()
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [node.id as AnyNodeId] })
      exitMoveMode()
    }

    const onWallClick = (event: WallEvent) => {
      if (committed || !wallMode || !hasMoved) return
      // A click on an interposed hidden wall must not commit / re-anchor —
      // it falls through to the own wall behind (#694).
      if (wallEventIgnored(event)) return
      if (levelId && event.node.parentId !== levelId) return
      const target = resolveFromWallEvent(event)
      if (target) applyWallPreview(target)
      commit()
      event.stopPropagation()
    }

    const onGridClick = () => {
      commit()
    }

    // A click on any other mesh (the moving box itself, an item, a slab)
    // still drops at the last previewed spot — matching the host's generic
    // move tool, so "click did nothing" can't happen.
    const onNodeClick = (_event: NodeEvent) => {
      commit()
    }

    // Press-drag arm (grab the box and drag): the release pointer-up drops.
    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      commit()
    }

    const onCancel = () => {
      // Nothing to revert — the preview never touched the scene store.
      clearPreview()
      session.end()
      exitMoveMode()
    }

    emitter.on('wall:enter', onWallMove)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    // `node:${suffix}` is a newer bus key than the pinned core types — the
    // host's useNodeEvents mirrors every kind event onto it (cast like the
    // other post-0.9.2 host contract fields).
    emitter.on('node:click' as never, onNodeClick as never)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('wall:enter', onWallMove)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('node:click' as never, onNodeClick as never)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
      clearPreview()
      releaseHiddenWallHold()
      session.end()
    }
  }, [node, body])

  return ghost ? (
    <group position={ghost.position as [number, number, number]} rotation-y={ghost.rotationY}>
      <mesh layers={EDITOR_LAYER}>
        <boxGeometry args={[body[0], body[1], body[2]]} />
        <meshBasicMaterial
          color={GHOST_COLOR}
          depthTest={false}
          depthWrite={false}
          opacity={0.28}
          transparent
        />
      </mesh>
      <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER}>
        <lineBasicMaterial color={GHOST_COLOR} depthTest={false} depthWrite={false} />
      </lineSegments>
    </group>
  ) : null
}

export default WallMountMoveTool
