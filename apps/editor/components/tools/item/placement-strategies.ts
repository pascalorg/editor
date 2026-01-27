import type {
  AnyNode,
  CeilingEvent,
  CeilingNode,
  GridEvent,
  WallEvent,
  WallNode,
} from '@pascal-app/core'
import type {
  CommitResult,
  LevelResolver,
  PlacementContext,
  PlacementResult,
  SpatialValidators,
  TransitionResult,
} from './placement-types'
import {
  calculateCursorRotation,
  calculateItemRotation,
  getSideFromNormal,
  isValidWallSideFace,
  snapToGrid,
  snapToHalf,
  stripTransient,
} from './placement-math'

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

    const [dimX, , dimZ] = ctx.asset.dimensions
    const x = snapToGrid(event.position[0], dimX)
    const z = snapToGrid(event.position[2], dimZ)

    return {
      gridPosition: [x, 0, z],
      cursorPosition: [x, event.position[1], z],
      cursorRotationY: 0,
      nodeUpdate: { position: [x, 0, z] },
      stopPropagation: false,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle grid:click — commit placement on floor.
   * Returns null if on wall/ceiling or validation fails.
   */
  click(ctx: PlacementContext, _event: GridEvent, validators: SpatialValidators): CommitResult | null {
    if (ctx.state.surface !== 'floor') return null
    if (!ctx.levelId || !ctx.draftItem) return null

    const pos: [number, number, number] = [ctx.gridPosition.x, 0, ctx.gridPosition.z]
    const valid = validators.canPlaceOnFloor(
      ctx.levelId,
      pos,
      ctx.draftItem.asset.dimensions,
      [0, 0, 0],
      [ctx.draftItem.id],
    ).valid

    if (!valid) return null

    return {
      nodeUpdate: {
        position: pos,
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
   */
  enter(
    ctx: PlacementContext,
    event: WallEvent,
    resolveLevelId: LevelResolver,
    nodes: Record<string, AnyNode>,
  ): TransitionResult | null {
    const attachTo = ctx.draftItem?.asset.attachTo
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

    return {
      stateUpdate: { surface: 'wall', wallId: event.node.id },
      nodeUpdate: {
        position: [x, y, z],
        parentId: event.node.id,
        side,
        rotation: [0, itemRotation, 0],
      },
      cursorRotationY: cursorRotation,
      gridPosition: [x, y, z],
      cursorPosition: [x, y, z],
      stopPropagation: true,
    }
  },

  /**
   * Handle wall:move — update position while on wall.
   * Returns null if not on a wall or face is invalid.
   */
  move(ctx: PlacementContext, event: WallEvent): PlacementResult | null {
    if (ctx.state.surface !== 'wall') return null
    if (!ctx.draftItem) return null
    if (!isValidWallSideFace(event.normal)) return null

    const side = getSideFromNormal(event.normal)
    const itemRotation = calculateItemRotation(event.normal)
    const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

    return {
      gridPosition: [
        snapToHalf(event.localPosition[0]),
        snapToHalf(event.localPosition[1]),
        snapToHalf(event.localPosition[2]),
      ],
      cursorPosition: [
        snapToHalf(event.position[0]),
        snapToHalf(event.position[1]),
        snapToHalf(event.position[2]),
      ],
      cursorRotationY: cursorRotation,
      nodeUpdate: {
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
  click(ctx: PlacementContext, event: WallEvent, validators: SpatialValidators): CommitResult | null {
    if (ctx.state.surface !== 'wall') return null
    if (!isValidWallSideFace(event.normal)) return null
    if (!ctx.levelId || !ctx.draftItem) return null

    const valid = validators.canPlaceOnWall(
      ctx.levelId,
      ctx.state.wallId as WallNode['id'],
      ctx.gridPosition.x,
      ctx.gridPosition.y,
      ctx.draftItem.asset.dimensions,
      ctx.draftItem.asset.attachTo as 'wall' | 'wall-side',
      ctx.draftItem.side,
      [ctx.draftItem.id],
    ).valid

    if (!valid) return null

    return {
      nodeUpdate: {
        position: [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
        parentId: event.node.id,
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
    if (ctx.draftItem?.asset.attachTo !== 'ceiling') return null

    // Level guard
    const ceilingLevelId = resolveLevelId(event.node, nodes)
    if (ctx.levelId !== ceilingLevelId) return null

    const [dimX, , dimZ] = ctx.asset.dimensions
    const itemHeight = ctx.asset.dimensions[1]

    const x = snapToGrid(event.position[0], dimX)
    const z = snapToGrid(event.position[2], dimZ)

    return {
      stateUpdate: { surface: 'ceiling', ceilingId: event.node.id },
      nodeUpdate: {
        position: [x, -itemHeight, z],
        parentId: event.node.id,
      },
      cursorRotationY: 0,
      gridPosition: [x, -itemHeight, z],
      cursorPosition: [x, event.position[1] - itemHeight, z],
      stopPropagation: true,
    }
  },

  /**
   * Handle ceiling:move — update position while on ceiling.
   */
  move(ctx: PlacementContext, event: CeilingEvent): PlacementResult | null {
    if (ctx.state.surface !== 'ceiling') return null
    if (!ctx.draftItem) return null

    const [dimX, , dimZ] = ctx.asset.dimensions
    const itemHeight = ctx.asset.dimensions[1]

    const x = snapToGrid(event.position[0], dimX)
    const z = snapToGrid(event.position[2], dimZ)

    return {
      gridPosition: [x, -itemHeight, z],
      cursorPosition: [x, event.position[1] - itemHeight, z],
      cursorRotationY: 0,
      nodeUpdate: null,
      stopPropagation: true,
      dirtyNodeId: null,
    }
  },

  /**
   * Handle ceiling:click — commit placement on ceiling.
   */
  click(ctx: PlacementContext, event: CeilingEvent, validators: SpatialValidators): CommitResult | null {
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
      ctx.draftItem.asset.dimensions,
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
// VALIDATION
// ============================================================================

/**
 * Unified validation: check if the current draft item can be placed at its current position.
 * Switches on the active surface type and calls the appropriate spatial validator.
 */
export function checkCanPlace(ctx: PlacementContext, validators: SpatialValidators): boolean {
  if (!ctx.levelId || !ctx.draftItem) return false

  const attachTo = ctx.draftItem.asset.attachTo

  if (attachTo === 'ceiling') {
    if (ctx.state.surface !== 'ceiling' || !ctx.state.ceilingId) return false
    return validators.canPlaceOnCeiling(
      ctx.state.ceilingId as CeilingNode['id'],
      [ctx.gridPosition.x, ctx.gridPosition.y, ctx.gridPosition.z],
      ctx.draftItem.asset.dimensions,
      ctx.draftItem.rotation,
      [ctx.draftItem.id],
    ).valid
  }

  if (attachTo === 'wall' || attachTo === 'wall-side') {
    if (ctx.state.surface !== 'wall' || !ctx.state.wallId) return false
    return validators.canPlaceOnWall(
      ctx.levelId,
      ctx.state.wallId as WallNode['id'],
      ctx.gridPosition.x,
      ctx.gridPosition.y,
      ctx.draftItem.asset.dimensions,
      attachTo,
      ctx.draftItem.side,
      [ctx.draftItem.id],
    ).valid
  }

  // Floor (no attachTo)
  return validators.canPlaceOnFloor(
    ctx.levelId,
    [ctx.gridPosition.x, 0, ctx.gridPosition.z],
    ctx.draftItem.asset.dimensions,
    [0, 0, 0],
    [ctx.draftItem.id],
  ).valid
}
