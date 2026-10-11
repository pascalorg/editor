import { z } from 'zod'
import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import type { SceneMaterialId } from '../schema/scene-material'
import { applySceneChanges, mergeSceneChanges } from './apply-changes'
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

/**
 * `run_batch`: shared tools in order, each on the scene the calls before it left, their changes
 * merged into one set — one undo step, one write on either surface. The user: the model spent a
 * round trip per step on what could be serialised (deleting balcony walls one by one, the same
 * build on every floor). Inputs are checked before anything runs.
 */
export function createBatchOperation(
  operations: Readonly<Record<string, AgentOperation<never>>>,
  contracts: readonly Contract[],
): AgentOperation<BatchInput> {
  const names = Object.keys(operations).join(', ')
  return (nodes, { calls, onRefusal = 'stop' }, context) => {
    const prepared = calls.map((call, index) => {
      const operation = operations[call.tool]
      const contract = contracts.find((candidate) => candidate.name === call.tool)
      if (!(operation && contract))
        refuse(
          'unknown_tool',
          `The batch's call ${index + 1} names ${call.tool}, which a batch cannot run: call it on its own. A batch runs: ${names}.`,
          { index, tool: call.tool },
        )
      const parsed = z.object(contract.input).safeParse(call.input ?? {})
      if (!parsed.success)
        refuse(
          'invalid_input',
          `The batch's call ${index + 1} (${call.tool}) has an invalid input: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
            .join('; ')}. Nothing ran.`,
          { index, tool: call.tool },
        )
      return { index, tool: call.tool, operation, input: parsed.data }
    })

    let working = nodes
    let workingContext = context
    const sets: SceneChanges[] = []
    const reports: CallReport[] = []
    for (const call of prepared) {
      try {
        const { result, changes } = call.operation(working, call.input as never, workingContext)
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
        reports.push({ index: call.index, tool: call.tool, status: 'ok', result })
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        if (onRefusal === 'stop')
          refuse(
            'batch_call_refused',
            `The batch stopped at call ${call.index + 1} (${call.tool}), refused with ${error.code}: ${error.message} Nothing in the batch was applied.`,
            { index: call.index, tool: call.tool, refusal: error.code, ...error.details },
          )
        reports.push({
          index: call.index,
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
    }
  }
}
