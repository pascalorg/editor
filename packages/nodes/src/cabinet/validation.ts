import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { moduleMaxX, moduleMinX, sortRunModules } from './run-layout'
import { cabinetModuleCeilingOverflow } from './run-ops'
import { minCabinetCarcassHeightForStack } from './stack'

export const CABINET_PLANNING_TOLERANCE = 1e-4
export const MIN_PRACTICAL_TOP_CABINET_HEIGHT = 0.15

export type CabinetPlanningIssueCode =
  | 'module-overlap'
  | 'module-gap'
  | 'tier-mismatch'
  | 'stack-too-short'
  | 'top-cabinet-too-short'
  | 'ceiling-overflow'

export type CabinetPlanningIssue = {
  code: CabinetPlanningIssueCode
  severity: 'error' | 'warning'
  message: string
  nodeIds: string[]
}

export type CabinetPlanningReport = {
  valid: boolean
  errors: CabinetPlanningIssue[]
  warnings: CabinetPlanningIssue[]
}

export type CabinetPlanningOptions = {
  tolerance?: number
  minimumTopCabinetHeight?: number
  nodes?: Readonly<Partial<Record<AnyNodeId, AnyNode>>>
}

function issue(
  code: CabinetPlanningIssueCode,
  severity: CabinetPlanningIssue['severity'],
  message: string,
  nodeIds: string[],
): CabinetPlanningIssue {
  return { code, severity, message, nodeIds }
}

function isFiller(module: CabinetModuleNode): boolean {
  return module.moduleKind === 'corner-filler'
}

/**
 * Validate the structural rules shared by cabinet-run editing, previews, and
 * export. This is intentionally scene-independent: callers resolve a run's
 * module children and pass the same values used to build the run geometry.
 */
export function validateCabinetRun(
  run: CabinetNode,
  modules: readonly CabinetModuleNode[],
  options: CabinetPlanningOptions = {},
): CabinetPlanningReport {
  const tolerance = options.tolerance ?? CABINET_PLANNING_TOLERANCE
  const minimumTopCabinetHeight =
    options.minimumTopCabinetHeight ?? MIN_PRACTICAL_TOP_CABINET_HEIGHT
  const errors: CabinetPlanningIssue[] = []
  const warnings: CabinetPlanningIssue[] = []
  const sorted = sortRunModules(modules)

  for (let index = 0; index < sorted.length; index += 1) {
    const module = sorted[index]!
    const next = sorted[index + 1]

    const minimumStackHeight = minCabinetCarcassHeightForStack(module)
    if (module.carcassHeight + tolerance < minimumStackHeight) {
      errors.push(
        issue(
          'stack-too-short',
          'error',
          `${module.name || 'Cabinet module'} is shorter than its fixed compartment stack.`,
          [module.id],
        ),
      )
    }

    if (run.runTier === 'tall' && module.cabinetType !== 'tall') {
      errors.push(
        issue(
          'tier-mismatch',
          'error',
          `${module.name || 'Cabinet module'} must be a tall module in a tall run.`,
          [run.id, module.id],
        ),
      )
    } else if (run.runTier === 'wall' && module.cabinetType === 'tall') {
      errors.push(
        issue(
          'tier-mismatch',
          'error',
          `${module.name || 'Cabinet module'} cannot be a tall module in a wall run.`,
          [run.id, module.id],
        ),
      )
    }

    if (module.topFinish === 'top-cabinet' && module.topFinishHeight < minimumTopCabinetHeight) {
      warnings.push(
        issue(
          'top-cabinet-too-short',
          'warning',
          `${module.name || 'Top cabinet'} is too short to be practical storage; use trim instead.`,
          [module.id],
        ),
      )
    }

    if (options.nodes) {
      const overflow = cabinetModuleCeilingOverflow(module, options.nodes)
      if (overflow > tolerance) {
        warnings.push(
          issue(
            'ceiling-overflow',
            'warning',
            `${module.name || 'Cabinet module'} extends ${(overflow * 1000).toFixed(0)} mm above the ceiling.`,
            [run.id, module.id],
          ),
        )
      }
    }

    if (!next) continue
    const gap = moduleMinX(next) - moduleMaxX(module)
    if (gap < -tolerance) {
      errors.push(
        issue(
          'module-overlap',
          'error',
          `${module.name || 'Cabinet module'} overlaps ${next.name || 'the next cabinet module'}.`,
          [module.id, next.id],
        ),
      )
    } else if (gap > tolerance && !isFiller(module) && !isFiller(next)) {
      warnings.push(
        issue(
          'module-gap',
          'warning',
          `There is an unfilled ${(gap * 1000).toFixed(0)} mm gap between cabinet modules.`,
          [module.id, next.id],
        ),
      )
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
