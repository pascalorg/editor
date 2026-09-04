/**
 * lingo/core — the engine without bundled unit data.
 * Bring your own KindDefs via createRegistry() for minimal builds.
 */

export { pickBestUnit, type ToBestOptions } from '../format/best'
export {
  type FormatOptions,
  formatCompound,
  formatQuantity,
  formatRange,
  type RangeFormatOptions,
} from '../format/format'
export type { LanguageProfile, LocalePack } from '../locale/types'
export {
  type Alternative,
  type ConversionResult,
  type FailResult,
  type LingoResult,
  type NumberResult,
  type ParseOptions,
  parseExpression,
  parseQuantityExpr,
  parseRangeExpr,
  type QuantityResult,
  type RangeResult,
} from '../parse/grammar'
export { type Normalized, normalizeInput, toSourceSpan } from '../parse/normalize'
export { convertDeltaValue, convertValue, fromBase, toBase } from './convert'
export { hasError, makeIssue, setDefaultMessages } from './errors'
export {
  Quantity,
  type QuantityJSON,
  type QuantityPart,
  QuantityRange,
  type QuantityRangeJSON,
  registryOf,
} from './quantity'
export {
  type AliasCompletion,
  createRegistry,
  type FuzzyVocab,
  Registry,
  type UnitMatch,
} from './registry'
export { approxEqual, roundDp, roundSig } from './round'
export { editDistance, rankCandidates, typoBudget } from './suggest'
export type {
  IssueCode,
  IssueDataMap,
  IssueInputData,
  Kind,
  KindDef,
  LingoIssue,
  Messages,
  NumberFormatPolicy,
  Severity,
  Span,
  UnitDef,
  UnitSystem,
} from './types'
export { defineKind } from './types'
export type {
  AliasByKind,
  BuiltinKind,
  BuiltinUnitRef,
  CanonicalUnitId,
  KindOfUnit,
  UnitIdByKind,
  UnitRefByKind,
} from './unit-refs'
