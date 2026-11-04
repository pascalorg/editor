import { z } from 'zod'
import { INDEPENDENT_BATCH_TOOLS } from '../agent-tools/batch'
import { AgentRefusal, isAgentRefusal, type RefusalKeep, refuse } from '../agent-tools/refusal'
import type { SceneMaterialId } from '../schema/scene-material'
import { applySceneChanges, mergeSceneChanges } from './apply-changes'
import { requireFurnishing } from './design-brief'
import { referencedSceneMaterialIds } from './scene-materials'
import type { AgentOperation, SceneChanges } from './types'

type BatchInput = {
  calls: { tool: string; input?: Record<string, unknown> }[]
  onRefusal?: 'stop' | 'skip'
}
type Contract = { name: string; input: Record<string, z.ZodType> }

type CallReport =
  | { index: number; tool: string; status: 'ok'; result: Record<string, unknown> }
  | { index: number; tool: string; status: 'refused'; code: string; error: string }

function prepareCall(
  call: BatchInput['calls'][number],
  index: number,
  operations: Readonly<Record<string, AgentOperation<never>>>,
  contracts: readonly Contract[],
) {
  const operation = Object.hasOwn(operations, call.tool) ? operations[call.tool] : undefined
  const contract = contracts.find((candidate) => candidate.name === call.tool)
  if (!(operation && contract))
    refuse(
      'unknown_tool',
      `The batch's call ${index + 1} names ${call.tool}, which a batch cannot run: call it on its own. A batch runs: ${Object.keys(operations).join(', ')}.`,
    )
  const parsed = z.object(contract.input).safeParse(call.input ?? {})
  if (!parsed.success)
    refuse(
      'invalid_input',
      `The batch's call ${index + 1} (${call.tool}) has an invalid input: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ')}.`,
    )
  return { operation, input: parsed.data }
}

/**
 * `run_batch`: shared tools in order, each on the scene the calls before it left, their changes
 * merged into one set — one undo step, one write on either surface. The user: the model spent a
 * round trip per step on what could be serialised (deleting balcony walls one by one, the same
 * build on every floor). Pre-check and operation refusals follow the same per-call policy.
 */
export function createBatchOperation(
  operations: Readonly<Record<string, AgentOperation<never>>>,
  contracts: readonly Contract[],
): AgentOperation<BatchInput> {
  return (nodes, { calls, onRefusal = 'stop' }, context) => {
    let working = nodes
    let workingContext = context
    let kept: RefusalKeep['readings'] | undefined
    const sets: SceneChanges[] = []
    const reports: CallReport[] = []
    for (const [index, call] of calls.entries()) {
      try {
        requireFurnishing(call.tool, call.input, context.designBrief, {
          session: workingContext.session,
          catalog: workingContext.catalog,
        })
        const { operation, input } = prepareCall(call, index, operations, contracts)
        const { result, changes } = operation(working, input as never, {
          ...workingContext,
          batchCall: index,
        })
        if (changes) {
          sets.push(changes)
          working = applySceneChanges(working, changes)
          if (changes.materials?.length && workingContext.materials !== undefined)
            workingContext = {
              ...workingContext,
              materials: {
                ...workingContext.materials,
                ...Object.fromEntries(changes.materials.map((material) => [material.id, material])),
              },
            }
        }
        reports.push({ index, tool: call.tool, status: 'ok', result })
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        if (onRefusal === 'stop' && !INDEPENDENT_BATCH_TOOLS.includes(call.tool))
          throw new AgentRefusal(
            'batch_call_refused',
            `The batch stopped at call ${index + 1} (${call.tool}), refused with ${error.code}: ${error.message} Nothing in the batch was applied.`,
            { ...error.details, index, tool: call.tool, refusal: error.code },
            error.keep,
          )
        if (error.keep) {
          kept = { ...kept, ...error.keep.readings }
          if (workingContext.session)
            workingContext = {
              ...workingContext,
              session: {
                ...workingContext.session,
                readings: { ...workingContext.session.readings, ...error.keep.readings },
              },
            }
        }
        reports.push({
          index,
          tool: call.tool,
          status: 'refused',
          code: error.code,
          error: error.message,
        })
      }
    }
    const applied = reports.filter((report) => report.status === 'ok').length
    const merged = mergeSceneChanges(sets)
    // A later erase/delete may cancel a new material's only use in this batch.
    if (merged.materials) {
      const refs = referencedSceneMaterialIds(working)
      merged.materials = merged.materials.filter(
        (material) =>
          context.materials?.[material.id as SceneMaterialId] !== undefined ||
          refs.has(material.id),
      )
      if (!merged.materials.length) delete merged.materials
    }
    const changed =
      merged.create.length +
        merged.update.length +
        merged.delete.length +
        (merged.materials?.length ?? 0) >
      0
    return {
      result: { status: 'applied', applied, refused: reports.length - applied, calls: reports },
      ...(changed ? { changes: merged } : {}),
      ...(kept ? { keep: { readings: kept } } : {}),
    }
  }
}
