import type {
  AnyNode,
  AnyNodeId,
  CeilingEvent,
  CeilingNode,
  GridEvent,
  ItemEvent,
  ItemNode,
  RoofEvent,
  RoofNode,
  RoofSegmentNode,
  RoofWallFaceId,
  ShelfEvent,
  ShelfNode,
  WallEvent,
  WallNode,
} from '@pascal-app/core'
import {
  canHostOnTop,
  clampRectToRoofWallFace,
  getRoofSegmentWallFace,
  getScaledDimensions,
  isLowProfileItemSurface,
  nodeRegistry,
  roofFacePointToSegment,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Euler, Matrix3, Quaternion, Vector3 } from 'three'
import { hasRoofFaceChildOverlap, resolveRoofWallHit } from '../../../lib/roof-wall-hit'
import { snapWorldXZForActiveBuilding } from '../../../lib/world-grid-snap'
import {
  calculateCursorRotation,
  calculateItemRotation,
  getGridAlignedDimensions,
  getSideFromNormal,
  isValidWallSideFace,
  snapToGrid,
  snapToHalf,
  stripTransient,
} from './placement-math'
import type {
  CommitResult,
  LevelResolver,
  PlacementContext,
  PlacementResult,
  SpatialValidators,
  TransitionResult,
} from './placement-types'

const DEFAULT_DIMENSIONS: [number, number, number] = [1, 1, 1]
const UPWARD_SURFACE_NORMAL_MIN_Y = 0.75

function getWorldNormalY(event: ItemEvent): number | null {
  if (!event.normal) return null

  const normal = new Vector3(event.normal[0], event.normal[1], event.normal[2])
  normal.applyNormalMatrix(new Matrix3().getNormalMatrix(event.object.matrixWorld)).normalize()
  return normal.y
}

function isUpwardItemSurfaceHit(event: ItemEvent): boolean {
  const normalY = getWorldNormalY(event)
  return normalY !== null && normalY >= UPWARD_SURFACE_NORMAL_MIN_Y
}

function getSurfacePlacementHeight(surfaceItem: ItemNode, event: ItemEvent, localPos: Vector3) {
  if (!canHostOnTop(surfaceItem)) return null
  if (isLowProfileItemSurface(surfaceItem)) return null
  if (!isUpwardItemSurfaceHit(event)) return null

  if (surfaceItem.asset.surface) {
    return surfaceItem.asset.surface.height * surfaceItem.scale[1]
  }

  if (!Number.isFinite(localPos.y)) return null
  return localPos.y
}

function isDescendantOfItem(
  candidate: ItemNode,
  ancestor: ItemNode,
  nodes: Record<string, AnyNode>,
): boolean {
  let parentId = candidate.parentId
  while (parentId) {
    if (parentId === ancestor.id) return true
    const parent = nodes[parentId as AnyNodeId]
    parentId = parent?.parentId ?? null
  }
  return false
}

// ============================================================================
// FLOOR STRATEGY
// ============================================================================

