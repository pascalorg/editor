import { StairSegmentNode, type StairShape, stairShapeSegmentSpecs } from '@pascal-app/core'
import type { ToolDefaults } from '../../../store/use-editor'
import {
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_SHAPE,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_WIDTH,
} from './stair-defaults'

/** Placement shapes offered by the stair tool, in palette order. */
export const STAIR_SHAPES: readonly StairShape[] = ['straight', 'l-shaped', 'u-shaped']

/** `toolDefaults.stair` entry a build palette stages to arm a shape. */
export function stairShapeToolDefaults(shape: StairShape): ToolDefaults {
  return { shape }
}

/**
 * The shape the stair tool is armed with. Staged into `toolDefaults.stair`
 * by whoever activated the tool; falls back to straight, so a plain
 * `setTool('stair')` still places what it always did.
 */
export function resolveStairShape(defaults: ToolDefaults | undefined): StairShape {
  const shape = defaults?.shape
  return STAIR_SHAPES.includes(shape as StairShape) ? (shape as StairShape) : DEFAULT_STAIR_SHAPE
}

/** The `stair-segment` chain a shape places, at the tool's default sizing. */
export function createStairShapeSegments(shape: StairShape): StairSegmentNode[] {
  return stairShapeSegmentSpecs(shape, {
    height: DEFAULT_STAIR_HEIGHT,
    length: DEFAULT_STAIR_LENGTH,
    stepCount: DEFAULT_STAIR_STEP_COUNT,
    width: DEFAULT_STAIR_WIDTH,
  }).map((spec) =>
    StairSegmentNode.parse({
      ...spec,
      fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
      position: [0, 0, 0],
      thickness: DEFAULT_STAIR_THICKNESS,
    }),
  )
}
