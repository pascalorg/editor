import type { AnyNode, CeilingNode, ItemNode, LevelNode, WallNode } from '@pascal-app/core'
import type { Vector3 } from 'three'
import type { Asset } from '../../../../../packages/core/src/schema/nodes/item'

// ============================================================================
// PLACEMENT STATE
// ============================================================================

export type SurfaceType = 'floor' | 'wall' | 'ceiling'

/**
 * Tracks which surface the draft item is currently on.
 * Replaces the scattered isOnWall, isOnCeiling refs and currentWallId, currentCeilingId variables.
 */
export interface PlacementState {
  surface: SurfaceType
  wallId: string | null
  ceilingId: string | null
}

// ============================================================================
// STRATEGY CONTEXT
// ============================================================================

/**
 * Read-only snapshot passed to every strategy call.
 */
export interface PlacementContext {
  asset: Asset
  levelId: LevelNode['id'] | null
  draftItem: ItemNode | null
  gridPosition: Vector3
  state: PlacementState
}

// ============================================================================
// STRATEGY RESULTS
// ============================================================================

/**
 * Returned by strategy move handlers.
 */
export interface PlacementResult {
  gridPosition: [number, number, number]
  cursorPosition: [number, number, number]
  cursorRotationY: number
  nodeUpdate: Partial<ItemNode> | null
  stopPropagation: boolean
  dirtyNodeId: AnyNode['id'] | null
}

/**
 * Returned by enter/leave handlers (surface transitions).
 */
export interface TransitionResult {
  stateUpdate: Partial<PlacementState>
  nodeUpdate: Partial<ItemNode>
  gridPosition: [number, number, number]
  cursorPosition: [number, number, number]
  cursorRotationY: number
  stopPropagation: boolean
}

/**
 * Returned by click handlers (commit placement).
 */
export interface CommitResult {
  nodeUpdate: Partial<ItemNode>
  stopPropagation: boolean
  dirtyNodeId: AnyNode['id'] | null
}

// ============================================================================
// SPATIAL VALIDATORS
// ============================================================================

/**
 * Type for the useSpatialQuery() return value.
 */
export interface SpatialValidators {
  canPlaceOnFloor: (
    levelId: LevelNode['id'],
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ) => { valid: boolean }
  canPlaceOnWall: (
    levelId: LevelNode['id'],
    wallId: WallNode['id'],
    localX: number,
    localY: number,
    dimensions: [number, number, number],
    attachType: 'wall' | 'wall-side',
    side?: 'front' | 'back',
    ignoreIds?: string[],
  ) => { valid: boolean }
  canPlaceOnCeiling: (
    ceilingId: CeilingNode['id'],
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ) => { valid: boolean }
}

/**
 * Resolver function type for finding a node's level.
 */
export type LevelResolver = (node: AnyNode, nodes: Record<string, AnyNode>) => string