export const floorStrategy = {
  /**
   * Handle grid:move — update position when on floor surface.
   * Returns null if currently on wall/ceiling.
   */
  move(ctx: PlacementContext, event: GridEvent): PlacementResult | null {
    if (ctx.state.surface !== 'floor') return null

    const rawDims = ctx.draftItem
      ? getScaledDimensions(ctx.draftItem)
      : (ctx.asset.dimensions ?? DEFAULT_DIMENSIONS)
    const dims = getGridAlignedDimensions(rawDims, ctx.asset.attachTo)
    const [dimX, , dimZ] = dims
    const rotY = ctx.draftItem?.rotation?.[1] ?? 0
    const swapDims = Math.abs(Math.sin(rotY)) > 0.9
    // Snap on the world XZ grid (the grid the editor renders) so the
    // item edges land on the visible grid even when the active building
    // is rotated; then project the world point back into building-local
    // for storage. Without this, a rotated building drags placement off
    // the world grid.
    // Snapping is governed by the active mode (snapToGrid returns raw in Off /
    // non-grid modes); Alt is force-place only and never bypasses snapping here.
    const [x, z] = snapWorldXZForActiveBuilding(
      snapToGrid(event.position[0], swapDims ? dimZ : dimX),
      snapToGrid(event.position[2], swapDims ? dimX : dimZ),
      0,
    ).local
    const y = ctx.gridPosition.y

    return {
      gridPosition: [x, y, z],
      cursorPosition: [x, y, z],
      cursorRotationY: rotY,
      nodeUpdate: { position: [x, y, z] },
      stopPropagation: false,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle grid:click — commit placement on floor.
   * Returns null if on wall/ceiling or validation fails.
   */
  click(
    ctx: PlacementContext,
    _event: GridEvent,
    validators: SpatialValidators,
  ): CommitResult | null {
    if (ctx.state.surface !== 'floor') return null
    if (!(ctx.levelId && ctx.draftItem)) return null
    if (ctx.draftItem.asset.attachTo) return null

    const pos: [number, number, number] = [
      ctx.gridPosition.x,
      ctx.gridPosition.y,
      ctx.gridPosition.z,
    ]
    const valid = validators.canPlaceOnFloor(
      ctx.levelId,
      pos,
      getGridAlignedDimensions(getScaledDimensions(ctx.draftItem), ctx.draftItem.asset.attachTo),
      ctx.draftItem.rotation,
      [ctx.draftItem.id],
    ).valid

    if (!valid) return null

    return {
      nodeUpdate: {
        position: pos,
        parentId: ctx.levelId,
        metadata: stripTransient(ctx.draftItem.metadata),
      },
      stopPropagation: false,
      dirtyNodeId: null,
    }
  },
}

// ============================================================================
// WALL STRATEGY
// ============================================================================

export const wallStrategy = {
  /**
   * Handle wall:enter — transition from floor to wall surface.
   * Returns null if item doesn't attach to walls, face is invalid, or wrong level.
   * Auto-adjusts Y position to fit within wall bounds.
   */
  enter(
    ctx: PlacementContext,
    event: WallEvent,
    resolveLevelId: LevelResolver,
    nodes: Record<string, AnyNode>,
    validators: SpatialValidators,
  ): TransitionResult | null {
    const attachTo = ctx.asset.attachTo
    if (attachTo !== 'wall' && attachTo !== 'wall-side') return null
    if (!isValidWallSideFace(event.normal)) return null

    // Level guard
    const wallLevelId = resolveLevelId(event.node, nodes)
    if (ctx.levelId !== wallLevelId) return null

    const side = getSideFromNormal(event.normal)
    const itemRotation = calculateItemRotation(event.normal)
    const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

    const x = snapToHalf(event.localPosition[0])
    const y = snapToHalf(event.localPosition[1])
    const z = snapToHalf(event.localPosition[2])

    // Get auto-adjusted Y position from validator
    const rawDims = ctx.draftItem
      ? getScaledDimensions(ctx.draftItem)
      : (ctx.asset.dimensions ?? DEFAULT_DIMENSIONS)
    const validation = validators.canPlaceOnWall(
      ctx.levelId,
      event.node.id,
      x,
      y,
      getGridAlignedDimensions(rawDims, attachTo),
      attachTo,
      side,
      [],
    )

    const adjustedY = validation.adjustedY ?? y

    return {
      stateUpdate: { surface: 'wall', wallId: event.node.id, roofSegmentId: null },
      nodeUpdate: {
        position: [x, adjustedY, z],
        parentId: event.node.id,
        // The draft may arrive from a roof-segment wall face.
        roofSegmentId: undefined,
        roofFace: undefined,
        side,
        rotation: [0, itemRotation, 0],
      },
      cursorRotationY: cursorRotation,
      gridPosition: [x, adjustedY, z],
      cursorPosition: [
        snapToHalf(event.position[0]),
        snapToHalf(event.position[1]),
        snapToHalf(event.position[2]),
      ],
      stopPropagation: true,
    }
  },

  /**
   * Handle wall:move — update position while on wall.
   * Returns null if not on a wall or face is invalid.
   * Auto-adjusts Y position to fit within wall bounds.
   */
  move(
    ctx: PlacementContext,
    event: WallEvent,
    validators: SpatialValidators,
  ): PlacementResult | null {
    if (ctx.state.surface !== 'wall') return null
    if (!(ctx.draftItem && ctx.levelId)) return null
    if (!isValidWallSideFace(event.normal)) return null

    const side = getSideFromNormal(event.normal)
    const itemRotation = calculateItemRotation(event.normal)
    const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

    const snappedX = snapToHalf(event.localPosition[0])
    const snappedY = snapToHalf(event.localPosition[1])
    const snappedZ = snapToHalf(event.localPosition[2])

    // Get auto-adjusted Y position from validator
    const validation = validators.canPlaceOnWall(
      ctx.levelId,
      event.node.id,
      snappedX,
      snappedY,
      getGridAlignedDimensions(getScaledDimensions(ctx.draftItem), ctx.draftItem.asset.attachTo),
      ctx.draftItem.asset.attachTo as 'wall' | 'wall-side',
      side,
      [ctx.draftItem.id],
    )

    const adjustedY = validation.adjustedY ?? snappedY

    return {
      gridPosition: [snappedX, adjustedY, snappedZ],
      cursorPosition: [
        snapToHalf(event.position[0]),
        snapToHalf(event.position[1]),
        snapToHalf(event.position[2]),
      ],
      cursorRotationY: cursorRotation,
      nodeUpdate: {
        position: [snappedX, adjustedY, snappedZ],
        side,
        rotation: [0, itemRotation, 0],
      },
      stopPropagation: true,
      dirtyNodeId: event.node.id,
    }
  },

  /**
   * Handle wall:click — commit placement on wall.
   * Returns null if not on wall, face invalid, or validation fails.
   */
  click(
    ctx: PlacementContext,
    event: WallEvent,
    validators: SpatialValidators,
  ): CommitResult | null {
    if (ctx.state.surface !== 'wall') return null
    if (!isValidWallSideFace(event.normal)) return null
    if (!(ctx.levelId && ctx.draftItem)) return null

    const valid = validators.canPlaceOnWall(
      ctx.levelId,
      ctx.state.wallId as WallNode['id'],
      ctx.gridPosition.x,
      ctx.gridPosition.y,
      getGridAlignedDimensions(getScaledDimensions(ctx.draftItem), ctx.draftItem.asset.attachTo),
      ctx.draftItem.asset.attachTo as 'wall' | 'wall-side',
      ctx.draftItem.side,
      [ctx.draftItem.id],
    ).valid

    if (!valid) return null

    return {
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: event.node.id,
        roofSegmentId: undefined,
        roofFace: undefined,
        side: ctx.draftItem.side,
        rotation: ctx.draftItem.rotation,
        metadata: stripTransient(ctx.draftItem.metadata),
      },
      stopPropagation: true,
      dirtyNodeId: event.node.id,
    }
  },

  /**
   * Handle wall:leave — transition back to floor surface.
   */
  leave(ctx: PlacementContext): TransitionResult | null {
    if (ctx.state.surface !== 'wall') return null

    return {
      stateUpdate: { surface: 'floor', wallId: null },
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: ctx.levelId,
      },
      cursorRotationY: 0,
      gridPosition: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      cursorPosition: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      stopPropagation: true,
    }
  },
}

