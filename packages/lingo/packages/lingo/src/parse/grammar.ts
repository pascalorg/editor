/**
 * Public aggregation point for the quantity grammar.
 *
 * The implementation is split by concern; this file preserves the original
 * import surface for internal and package entry points.
 */

export type {
  Alternative,
  ConversionResult,
  FailResult,
  LingoResult,
  NumberResult,
  ParseOptions,
  QuantityResult,
  RangeResult,
} from './config'
export {
  type PartialState,
  parseExpression,
  parseQuantityExpr,
  parseRangeExpr,
  partialQuantityState,
} from './finish'
