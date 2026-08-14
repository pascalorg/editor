/**
 * The solve, without the panels — for a caller with no DOM.
 *
 * `index.ts` exports the same symbols, and importing them from there costs React,
 * `@pascal-app/viewer`, `@pascal-app/editor`, `lucide-react` and `zustand`, because
 * the barrel also carries the inspector, the takeoff panel and the design report. That
 * is the right shape for the editor and the wrong one for a server: the MCP process
 * renders nothing, and an install of it should not resolve a UI stack to answer
 * whether a wall can be tied. Next is stricter than that — a Route Handler is a Server
 * Component, so the barrel's `useEffect` is a *build failure* there rather than a
 * weight problem, which is why the chat route imports this file too.
 *
 * So this entry point exists to be *narrow*, and `headless.test.ts` asserts that it
 * stays narrow — the chain behind it may import the core's formwork engine, the node
 * schemas, the geometry context and `three`, and nothing else. `three` is here
 * because the part collector reads marks off meshes the builders emit; the meshes are
 * discarded, and the classes construct fine outside a browser.
 *
 * It is not a second implementation of anything. Every symbol is the one the panels
 * and the editor's own AI call, re-exported, because a server answering a question
 * differently from the screen is the failure this whole layer is arranged against.
 */

export { savingCaveats } from '@pascal-app/core/formwork'
export {
  type FormworkMoveOutcome,
  type FormworkMovePlan,
  type KeyedPourMove,
  keyedMoves,
  moveOutcome,
  type PourMoveWrite,
  plannedMove,
} from './apply-move'
export {
  FORMWORK_SAVINGS_DESCRIPTION,
  type FormworkSavingOutcome,
  type FormworkSavingPlan,
  formworkSavings,
  type KeyedSaving,
  keyedSavings,
  plannedSaving,
  savingOutcome,
} from './apply-saving'
export {
  type CastableHostNode,
  type FormworkReconciliation,
  pourUnitsForHost,
  reconcileFormworkNodes,
} from './attach'
export {
  type FormworkFindingWithRemedy,
  type FormworkFixOutcome,
  type FormworkFixPlan,
  findingsWithRemedies,
  fixOutcome,
  noSuchFinding,
  plannedFix,
} from './fix-finding'
export {
  coverageCaveatForHost,
  type FormworkPartsReport,
  formworkCoverageCaveat,
  formworkPartsReport,
  type ReportedBomLine,
  type ReportedElevation,
  type ReportedPart,
  type ReportedShutter,
  shutterElevations,
} from './parts-report'
export { type SolvedShutter, shutterLabel, solveShuttersForHost } from './solve'
export {
  castableHostIds,
  type ProjectFormwork,
  type ProjectFormworkScope,
  projectFormworkCaveats,
  type SolvedElement,
  solveProjectFormwork,
} from './solve-project'
export { type ProjectValidation, validateProjectFormwork } from './validate-project'
export {
  FORMWORK_VALUE_DESCRIPTION,
  type FormworkValueEngineering,
  formworkValueOptions,
  VALUE_GAP_LABELS,
  VALUE_REFUSAL_LABELS,
  VALUE_VERDICT_LABELS,
  type ValueDelta,
  type ValueGap,
  type ValueOption,
  type ValueRefusal,
  type ValueVerdict,
  valueCaveats,
  valueOptionByKey,
  valueOptionKey,
} from './value-engineer'