// ============================================================================
// ROOF WALL STRATEGY
// ============================================================================

type RoofWallTarget = {
  segment: RoofSegmentNode
  faceId: RoofWallFaceId
  faceYaw: number
  /** Stored node position: FACE-LOCAL, y = bottom edge. */
  position: [number, number, number]
  /** Face-coord center of the placed rect (for the overlap guard). */
  centerU: number
  centerV: number
  width: number
  height: number
  cursorPosition: [number, number, number]
  cursorRotationY: number
}

/**
 * Resolve a roof pointer event to an item placement on a segment wall
 * face. Items snap u / bottom-v to the 0.5m grid, then the rect is
 * clamped inside the face profile (sliding under the gable slopes).
 * Position frame matches wall hosting: y anchors the BOTTOM edge;
 * `wall-side` items mount on the outer surface, `wall` items center in
 * the wall thickness.
 *
 * `freePlace` mirrors the wall flow's Alt override (stubbed
 * validators): the profile clamp is skipped, so the rect may overhang
 * the face edges — placement follows the snapped cursor as-is.
 */
function resolveRoofWallTarget(
  ctx: PlacementContext,
  event: RoofEvent,
  freePlace = false,
): RoofWallTarget | null {
  const attachTo = ctx.asset.attachTo
  if (attachTo !== 'wall' && attachTo !== 'wall-side') return null

  const hit = resolveRoofWallHit(event.node as RoofNode, event.position, event.normal, event.object)
  if (!hit) return null

  const rawDims = ctx.draftItem
    ? getScaledDimensions(ctx.draftItem)
    : (ctx.asset.dimensions ?? DEFAULT_DIMENSIONS)
  const dims = getGridAlignedDimensions(rawDims, attachTo)
  const [width, height] = dims

  // Snap follows the active mode (snapToHalf returns raw in Off/non-grid);
  // `freePlace` (Alt) is force-place — it only skips the face-fit validity gate.
  const u = snapToHalf(hit.u)
  const centerV = snapToHalf(hit.v) + height / 2
  const fitted = freePlace ? null : clampRectToRoofWallFace(hit.face, u, centerV, width, height)
  if (!fitted && !freePlace) return null
  const finalU = fitted?.u ?? u
  const finalV = fitted?.v ?? centerV

  // FACE-LOCAL storage (z = 0 → wall mid-plane; ItemSystem pushes
  // wall-side items to the outer surface, exactly like wall hosting).
  // The renderer mounts the node inside the live face frame, so items
  // track segment resizes without any re-anchoring.
  const position: [number, number, number] = [finalU, finalV - height / 2, 0]

  const segObj = sceneRegistry.nodes.get(hit.segment.id)
  if (!segObj) return null
  segObj.updateWorldMatrix(true, false)
  const segLocal = roofFacePointToSegment(hit.segment, hit.face.id, position)
  const worldPos = segObj.localToWorld(new Vector3(segLocal[0], segLocal[1], segLocal[2]))

  const nodes = useScene.getState().nodes
  const roof = hit.segment.parentId
    ? (nodes[hit.segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined

  return {
    segment: hit.segment,
    faceId: hit.face.id,
    faceYaw: hit.face.yaw,
    position,
    centerU: finalU,
    centerV: finalV,
    width,
    height,
    cursorPosition: [worldPos.x, worldPos.y, worldPos.z],
    cursorRotationY: (roof?.rotation ?? 0) + (hit.segment.rotation ?? 0) + hit.face.yaw,
  }
}

/** Validation half of `checkCanPlace` for the roof-wall surface. */
function canPlaceOnRoofWall(ctx: PlacementContext): boolean {
  const segmentId = ctx.state.roofSegmentId
  if (!(segmentId && ctx.draftItem)) return false
  const segment = useScene.getState().nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
  if (segment?.type !== 'roof-segment') return false
  const faceId = ctx.draftItem.roofFace
  if (!faceId) return false
  const face = getRoofSegmentWallFace(segment, faceId)

  const dims = getGridAlignedDimensions(
    getScaledDimensions(ctx.draftItem),
    ctx.draftItem.asset.attachTo,
  )
  const [width, height] = dims
  // gridPosition carries the stored FACE-LOCAL coords (u, bottom-v, z).
  const u = ctx.gridPosition.x
  const centerV = ctx.gridPosition.y + height / 2
  const clamped = clampRectToRoofWallFace(face, u, centerV, width, height)
  if (!clamped || Math.abs(clamped.u - u) > 1e-3 || Math.abs(clamped.v - centerV) > 1e-3) {
    return false
  }
  return !hasRoofFaceChildOverlap(segment, faceId, u, centerV, width, height, ctx.draftItem.id)
}

export const roofWallStrategy = {
  /**
   * Handle roof:enter / first hover — transition onto a segment wall
   * face. Returns null when the item doesn't wall-attach or the pointer
   * isn't over a placeable face.
   */
  enter(ctx: PlacementContext, event: RoofEvent, freePlace = false): TransitionResult | null {
    const target = resolveRoofWallTarget(ctx, event, freePlace)
    if (!target) return null

    return {
      stateUpdate: { surface: 'roof-wall', roofSegmentId: target.segment.id, wallId: null },
      nodeUpdate: {
        position: target.position,
        parentId: target.segment.id,
        roofSegmentId: target.segment.id,
        roofFace: target.faceId,
        wallId: undefined,
        side: 'front',
        rotation: [0, 0, 0],
      },
      cursorRotationY: target.cursorRotationY,
      gridPosition: target.position,
      cursorPosition: target.cursorPosition,
      stopPropagation: true,
    }
  },

  /**
   * Handle roof:move while on a segment wall face. Returns null when the
   * pointer resolves to a DIFFERENT segment (the coordinator re-enters —
   * segment transitions inside one roof never re-fire roof:enter) or to
   * no placeable face.
   */
  move(ctx: PlacementContext, event: RoofEvent, freePlace = false): PlacementResult | null {
    if (ctx.state.surface !== 'roof-wall') return null
    if (!ctx.draftItem) return null

    const target = resolveRoofWallTarget(ctx, event, freePlace)
    if (!target) return null
    if (target.segment.id !== ctx.state.roofSegmentId) return null

    return {
      gridPosition: target.position,
      cursorPosition: target.cursorPosition,
      cursorRotationY: target.cursorRotationY,
      nodeUpdate: {
        position: target.position,
        side: 'front',
        rotation: [0, 0, 0],
        roofFace: target.faceId,
      },
      stopPropagation: true,
      // Items don't cut the roof — no geometry rebuild needed.
      dirtyNodeId: null,
    }
  },

  /**
   * Handle roof:click — commit placement on the segment wall face.
   */
  click(ctx: PlacementContext, _event: RoofEvent, freePlace = false): CommitResult | null {
    if (ctx.state.surface !== 'roof-wall') return null
    if (!(ctx.draftItem && ctx.state.roofSegmentId)) return null
    // Alt mirrors the wall flow's stubbed validators: skip profile-fit
    // and overlap checks entirely.
    if (!freePlace && !canPlaceOnRoofWall(ctx)) return null

    return {
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: ctx.state.roofSegmentId,
        roofSegmentId: ctx.state.roofSegmentId,
        roofFace: ctx.draftItem.roofFace,
        wallId: undefined,
        side: 'front',
        rotation: [0, 0, 0],
        metadata: stripTransient(ctx.draftItem.metadata),
      },
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle roof:leave — transition back to floor surface.
   */
  leave(ctx: PlacementContext): TransitionResult | null {
    if (ctx.state.surface !== 'roof-wall') return null

    return {
      stateUpdate: { surface: 'floor', roofSegmentId: null },
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: ctx.levelId,
        roofSegmentId: undefined,
        roofFace: undefined,
      },
      cursorRotationY: 0,
      gridPosition: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      cursorPosition: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      stopPropagation: true,
    }
  },
}

// ============================================================================
// CEILING STRATEGY
// ============================================================================

export const ceilingStrategy = {
  /**
   * Handle ceiling:enter — transition from floor to ceiling surface.
   * Returns null if item doesn't attach to ceilings or wrong level.
   */
  enter(
    ctx: PlacementContext,
    event: CeilingEvent,
    resolveLevelId: LevelResolver,
    nodes: Record<string, AnyNode>,
  ): TransitionResult | null {
    if (ctx.asset.attachTo !== 'ceiling') return null

    // Level guard
    const ceilingLevelId = resolveLevelId(event.node, nodes)
    if (ctx.levelId !== ceilingLevelId) return null

    const rawDims = ctx.draftItem
      ? getScaledDimensions(ctx.draftItem)
      : (ctx.asset.dimensions ?? DEFAULT_DIMENSIONS)
    const dims = getGridAlignedDimensions(rawDims, ctx.asset.attachTo)
    const [dimX, , dimZ] = dims
    const itemHeight = rawDims[1]
    const rotY = ctx.draftItem?.rotation?.[1] ?? 0
    const swapDims = Math.abs(Math.sin(rotY)) > 0.9

    // Ceiling items are stored in ceiling-local coordinates, so snapping must
    // use the ceiling hit's local position rather than world position.
    const x = snapToGrid(event.localPosition[0], swapDims ? dimZ : dimX)
    const z = snapToGrid(event.localPosition[2], swapDims ? dimX : dimZ)
    // Recessed fixtures seat flush with the ceiling plane (body rising into the
    // void above); everything else hangs its full height below the ceiling.
    const seatY = ctx.asset.recessed ? 0 : -itemHeight
    const worldSnapped = event.object.localToWorld(new Vector3(x, seatY, z))

    return {
      stateUpdate: { surface: 'ceiling', ceilingId: event.node.id },
      nodeUpdate: {
        position: [x, seatY, z],
        parentId: event.node.id,
      },
      cursorRotationY: 0,
      gridPosition: [x, seatY, z],
      cursorPosition: [worldSnapped.x, worldSnapped.y, worldSnapped.z],
      stopPropagation: true,
    }
  },

  /**
   * Handle ceiling:move — update position while on ceiling.
   */
  move(ctx: PlacementContext, event: CeilingEvent): PlacementResult | null {
    if (ctx.state.surface !== 'ceiling') return null
    if (!ctx.draftItem) return null

    const rawDims = getScaledDimensions(ctx.draftItem)
    const dims = getGridAlignedDimensions(rawDims, ctx.draftItem.asset.attachTo)
    const [dimX, , dimZ] = dims
    const itemHeight = rawDims[1]
    const rotY = ctx.draftItem.rotation?.[1] ?? 0
    const swapDims = Math.abs(Math.sin(rotY)) > 0.9

    const x = snapToGrid(event.localPosition[0], swapDims ? dimZ : dimX)
    const z = snapToGrid(event.localPosition[2], swapDims ? dimX : dimZ)
    // Recessed fixtures seat flush with the ceiling plane (body rising into the
    // void above); everything else hangs its full height below the ceiling.
    const seatY = ctx.draftItem.asset.recessed ? 0 : -itemHeight
    const worldSnapped = event.object.localToWorld(new Vector3(x, seatY, z))

    return {
      gridPosition: [x, seatY, z],
      cursorPosition: [worldSnapped.x, worldSnapped.y, worldSnapped.z],
      cursorRotationY: 0,
      nodeUpdate: null,
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle ceiling:click — commit placement on ceiling.
   */
  click(
    ctx: PlacementContext,
    event: CeilingEvent,
    validators: SpatialValidators,
  ): CommitResult | null {
    if (ctx.state.surface !== 'ceiling') return null
    if (!ctx.draftItem) return null

    const pos: [number, number, number] = [
      ctx.gridPosition.x,
      ctx.gridPosition.y,
      ctx.gridPosition.z,
    ]

    const valid = validators.canPlaceOnCeiling(
      ctx.state.ceilingId as CeilingNode['id'],
      pos,
      getGridAlignedDimensions(getScaledDimensions(ctx.draftItem), ctx.draftItem.asset.attachTo),
      ctx.draftItem.rotation,
      [ctx.draftItem.id],
    ).valid

    if (!valid) return null

    return {
      nodeUpdate: {
        position: pos,
        parentId: event.node.id,
        metadata: stripTransient(ctx.draftItem.metadata),
      },
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle ceiling:leave — transition back to floor surface.
   */
  leave(ctx: PlacementContext): TransitionResult | null {
    if (ctx.state.surface !== 'ceiling') return null

    return {
      stateUpdate: { surface: 'floor', ceilingId: null },
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: ctx.levelId,
      },
      cursorRotationY: 0,
      gridPosition: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      cursorPosition: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      stopPropagation: true,
    }
  },
}

// ============================================================================
// ITEM SURFACE STRATEGY
// ============================================================================

export const itemSurfaceStrategy = {
  /**
   * Handle item:enter — transition from floor to an item surface.
   * Returns null if: item has no surface, our item doesn't fit, or it's the draft itself.
   */
  enter(ctx: PlacementContext, event: ItemEvent): TransitionResult | null {
    // Only floor items can be placed on surfaces
    if (ctx.asset.attachTo) return null

    const surfaceItem = event.node as ItemNode
    // Don't surface-place on the draft itself
    if (surfaceItem.id === ctx.draftItem?.id) return null
    if (ctx.state.surface === 'item-surface' && ctx.state.surfaceItemId === surfaceItem.id) {
      return null
    }
    const nodes = useScene.getState().nodes
    if (ctx.draftItem && isDescendantOfItem(surfaceItem, ctx.draftItem, nodes)) return null

    // Size check: our footprint must fit on surface item's footprint
    const ourDims = ctx.draftItem
      ? getScaledDimensions(ctx.draftItem)
      : (ctx.asset.dimensions ?? DEFAULT_DIMENSIONS)
    const surfDims = getScaledDimensions(surfaceItem)
    if (ourDims[0] > surfDims[0] || ourDims[2] > surfDims[2]) return null

    const surfaceMesh = sceneRegistry.nodes.get(surfaceItem.id)
    if (!surfaceMesh) return null

    const worldPos = new Vector3(event.position[0], event.position[1], event.position[2])
    const localPos = surfaceMesh.worldToLocal(worldPos)
    const surfaceHeight = getSurfacePlacementHeight(surfaceItem, event, localPos)
    if (surfaceHeight === null) return null

    const x = snapToGrid(localPos.x, ourDims[0])
    const z = snapToGrid(localPos.z, ourDims[2])
    const y = surfaceHeight

    const worldSnapped = surfaceMesh.localToWorld(new Vector3(x, y, z))

    // Counter-rotate so the draft's world Y rotation stays continuous when
    // the user drags onto a rotated surface item. The cursor wireframe
    // already shows the user's intended world rotation; we just need to
    // store the right local value relative to the new parent.
    const surfaceQuat = new Quaternion()
    surfaceMesh.getWorldQuaternion(surfaceQuat)
    const surfaceWorldY = new Euler().setFromQuaternion(surfaceQuat, 'YXZ').y
    const localRotationY = ctx.currentCursorRotationY - surfaceWorldY
    const draftRotation = ctx.draftItem?.rotation ?? [0, 0, 0]

    return {
      stateUpdate: { surface: 'item-surface', surfaceItemId: surfaceItem.id },
      nodeUpdate: {
        position: [x, y, z],
        parentId: surfaceItem.id,
        rotation: [draftRotation[0], localRotationY, draftRotation[2]],
      },
      cursorRotationY: ctx.currentCursorRotationY,
      gridPosition: [x, y, z],
      cursorPosition: [worldSnapped.x, worldSnapped.y, worldSnapped.z],
      stopPropagation: true,
    }
  },

  /**
   * Handle item:move — update position while on an item surface.
   */
  move(ctx: PlacementContext, event: ItemEvent): PlacementResult | null {
    if (ctx.state.surface !== 'item-surface') return null
    if (!(ctx.state.surfaceItemId && ctx.draftItem)) return null
    if (event.node.id !== ctx.state.surfaceItemId) return null

    const nodes = useScene.getState().nodes
    const surfaceItem = nodes[ctx.state.surfaceItemId as AnyNodeId] as ItemNode | undefined
    if (!surfaceItem) return null

    const surfaceMesh = sceneRegistry.nodes.get(ctx.state.surfaceItemId)
    if (!surfaceMesh) return null

    const ourDims = getScaledDimensions(ctx.draftItem)
    const worldPos = new Vector3(event.position[0], event.position[1], event.position[2])
    const localPos = surfaceMesh.worldToLocal(worldPos)
    const surfaceHeight = getSurfacePlacementHeight(surfaceItem, event, localPos)
    if (surfaceHeight === null) return null

    const x = snapToGrid(localPos.x, ourDims[0])
    const z = snapToGrid(localPos.z, ourDims[2])
    const y = surfaceHeight

    const worldSnapped = surfaceMesh.localToWorld(new Vector3(x, y, z))

    return {
      gridPosition: [x, y, z],
      cursorPosition: [worldSnapped.x, worldSnapped.y, worldSnapped.z],
      cursorRotationY: ctx.currentCursorRotationY,
      nodeUpdate: { position: [x, y, z] },
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle item:click — commit placement on item surface.
   */
  click(ctx: PlacementContext, _event: ItemEvent): CommitResult | null {
    if (ctx.state.surface !== 'item-surface') return null
    if (!(ctx.draftItem && ctx.state.surfaceItemId)) return null
    if (_event.node.id !== ctx.state.surfaceItemId) return null

    return {
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: ctx.state.surfaceItemId,
        metadata: stripTransient(ctx.draftItem.metadata),
      },
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },
}

// ============================================================================
// SHELF SURFACE STRATEGY
// ============================================================================

/**
 * Resolve the row Y closest to the cursor's local Y. Reads candidate row
 * positions from the kind's `capabilities.surfaces.custom` — the shelf
 * declaration emits one `SurfacePoint` per board's top surface. The
 * strategy stays kind-agnostic at this level: any future "multi-board"
 * kind that declares `surfaces.custom` with upward normals gets the
 * same hit behaviour for free.
 */
function getShelfRowSurfaceY(shelfNode: ShelfNode, localY: number): number | null {
  const def = nodeRegistry.get('shelf')
  const custom = def?.capabilities?.surfaces?.custom
  if (!custom) return null
  const candidates = custom(shelfNode as AnyNode)
  if (candidates.length === 0) return null
  let best = candidates[0]
  let bestDist = Math.abs(best!.position[1] - localY)
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    if (!c) continue
    const dist = Math.abs(c.position[1] - localY)
    if (dist < bestDist) {
      best = c
      bestDist = dist
    }
  }
  return best?.position[1] ?? null
}

export const shelfSurfaceStrategy = {
  /**
   * Handle shelf:enter — transition the draft onto the closest shelf
   * row. Mirrors `itemSurfaceStrategy.enter` but reads candidate
   * surface heights from the shelf kind's `surfaces.custom` (one Y per
   * board) instead of `asset.surface.height`. Picks the row whose
   * surface Y is nearest the cursor's local Y so the user can target a
   * specific row by hovering near it.
   */
  enter(ctx: PlacementContext, event: ShelfEvent): TransitionResult | null {
    if (ctx.asset.attachTo) return null
    const shelfNode = event.node as ShelfNode

    if (ctx.state.surface === 'shelf-surface' && ctx.state.shelfId === shelfNode.id) {
      return null
    }
    if (!isUpwardShelfSurfaceHit(event)) return null

    // Size check: draft footprint must fit on the shelf board (width × depth).
    const ourDims = ctx.draftItem
      ? getScaledDimensions(ctx.draftItem)
      : (ctx.asset.dimensions ?? DEFAULT_DIMENSIONS)
    if (ourDims[0] > shelfNode.width || ourDims[2] > shelfNode.depth) return null

    const shelfMesh = sceneRegistry.nodes.get(shelfNode.id)
    if (!shelfMesh) return null

    const worldPos = new Vector3(event.position[0], event.position[1], event.position[2])
    const localPos = shelfMesh.worldToLocal(worldPos)
    const rowY = getShelfRowSurfaceY(shelfNode, localPos.y)
    if (rowY === null) return null

    const x = snapToGrid(localPos.x, ourDims[0])
    const z = snapToGrid(localPos.z, ourDims[2])

    const worldSnapped = shelfMesh.localToWorld(new Vector3(x, rowY, z))

    const surfaceQuat = new Quaternion()
    shelfMesh.getWorldQuaternion(surfaceQuat)
    const surfaceWorldY = new Euler().setFromQuaternion(surfaceQuat, 'YXZ').y
    const localRotationY = ctx.currentCursorRotationY - surfaceWorldY
    const draftRotation = ctx.draftItem?.rotation ?? [0, 0, 0]

    return {
      stateUpdate: { surface: 'shelf-surface', shelfId: shelfNode.id },
      nodeUpdate: {
        position: [x, rowY, z],
        parentId: shelfNode.id,
        rotation: [draftRotation[0], localRotationY, draftRotation[2]],
      },
      cursorRotationY: ctx.currentCursorRotationY,
      gridPosition: [x, rowY, z],
      cursorPosition: [worldSnapped.x, worldSnapped.y, worldSnapped.z],
      stopPropagation: true,
    }
  },

  /**
   * Handle shelf:move — re-derive the closest row each tick so the user
   * can slide between rows without leaving the shelf.
   */
  move(ctx: PlacementContext, event: ShelfEvent): PlacementResult | null {
    if (ctx.state.surface !== 'shelf-surface') return null
    if (!(ctx.state.shelfId && ctx.draftItem)) return null
    if (event.node.id !== ctx.state.shelfId) return null

    const shelfNode = event.node as ShelfNode
    const shelfMesh = sceneRegistry.nodes.get(shelfNode.id)
    if (!shelfMesh) return null

    const ourDims = getScaledDimensions(ctx.draftItem)
    const worldPos = new Vector3(event.position[0], event.position[1], event.position[2])
    const localPos = shelfMesh.worldToLocal(worldPos)
    const rowY = getShelfRowSurfaceY(shelfNode, localPos.y)
    if (rowY === null) return null

    const x = snapToGrid(localPos.x, ourDims[0])
    const z = snapToGrid(localPos.z, ourDims[2])
    const worldSnapped = shelfMesh.localToWorld(new Vector3(x, rowY, z))

    return {
      gridPosition: [x, rowY, z],
      cursorPosition: [worldSnapped.x, worldSnapped.y, worldSnapped.z],
      cursorRotationY: ctx.currentCursorRotationY,
      nodeUpdate: { position: [x, rowY, z] },
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle shelf:click — commit placement on the active row.
   */
  click(ctx: PlacementContext, event: ShelfEvent): CommitResult | null {
    if (ctx.state.surface !== 'shelf-surface') return null
    if (!(ctx.draftItem && ctx.state.shelfId)) return null
    if (event.node.id !== ctx.state.shelfId) return null

    return {
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: ctx.state.shelfId,
        metadata: stripTransient(ctx.draftItem.metadata),
      },
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },
}

/** Same upward-normal heuristic as `isUpwardItemSurfaceHit`, but typed
 *  for `ShelfEvent`. Re-uses the matrix-driven world normal calculation
 *  via a tiny `ItemEvent`-shaped adapter — the function only reads
 *  `event.normal` + `event.object`. */
function isUpwardShelfSurfaceHit(event: ShelfEvent): boolean {
  return isUpwardItemSurfaceHit(event as unknown as ItemEvent)
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Unified validation: check if the current draft item can be placed at its current position.
 * Switches on the active surface type and calls the appropriate spatial validator.
 */
export function checkCanPlace(ctx: PlacementContext, validators: SpatialValidators): boolean {
  if (!(ctx.levelId && ctx.draftItem)) return false

  // Item surface: valid if we entered (size check was in enter)
  if (ctx.state.surface === 'item-surface') {
    return ctx.state.surfaceItemId !== null
  }

  // Shelf surface: same — size check already happened on enter
  if (ctx.state.surface === 'shelf-surface') {
    return ctx.state.shelfId !== null
  }

  const attachTo = ctx.draftItem.asset.attachTo

  const alignedDims = getGridAlignedDimensions(getScaledDimensions(ctx.draftItem), attachTo)

  if (attachTo === 'ceiling') {
    if (ctx.state.surface !== 'ceiling' || !ctx.state.ceilingId) return false
    return validators.canPlaceOnCeiling(
      ctx.state.ceilingId as CeilingNode['id'],
      [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      alignedDims,
      ctx.draftItem.rotation,
      [ctx.draftItem.id],
    ).valid
  }

  if (attachTo === 'wall' || attachTo === 'wall-side') {
    if (ctx.state.surface === 'roof-wall') {
      return canPlaceOnRoofWall(ctx)
    }
    if (ctx.state.surface !== 'wall' || !ctx.state.wallId) return false
    return validators.canPlaceOnWall(
      ctx.levelId,
      ctx.state.wallId as WallNode['id'],
      ctx.gridPosition.x,
      ctx.gridPosition.y,
      alignedDims,
      attachTo,
      ctx.draftItem.side,
      [ctx.draftItem.id],
    ).valid
  }

  // Floor (no attachTo)
  return validators.canPlaceOnFloor(
    ctx.levelId,
    [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
    alignedDims,
    ctx.draftItem.rotation,
    [ctx.draftItem.id],
  ).valid
}
